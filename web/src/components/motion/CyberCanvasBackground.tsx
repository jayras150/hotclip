"use client";

import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";

type Star = {
  x: number;
  y: number;
  radius: number;
  speed: number;
  alpha: number;
  twinkle: number;
};

type Orb = {
  baseX: number;
  baseY: number;
  radius: number;
  amplitudeX: number;
  amplitudeY: number;
  speedX: number;
  speedY: number;
  phase: number;
  color: string;
};

const STAR_COUNT = 80;
const ORB_COUNT = 3;
const SPOTLIGHT_RADIUS = 350;
const SPOTLIGHT_LERP = 0.08;
const MAX_DPR = 2;
const HORIZON_RATIO = 0.38; // horizon line at ~38% of viewport height

function createStars(width: number, height: number): Star[] {
  return Array.from({ length: STAR_COUNT }, () => ({
    x: Math.random() * width,
    y: Math.random() * height,
    radius: 0.4 + Math.random() * 1.1,
    speed: 6 + Math.random() * 14, // px per second, slow drift upward
    alpha: 0.15 + Math.random() * 0.55,
    twinkle: 0.5 + Math.random() * 2.5,
  }));
}

function createOrbs(width: number, height: number): Orb[] {
  const colors = ["#8B5CF6", "#00F0FF", "#8B5CF6"];
  return Array.from({ length: ORB_COUNT }, (_, i) => ({
    baseX: width * (0.22 + 0.28 * i),
    baseY: height * (0.3 + 0.2 * ((i + 1) % 2)),
    radius: Math.max(width, height) * (0.22 + 0.05 * i),
    amplitudeX: width * 0.06,
    amplitudeY: height * 0.05,
    speedX: 0.05 + 0.03 * i, // radians per second (very slow)
    speedY: 0.04 + 0.025 * ((i + 1) % 3),
    phase: (i * Math.PI * 2) / ORB_COUNT,
    color: colors[i % colors.length],
  }));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = parseInt(hex.slice(1), 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
}

function drawSpotlight(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, SPOTLIGHT_RADIUS);
  gradient.addColorStop(0, "rgba(0, 240, 255, 0.13)");
  gradient.addColorStop(0.55, "rgba(0, 240, 255, 0.05)");
  gradient.addColorStop(1, "rgba(0, 240, 255, 0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, SPOTLIGHT_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
): void {
  const horizonY = height * HORIZON_RATIO;
  const groundHeight = height - horizonY;

  // Horizontal lines drifting toward the viewer, spaced by perspective.
  // Each line's depth z goes from far (1) to near (0); projected y below horizon.
  const LINE_COUNT = 18;
  const scrollSpeed = 0.09; // depth units per second
  ctx.strokeStyle = "rgba(0, 240, 255, 0.07)";
  ctx.lineWidth = 1;

  for (let i = 0; i < LINE_COUNT; i++) {
    let z = ((i + ((time * scrollSpeed) % 1)) % LINE_COUNT) / LINE_COUNT; // 0..1
    z = 1 - z; // 1 = far, 0 = near
    const perspective = 1 / (1 + z * 9); // stronger compression far away
    const y = horizonY + perspective * groundHeight;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Static vertical lines converging toward the vanishing point.
  const vanishX = width / 2;
  const verticalCount = 12;
  for (let i = 0; i < verticalCount; i++) {
    const t = i / (verticalCount - 1) - 0.5; // -0.5..0.5
    const bottomX = vanishX + t * width * 2.4;
    ctx.beginPath();
    ctx.moveTo(vanishX + t * width * 0.12, horizonY);
    ctx.lineTo(bottomX, height);
    ctx.stroke();
  }
}

function drawOrbs(
  ctx: CanvasRenderingContext2D,
  orbs: Orb[],
  time: number,
): void {
  for (const orb of orbs) {
    const x =
      orb.baseX + Math.sin(time * orb.speedX + orb.phase) * orb.amplitudeX;
    const y =
      orb.baseY + Math.cos(time * orb.speedY + orb.phase) * orb.amplitudeY;
    const { r, g, b } = hexToRgb(orb.color);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, orb.radius);
    gradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.09)`);
    gradient.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, 0.045)`);
    gradient.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, orb.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawStars(
  ctx: CanvasRenderingContext2D,
  stars: Star[],
  time: number,
): void {
  for (const star of stars) {
    const twinkle = 0.65 + 0.35 * Math.sin(time * star.twinkle + star.x);
    ctx.fillStyle = `rgba(0, 240, 255, ${(star.alpha * twinkle).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(star.x, star.y, star.radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function updateStars(stars: Star[], height: number, delta: number): void {
  for (const star of stars) {
    star.y -= star.speed * delta;
    if (star.y < -4) {
      star.y = height + 4;
      star.x = Math.random() * window.innerWidth;
    }
  }
}

function CyberCanvasBackground(): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const prefersReducedMotion = usePrefersReducedMotion();
  const reducedMotionRef = useRef(prefersReducedMotion);

  useEffect(() => {
    reducedMotionRef.current = prefersReducedMotion;
  }, [prefersReducedMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let rafId = 0;
    let lastTime = 0;
    let elapsed = 0; // seconds, accumulated only while animating
    let paused = false;
    let stars: Star[] = [];
    let orbs: Orb[] = [];

    const pointer = { x: width / 2, y: height / 2 };
    const spotlight = { x: width / 2, y: height / 2 };
    let hasPointer = false;

    const resize = (): void => {
      width = window.innerWidth;
      height = window.innerHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      stars = createStars(width, height);
      orbs = createOrbs(width, height);
    };

    const onPointerMove = (event: PointerEvent): void => {
      hasPointer = true;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };

    const renderFrame = (delta: number): void => {
      elapsed += delta;
      updateStars(stars, height, delta);
      // Spotlight trailing lerp (frame-rate independent approximation).
      const t = 1 - Math.pow(1 - SPOTLIGHT_LERP, delta * 60);
      spotlight.x += (pointer.x - spotlight.x) * t;
      spotlight.y += (pointer.y - spotlight.y) * t;

      ctx.clearRect(0, 0, width, height);
      drawGrid(ctx, width, height, elapsed);
      drawOrbs(ctx, orbs, elapsed);
      drawStars(ctx, stars, elapsed);
      drawSpotlight(ctx, spotlight.x, spotlight.y);
    };

    const renderStaticFrame = (): void => {
      // One final static frame, no animation state changes.
      ctx.clearRect(0, 0, width, height);
      drawGrid(ctx, width, height, 0);
      drawOrbs(ctx, orbs, 0);
      drawStars(ctx, stars, 0);
      drawSpotlight(ctx, spotlight.x, spotlight.y);
    };

    const loop = (timestamp: number): void => {
      rafId = requestAnimationFrame(loop);
      if (paused || reducedMotionRef.current) return;
      const last = lastTime || timestamp;
      const delta = Math.min((timestamp - last) / 1000, 0.1); // clamp tab-switch jumps
      lastTime = timestamp;
      if (delta <= 0) return;
      renderFrame(delta);
    };

    const onVisibilityChange = (): void => {
      if (document.hidden) {
        paused = true;
        cancelAnimationFrame(rafId);
      } else {
        paused = false;
        lastTime = 0;
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(loop);
      }
    };

    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onPointerMove);
    document.addEventListener("visibilitychange", onVisibilityChange);

    if (reducedMotionRef.current) {
      renderStaticFrame();
    } else {
      rafId = requestAnimationFrame(loop);
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  // When reduced-motion flips on while mounted, freeze on one static frame.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !prefersReducedMotion) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const width = window.innerWidth;
    const height = window.innerHeight;
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, width, height, 0);
    drawOrbs(ctx, createOrbs(width, height), 0);
    drawStars(ctx, createStars(width, height), 0);
    drawSpotlight(ctx, width / 2, height / 2);
    ctx.restore();
  }, [prefersReducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="fixed inset-0 z-0 pointer-events-none"
    />
  );
}

export default CyberCanvasBackground;
