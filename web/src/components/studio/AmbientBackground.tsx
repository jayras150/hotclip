"use client";

import { cn } from "@/lib/cn";
import { usePrefersReducedMotion } from "@/lib/hooks/use-prefers-reduced-motion";

/* ------------------------------------------------------------------ */
/* Keyframes — injected once by this component (globals.css is not     */
/* editable in this scope, so the studio owns its motion here).        */
/* All animated properties are transform / opacity / filter only.      */
/* ------------------------------------------------------------------ */

const STUDIO_KEYFRAMES = `
@keyframes hc-grid-drift {
  0%   { transform: perspective(720px) rotateX(58deg) translateZ(0) translateY(0); }
  50%  { transform: perspective(720px) rotateX(58deg) translateZ(0) translateY(-28px); }
  100% { transform: perspective(720px) rotateX(58deg) translateZ(0) translateY(0); }
}
@keyframes hc-orb-a {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.55; }
  33%      { transform: translate3d(6vw, -4vh, 0) scale(1.12); opacity: 0.75; }
  66%      { transform: translate3d(-4vw, 3vh, 0) scale(0.94); opacity: 0.5; }
}
@keyframes hc-orb-b {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1); opacity: 0.45; }
  50%      { transform: translate3d(-7vw, 5vh, 0) scale(1.18); opacity: 0.7; }
}
@keyframes hc-orb-c {
  0%, 100% { transform: translate3d(0, 0, 0) scale(1.05); opacity: 0.4; }
  40%      { transform: translate3d(5vw, 6vh, 0) scale(0.9); opacity: 0.6; }
}
@keyframes hc-scan {
  0%   { transform: translateY(-40%); opacity: 0; }
  35%  { opacity: 0.5; }
  100% { transform: translateY(240%); opacity: 0; }
}
@keyframes hc-shimmer {
  0%   { background-position: 0% 50%; }
  50%  { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}
@keyframes hc-pulse {
  0%, 100% { opacity: 0.35; transform: scaleX(0.96); }
  50%      { opacity: 0.9;  transform: scaleX(1); }
}
@keyframes hc-cursor {
  0%, 49%  { opacity: 1; }
  50%, 100% { opacity: 0; }
}
@keyframes hc-stage-pulse {
  0%, 100% { opacity: 0.45; transform: scale(1); }
  50%      { opacity: 1;    transform: scale(1.18); }
}
@keyframes hc-connector {
  0%   { transform: scaleX(0); opacity: 0.2; }
  100% { transform: scaleX(1); opacity: 1; }
}
@keyframes hc-fade-up {
  from { opacity: 0; transform: translate3d(0, 12px, 0); }
  to   { opacity: 1; transform: translate3d(0, 0, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .hc-motion * { animation: none !important; transition: none !important; }
}
`;

/* ------------------------------------------------------------------ */

interface OrbSpec {
  className: string;
  size: string;
  color: string;
  blur: string;
  animation: string;
  duration: string;
  delay: string;
}

const ORBS: OrbSpec[] = [
  {
    className: "-top-24 left-[8%]",
    size: "38rem",
    color: "rgba(99, 102, 241, 0.32)",
    blur: "blur(110px)",
    animation: "hc-orb-a",
    duration: "26s",
    delay: "0s",
  },
  {
    className: "top-[30%] right-[4%]",
    size: "30rem",
    color: "rgba(14, 165, 233, 0.28)",
    blur: "blur(100px)",
    animation: "hc-orb-b",
    duration: "32s",
    delay: "-8s",
  },
  {
    className: "bottom-[6%] left-[28%]",
    size: "26rem",
    color: "rgba(16, 185, 129, 0.2)",
    blur: "blur(90px)",
    animation: "hc-orb-c",
    duration: "38s",
    delay: "-18s",
  },
];

/**
 * Perspective cyber-grid + drifting glow orbs + vignette. Decorative only:
 * aria-hidden, pointer-events-none, and every animated property is
 * transform/opacity (GPU friendly, 60fps). Reduced-motion users get a
 * fully static backdrop.
 */
export default function AmbientBackground() {
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none fixed inset-0 z-0 overflow-hidden hc-motion",
        reducedMotion && "hc-motion-off",
      )}
      style={reducedMotion ? undefined : { willChange: "transform" }}
    >
      <style>{STUDIO_KEYFRAMES}</style>

      {/* Deep space base */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 90% at 50% 0%, #0c1018 0%, #06080D 45%, #04060a 100%)",
        }}
      />

      {/* Perspective grid — pure CSS 3D transform on a repeating gradient */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute -inset-x-[40%] bottom-[-28%] top-[38%]"
          style={{
            backgroundImage:
              "repeating-linear-gradient(to right, rgba(99,102,241,0.16) 0 1px, transparent 1px 64px)," +
              "repeating-linear-gradient(to bottom, rgba(56,189,248,0.13) 0 1px, transparent 1px 64px)",
            transformStyle: "preserve-3d",
            willChange: "transform",
            animation: reducedMotion ? "none" : "hc-grid-drift 14s ease-in-out infinite",
          }}
        />
        {/* Horizon glow */}
        <div
          className="absolute inset-x-0 top-[34%] h-40"
          style={{
            background:
              "radial-gradient(60% 100% at 50% 100%, rgba(99,102,241,0.28), transparent 70%)",
          }}
        />
      </div>

      {/* Glow orbs */}
      {ORBS.map((orb) => (
        <div
          key={orb.animation}
          className={cn("absolute rounded-full", orb.className)}
          style={{
            width: orb.size,
            height: orb.size,
            background: `radial-gradient(circle at 35% 35%, ${orb.color}, transparent 65%)`,
            filter: orb.blur,
            animation: reducedMotion
              ? "none"
              : `${orb.animation} ${orb.duration} ease-in-out infinite`,
            animationDelay: orb.delay,
            willChange: "transform, opacity",
          }}
        />
      ))}

      {/* Slow scanline sweep */}
      <div className="absolute inset-0 overflow-hidden">
        <div
          className="absolute inset-x-0 h-[35%]"
          style={{
            background:
              "linear-gradient(180deg, transparent, rgba(125,211,252,0.045), transparent)",
            animation: reducedMotion ? "none" : "hc-scan 9s linear infinite",
            willChange: "transform, opacity",
          }}
        />
      </div>

      {/* Noise + vignette (static, cheap) */}
      <div
        className="absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(75% 65% at 50% 40%, transparent 55%, rgba(3,6,14,0.55) 100%)",
        }}
      />
    </div>
  );
}
