#!/usr/bin/env python3
"""Vast.ai SDK bridge for the HotClip GPU worker lifecycle.

This module intentionally uses the official Python ``vastai`` package instead
of shelling out to the ``vast`` / ``vastai`` CLI.  The TypeScript bridge
(``src/server/vast-client.ts``) executes the CLI entrypoint at the bottom of
this file and parses the JSON printed to stdout.

Only the ``vastai`` package is required at runtime.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Any, Optional

try:  # pragma: no cover - import error is reported by the CLI entrypoint
    from vastai import VastAI
except ImportError:  # pragma: no cover
    VastAI = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Hard provider limits (PLAN.md section 4.2)
# ---------------------------------------------------------------------------

# Hard limits bisa dioverride via env agar mengikuti pasaran offer tanpa
# rebuild image — sinkron dengan src/server/vast-client.ts.
import os  # noqa: E402  (dipakai untuk override hard limits di bawah)

MAX_DPH_TOTAL: float = float(os.environ.get("VAST_MAX_DPH_TOTAL", "0.35") or 0.35)
MIN_GPU_RAM: int = int(float(os.environ.get("VAST_MIN_GPU_RAM", "6") or 6))
MIN_CPU_CORES_EFFECTIVE: int = int(
    float(os.environ.get("VAST_MIN_CPU_CORES", "2") or 2)
)
MIN_DISK_SPACE: int = int(float(os.environ.get("VAST_MIN_DISK_SPACE", "35") or 35))
MIN_INET_DOWN: int = int(float(os.environ.get("VAST_MIN_INET_DOWN", "400") or 400))
MIN_INET_UP: int = int(float(os.environ.get("VAST_MIN_INET_UP", "400") or 400))

# Plafon keras ukuran disk instance (billing guard). Image worker >10 GB, jadi
# disk di bawah ~30 GB akan gagal boot — 35 GB adalah nilai aman terkecil.
MAX_DISK_GB: float = float(os.environ.get("VAST_MAX_DISK_GB", "35") or 35)
MIN_RELIABILITY2: float = float(
    os.environ.get("VAST_MIN_RELIABILITY2", "0.95") or 0.95
)

DEFAULT_LIMITS: dict[str, float] = {
    "max_dph_total": MAX_DPH_TOTAL,
    "min_gpu_ram": float(MIN_GPU_RAM),
    "min_cpu_cores_effective": float(MIN_CPU_CORES_EFFECTIVE),
    "min_disk_space": float(MIN_DISK_SPACE),
    "min_inet_down": float(MIN_INET_DOWN),
    "min_inet_up": float(MIN_INET_UP),
    "min_reliability2": MIN_RELIABILITY2,
}

# Allow the TypeScript side (camelCase) to pass filter keys directly.
_LIMIT_ALIASES: dict[str, str] = {
    "maxDphTotal": "max_dph_total",
    "minGpuRam": "min_gpu_ram",
    "minCpuCoresEffective": "min_cpu_cores_effective",
    "minDiskSpace": "min_disk_space",
    "minInetDown": "min_inet_down",
    "minInetUp": "min_inet_up",
    "minReliability2": "min_reliability2",
}

_OFFER_FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "dph_total": ("dph_total", "dphTotal", "price"),
    "gpu_ram": ("gpu_ram", "gpuRam", "gpu_ram_gb"),
    "cpu_cores_effective": (
        "cpu_cores_effective",
        "cpuCoresEffective",
        "cpu_cores",
    ),
    "disk_space": ("disk_space", "diskSpace"),
    "inet_down": ("inet_down", "inetDown"),
    "inet_up": ("inet_up", "inetUp"),
    "reliability2": ("reliability2", "reliability_2", "reliability"),
}


def _offer_value(offer: dict[str, Any], field: str) -> Any:
    """Return the first present value for ``field`` from an offer dict."""
    for key in _OFFER_FIELD_ALIASES.get(field, (field,)):
        if key in offer:
            return offer[key]
    # Some SDK responses wrap the offer in an ``offer`` object.
    nested = offer.get("offer")
    if isinstance(nested, dict):
        for key in _OFFER_FIELD_ALIASES.get(field, (field,)):
            if key in nested:
                return nested[key]
    return None


def _as_float(value: Any) -> Optional[float]:
    """Coerce a numeric value, returning ``None`` for invalid input."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number):
        return None
    return number


def _normalize_limits(limits: Optional[dict[str, Any]]) -> dict[str, float]:
    """Merge caller-provided limits over the hard defaults."""
    resolved = dict(DEFAULT_LIMITS)
    if not limits:
        return resolved
    for raw_key, raw_value in limits.items():
        key = _LIMIT_ALIASES.get(str(raw_key), str(raw_key))
        key = key.lower()
        if key not in resolved:
            continue
        value = _as_float(raw_value)
        if value is not None:
            resolved[key] = value
    return resolved


def filter_providers(
    offers: list[dict[str, Any]],
    limits: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """Filter offers with the hard AND rules and sort by price ascending.

    Offers missing any required metric are rejected rather than treated as
    zero.  The returned list contains the original offer dictionaries, sorted
    from the cheapest ``dph_total`` to the most expensive.
    """
    resolved = _normalize_limits(limits)
    accepted: list[dict[str, Any]] = []

    for offer in offers or []:
        if not isinstance(offer, dict):
            continue

        dph_total = _as_float(_offer_value(offer, "dph_total"))
        gpu_ram = _as_float(_offer_value(offer, "gpu_ram"))
        cpu_cores = _as_float(_offer_value(offer, "cpu_cores_effective"))
        disk_space = _as_float(_offer_value(offer, "disk_space"))
        inet_down = _as_float(_offer_value(offer, "inet_down"))
        inet_up = _as_float(_offer_value(offer, "inet_up"))
        reliability2 = _as_float(_offer_value(offer, "reliability2"))

        metrics = (
            dph_total,
            gpu_ram,
            cpu_cores,
            disk_space,
            inet_down,
            inet_up,
            reliability2,
        )
        if any(metric is None for metric in metrics):
            continue

        assert dph_total is not None
        assert gpu_ram is not None
        assert cpu_cores is not None
        assert disk_space is not None
        assert inet_down is not None
        assert inet_up is not None
        assert reliability2 is not None

        if dph_total > resolved["max_dph_total"]:
            continue
        if gpu_ram < resolved["min_gpu_ram"]:
            continue
        if cpu_cores < resolved["min_cpu_cores_effective"]:
            continue
        if disk_space < resolved["min_disk_space"]:
            continue
        if inet_down < resolved["min_inet_down"]:
            continue
        if inet_up < resolved["min_inet_up"]:
            continue
        if reliability2 < resolved["min_reliability2"]:
            continue

        accepted.append(offer)

    accepted.sort(
        key=lambda item: _as_float(_offer_value(item, "dph_total")) or math.inf
    )
    return accepted


def _client(api_key: str) -> Any:
    if not api_key:
        raise ValueError("api_key is required")
    if VastAI is None:
        raise RuntimeError(
            "Python package 'vastai' is not installed. "
            "Install it with: pip install vastai"
        )
    return VastAI(api_key=api_key)


def search_providers(
    api_key: str,
    limit: int = 20,
    query: Optional[dict[str, Any]] = None,
) -> list[dict[str, Any]]:
    """Search offers through the SDK, then apply the hard provider filters."""
    vast = _client(api_key)
    offers = vast.search_offers(query=query, limit=limit)
    if not isinstance(offers, list):
        return []
    return filter_providers(offers)


def request_instance(
    api_key: str,
    offer_id: int,
    workspace_dir: str = "/workspace",
    image: Optional[str] = None,
    env: Optional[dict[str, str]] = None,
    port: Optional[int] = None,
    onstart: Optional[str] = None,
    direct: bool = False,
) -> dict[str, Any]:
    """Create a GPU instance from ``offer_id`` and return the SDK response.

    Vast's SDK does not expose a dedicated working-directory option, so the
    workspace is exported to the container as ``WORKSPACE_DIR`` (caller-provided
    environment variables always win).
    """
    vast = _client(api_key)
    payload_env: Optional[dict[str, str]] = None
    if env or workspace_dir:
        payload_env = {str(key): str(value) for key, value in (env or {}).items()}
        if workspace_dir:
            payload_env.setdefault("WORKSPACE_DIR", workspace_dir)

    # `create_instance(id, image, disk)` — image & disk wajib di sisi API Vast
    # (tanpa image, endpoint /asks/<offer_id>/ membalas 400 Bad Request).
    resolved_image = (
        image
        or os.environ.get("VAST_DEFAULT_IMAGE")
        or "pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime"
    )
    # Disk instance: default 35 GB dan TIDAK PERNAH melebihi MAX_DISK_GB.
    disk_gb = min(
        float(os.environ.get("VAST_DISK_GB", "35") or 35),
        MAX_DISK_GB,
    )

    # `-p <port>` (docker options) membuat Vast memetakan port container ke
    # port host publik — mapping lengkap ada di `ports` saat `show_instance`.
    extra_arg: Optional[str] = f"-p {int(port)}" if port else None

    want_direct = bool(direct)

    try:
        result = vast.create_instance(
            id=offer_id and int(offer_id),
            image=resolved_image,
            disk=disk_gb,
            env=payload_env,
            extra=extra_arg,
            onstart_cmd=onstart,
            # `direct=True` memakai direct-connection instance: port host yang
            # dipublikasikan masuk ke rentang `direct_port_start..+count`, yang
            # dibaca orchestrator untuk healthcheck worker.
            direct=want_direct,
            # Vast menolak direct tanpa akses lain:
            # "direct=True requires ssh=True or jupyter=True". SSH sekaligus
            # menjadi jalur darurat bila healthcheck HTTP worker gagal.
            ssh=want_direct or None,
        )
    except Exception as exc:  # sertakan body error Vast agar 400 tidak buta
        body = getattr(getattr(exc, "response", None), "text", None)
        if body:
            raise RuntimeError(f"{exc} :: {body[:500]}") from exc
        raise
    return result if isinstance(result, dict) else {"result": result}


def cancel_request(api_key: str, instance_id: int) -> None:
    """Cancel a pending/running instance request.

    The installed SDK version has no separate ``cancel_request`` method; a
    destroy is the API-level cancellation and also stops all billing.
    """
    vast = _client(api_key)
    cancel = getattr(vast, "cancel_request", None)
    if callable(cancel):
        cancel(int(instance_id))
        return
    vast.destroy_instance(id=int(instance_id))


def release_instance(api_key: str, instance_id: int) -> None:
    """Destroy an instance (hard delete, no residual disk billing)."""
    _client(api_key).destroy_instance(id=int(instance_id))


def show_instance(api_key: str, instance_id: int) -> dict[str, Any]:
    """Return a normalized detail dict for one instance.

    Catatan penting (diverifikasi lewat probe pada instance nyata):
    `show_instance` Vast TIDAK mengembalikan map `ports` untuk instance docker
    biasa. Yang tersedia adalah rentang *direct port* mesin:
    `direct_port_start` / `direct_port_end` / `direct_port_count`. Port
    container yang dipublikasikan (`docker -p`) dipetakan ke port host di
    rentang tersebut, jadi orchestrator memakai `direct_port_start` sebagai
    kandidat mapped port untuk healthcheck worker.
    """
    raw = _client(api_key).show_instance(id=int(instance_id))
    if not isinstance(raw, dict):
        return {"raw": raw}
    ports = raw.get("port_mappings") or raw.get("ports") or raw.get("ports_map")
    if not isinstance(ports, dict):
        ports = {}
    return {
        "id": str(raw.get("id") or raw.get("instance_id") or instance_id),
        "actual_status": raw.get("actual_status") or raw.get("cur_status") or raw.get("status"),
        "status_msg": raw.get("status_msg"),
        "public_ipaddr": raw.get("public_ipaddr") or raw.get("public_ip") or raw.get("host_ip"),
        "ports": ports,
        # Rentang direct port host — sumber kebenaran untuk mapped worker port.
        "direct_port_start": raw.get("direct_port_start"),
        "direct_port_end": raw.get("direct_port_end"),
        "direct_port_count": raw.get("direct_port_count"),
        "image_uuid": raw.get("image_uuid"),
        "gpu_name": raw.get("gpu_name"),
        "dph_total": raw.get("dph_total"),
        "disk_space": raw.get("disk_space"),
        "start_date": raw.get("start_date"),
    }


def logs(api_key: str, instance_id: int, tail: int = 200) -> str:
    """Return the container logs for an instance as a plain string."""
    result = _client(api_key).logs(instance_id=int(instance_id), tail=str(tail))
    if isinstance(result, str):
        return result
    return json.dumps(result, default=str)


# ---------------------------------------------------------------------------
# CLI bridge used by src/server/vast-client.ts
# ---------------------------------------------------------------------------


def _add_common_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--api-key", default=argparse.SUPPRESS)


def _add_instance_args(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--instance-id", type=int, required=True)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Vast.ai SDK bridge for HotClip GPU workers"
    )
    parser.add_argument("--api-key", default=None)
    subparsers = parser.add_subparsers(dest="command", required=True)

    search_parser = subparsers.add_parser("search", help="Search filtered offers")
    _add_common_args(search_parser)
    search_parser.add_argument("--limit", type=int, default=20)
    search_parser.add_argument(
        "--query",
        default=None,
        help="JSON object with pre-parsed Vast search filters",
    )

    request_parser = subparsers.add_parser("request", help="Create an instance")
    _add_common_args(request_parser)
    request_parser.add_argument("--offer-id", type=int, required=True)
    request_parser.add_argument("--workspace", default="/workspace")
    request_parser.add_argument(
        "--port",
        type=int,
        default=None,
        help="Container port to map to a public host port (docker -p)",
    )
    request_parser.add_argument(
        "--onstart",
        default=None,
        help="onstart_cmd executed inside the instance at boot",
    )
    request_parser.add_argument(
        "--direct",
        action="store_true",
        help="Create a direct-connection instance (host ports from direct_port range)",
    )
    request_parser.add_argument("--image", default=None)
    request_parser.add_argument("--env", default=None, help="JSON object")

    cancel_parser = subparsers.add_parser("cancel", help="Cancel/destroy an instance")
    _add_common_args(cancel_parser)
    _add_instance_args(cancel_parser)

    release_parser = subparsers.add_parser("release", help="Destroy an instance")
    _add_common_args(release_parser)
    _add_instance_args(release_parser)

    show_parser = subparsers.add_parser(
        "show", help="Show one instance (ip + port mappings + status)"
    )
    _add_common_args(show_parser)
    _add_instance_args(show_parser)

    logs_parser = subparsers.add_parser("logs", help="Fetch instance logs")
    _add_common_args(logs_parser)
    _add_instance_args(logs_parser)
    logs_parser.add_argument("--tail", type=int, default=200)

    return parser


def _parse_json_object(raw: Optional[str], label: str) -> Optional[dict[str, Any]]:
    if raw is None or raw == "":
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError(f"invalid JSON for {label}: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError(f"{label} must be a JSON object")
    return parsed


def _emit(payload: Any) -> None:
    print(json.dumps(payload, default=str))


def main(argv: Optional[list[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)

    api_key = getattr(args, "api_key", None)
    if not api_key:
        parser.error("--api-key is required")

    if args.command == "search":
        query = _parse_json_object(getattr(args, "query", None), "--query")
        _emit(search_providers(api_key, limit=args.limit, query=query))
    elif args.command == "request":
        env = _parse_json_object(getattr(args, "env", None), "--env")
        _emit(
            request_instance(
                api_key,
                offer_id=args.offer_id,
                workspace_dir=args.workspace,
                image=args.image,
                env=env,
                port=getattr(args, "port", None),
                onstart=getattr(args, "onstart", None),
                direct=bool(getattr(args, "direct", False)),
            )
        )
    elif args.command == "show":
        _emit(show_instance(api_key, instance_id=args.instance_id))
    elif args.command == "cancel":
        cancel_request(api_key, instance_id=args.instance_id)
        _emit({"ok": True, "instanceId": str(args.instance_id)})
    elif args.command == "release":
        release_instance(api_key, instance_id=args.instance_id)
        _emit({"ok": True, "instanceId": str(args.instance_id)})
    elif args.command == "logs":
        _emit({"logs": logs(api_key, instance_id=args.instance_id, tail=args.tail)})
    else:  # pragma: no cover - argparse enforces a valid subcommand
        parser.error(f"unknown command: {args.command}")
        return 2

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:  # pragma: no cover - CLI error surface
        print(f"vast_manager error: {exc}", file=sys.stderr)
        sys.exit(1)
