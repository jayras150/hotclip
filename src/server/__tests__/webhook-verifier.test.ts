/**
 * Unit tests — svix `Webhook` signature verification (v2 API).
 *
 * svix 2.x mendelegasikan ke `standardwebhooks`:
 *   - `sign(msgId, timestamp: Date, payload)` mengembalikan STRING signature
 *     berformat `v1,<base64>` — bukan header map, jadi header `webhook-*`
 *     dirakit manual meniru bentuk request asli dari provider.
 *   - `verify(payload, headers)` mengembalikan `void`; bila signature tidak
 *     valid ia **throw** (bukan return false).
 */
import { describe, expect, it } from "vitest";
import { Webhook } from "svix";

const SECRET = "whsec_MfKQ9r8GAYqrTedJAvbQCP2ZCKM9SCsm";

function signHeaders(
  payload: string,
  opts: { secret?: string; msgId?: string } = {},
): Record<string, string> {
  const wh = new Webhook(opts.secret ?? SECRET);
  const msgId = opts.msgId ?? "msg_test_0001";
  const timestamp = new Date();
  const signature = wh.sign(msgId, timestamp, payload);

  return {
    "webhook-id": msgId,
    "webhook-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
    "webhook-signature": signature,
  };
}

describe("svix Webhook signature verification", () => {
  it("verifies a payload signed with wh.sign", () => {
    const payload = JSON.stringify({ type: "user.created", data: { id: "u1" } });
    const headers = signHeaders(payload);

    expect(() => new Webhook(SECRET).verify(payload, headers)).not.toThrow();
  });

  it("throws on a tampered payload", () => {
    const payload = JSON.stringify({ type: "user.created", data: { id: "u1" } });
    const headers = signHeaders(payload);

    const tampered = JSON.stringify({ type: "user.deleted", data: { id: "u1" } });
    expect(() => new Webhook(SECRET).verify(tampered, headers)).toThrow();
  });

  it("throws on a signature from a different payload", () => {
    const payload = JSON.stringify({ type: "session.ended" });
    const headers = signHeaders(JSON.stringify({ type: "session.started" }));

    expect(() => new Webhook(SECRET).verify(payload, headers)).toThrow();
  });

  it("throws when the signature was produced with a different secret", () => {
    const payload = JSON.stringify({ type: "user.created" });
    const headers = signHeaders(payload, { secret: `whsec_${"A".repeat(32)}` });

    expect(() => new Webhook(SECRET).verify(payload, headers)).toThrow();
  });

  it("throws when required headers are missing", () => {
    const payload = JSON.stringify({ type: "user.created" });
    expect(() => new Webhook(SECRET).verify(payload, {})).toThrow();
  });
});
