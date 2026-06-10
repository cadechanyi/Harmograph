"use client";

/**
 * FlowVisualizer — the Harmograph flow.
 *
 * One shared graph (no per-element lanes): time flows right-to-left through a
 * fixed NOW line; the vertical axis is musical pitch/height shared by every
 * element so they overlap and interact. Layered back-to-front:
 *
 *   vocals  — a soft cloud behind everything, size/opacity track vocal loudness
 *   bass    — large blobs that swell on bass hits and jump around
 *   melody  — a continuous function line following pitch, thickening + brighter
 *             with intensity
 *   kick    — a ball that bounces along the melody line
 *   snare   — a starburst that bounces along the melody line
 *   hihat   — thin ticks that fall from the top on each hit
 *
 * Driven by the song's playback clock via `getCurrentTime`.
 */

import { useEffect, useRef } from "react";

export interface VisualElement {
  id: string;
  label: string;
  parent: string;
  kind: "percussive" | "tonal";
  events: { t: number; strength: number }[];
  envelope: { t: number; v: number }[];
  contour: { t: number; p: number; v: number }[];
}

export interface FlowVisualizerProps {
  elements: VisualElement[];
  getCurrentTime: () => number;
  duration: number;
}

type RGB = [number, number, number];

const COLORS: Record<string, RGB> = {
  vocals: [183, 148, 246],
  other: [110, 231, 183],
  guitar: [251, 191, 36],
  piano: [244, 114, 182],
  bass: [90, 156, 255],
  kick: [255, 90, 95],
  snare: [255, 209, 102],
  hihat: [139, 233, 253],
};

const PX_PER_SEC = 150;
const NOW_FRACTION = 0.32;
const FADE_PX = 90;
const PULSE_S = 0.18; // how long an event "pulses" around NOW

function rgba(c: RGB, a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.max(0, Math.min(1, a))})`;
}

function edgeAlpha(x: number, width: number): number {
  const left = Math.min(1, Math.max(0, x / FADE_PX));
  const right = Math.min(1, Math.max(0, (width - x) / FADE_PX));
  return Math.min(left, right);
}

/** Stable pseudo-random in [0,1) from a number (for bass "jump" positions). */
function hash01(n: number): number {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

export function FlowVisualizer({
  elements,
  getCurrentTime,
  duration,
}: FlowVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elementsRef = useRef(elements);
  const timeRef = useRef(getCurrentTime);
  const durationRef = useRef(duration);
  elementsRef.current = elements;
  timeRef.current = getCurrentTime;
  durationRef.current = duration;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;

    let raf = 0;
    let running = true;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = () => {
      if (!running) return;
      const rect = canvas.getBoundingClientRect();
      const W = rect.width;
      const H = rect.height;
      const t = timeRef.current();
      const nowX = W * NOW_FRACTION;
      const tBehind = nowX / PX_PER_SEC;
      const tAhead = (W - nowX) / PX_PER_SEC;
      const tMin = t - tBehind;
      const tMax = t + tAhead;
      const xOf = (time: number) => nowX + (time - t) * PX_PER_SEC;

      // Pitch -> y in a shared vertical band (high pitch near top).
      const yTop = H * 0.12;
      const yBot = H * 0.9;
      const yOfPitch = (p: number) => yBot - Math.max(0, Math.min(1, p)) * (yBot - yTop);
      const midY = (yTop + yBot) / 2;

      const els = elementsRef.current;
      const byId = (id: string) => els.find((e) => e.id === id);

      // Background with a subtle vertical gradient.
      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0b0b12");
      bg.addColorStop(1, "#07070b");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const melody =
        byId("other") ?? byId("guitar") ?? byId("piano") ?? null;
      const melodyYAt = makeMelodySampler(melody, yOfPitch, midY);

      // ---- Layer 1: vocals cloud (behind everything) --------------------
      const vocals = byId("vocals");
      if (vocals) {
        ctx.globalCompositeOperation = "lighter";
        const c = COLORS.vocals;
        for (const pt of vocals.envelope) {
          if (pt.t < tMin || pt.t > tMax) continue;
          const x = xOf(pt.t);
          const a = edgeAlpha(x, W);
          if (a <= 0) continue;
          const r = 40 + pt.v * Math.min(W, H) * 0.28;
          const g = ctx.createRadialGradient(x, midY + H * 0.12, 0, x, midY + H * 0.12, r);
          g.addColorStop(0, rgba(c, a * 0.18 * (0.4 + pt.v)));
          g.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, midY + H * 0.12, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // ---- Layer 2: bass blobs (swell on hits, jump around) -------------
      const bass = byId("bass");
      if (bass) {
        const c = COLORS.bass;
        ctx.globalCompositeOperation = "lighter";
        for (const ev of bass.events) {
          if (ev.t < tMin || ev.t > tMax) continue;
          const x = xOf(ev.t);
          const a = edgeAlpha(x, W);
          if (a <= 0) continue;
          const dt = Math.abs(ev.t - t);
          const pulse = Math.max(0, 1 - dt / (PULSE_S * 2));
          const strength = Math.max(0.25, Math.min(1, ev.strength || 0.5));
          // Jump position: stable scatter across the mid band per hit.
          const jy = yTop + hash01(Math.round(ev.t * 1000)) * (yBot - yTop);
          const r = (18 + strength * 36) * (1 + 0.7 * pulse);
          const g = ctx.createRadialGradient(x, jy, 0, x, jy, r);
          g.addColorStop(0, rgba(c, a * (0.35 + 0.4 * pulse)));
          g.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, jy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // ---- Layer 3: melody function line --------------------------------
      if (melody && melody.contour.length > 1) {
        const c = COLORS.other;
        const pts = melody.contour;
        let prev: { t: number; p: number; v: number } | null = null;
        for (const pt of pts) {
          if (pt.t < tMin || pt.t > tMax) {
            prev = pt.t < tMin ? pt : prev;
            if (pt.t > tMax) break;
            continue;
          }
          if (prev && pt.t - prev.t < 0.12) {
            const x1 = xOf(prev.t);
            const x2 = xOf(pt.t);
            const y1 = yOfPitch(prev.p);
            const y2 = yOfPitch(pt.p);
            const v = (prev.v + pt.v) / 2;
            const a = Math.min(edgeAlpha(x1, W), edgeAlpha(x2, W));
            if (a > 0) {
              ctx.strokeStyle = rgba(c, a * (0.45 + 0.55 * v));
              ctx.lineWidth = 1.5 + v * 6;
              ctx.shadowColor = rgba(c, a * 0.7 * v);
              ctx.shadowBlur = 8 * v;
              ctx.lineCap = "round";
              ctx.beginPath();
              ctx.moveTo(x1, y1);
              ctx.lineTo(x2, y2);
              ctx.stroke();
            }
          }
          prev = pt;
        }
        ctx.shadowBlur = 0;
      }

      // ---- Layer 4: kick + snare bouncing along the melody line ---------
      drawBouncers(ctx, byId("kick"), COLORS.kick, "ball", t, tMin, tMax, xOf, W, H, melodyYAt);
      drawBouncers(ctx, byId("snare"), COLORS.snare, "burst", t, tMin, tMax, xOf, W, H, melodyYAt);

      // ---- Layer 5: hi-hat falling ticks (front) ------------------------
      const hihat = byId("hihat");
      if (hihat) {
        const c = COLORS.hihat;
        for (const ev of hihat.events) {
          if (ev.t < tMin || ev.t > tMax) continue;
          const x = xOf(ev.t);
          const a = edgeAlpha(x, W);
          if (a <= 0) continue;
          const dt = Math.abs(ev.t - t);
          const pulse = Math.max(0, 1 - dt / PULSE_S);
          const strength = Math.max(0.3, Math.min(1, ev.strength || 0.5));
          // A thin tick that falls from the top; longer/brighter as it hits NOW.
          const top = yTop * 0.4 + (1 - pulse) * H * 0.06;
          const len = 14 + strength * 26 + pulse * 40;
          ctx.strokeStyle = rgba(c, a * (0.35 + 0.65 * pulse));
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(x, top);
          ctx.lineTo(x, top + len);
          ctx.stroke();
        }
      }

      // ---- NOW line + readouts ------------------------------------------
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(nowX, 0);
      ctx.lineTo(nowX, H);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("NOW", nowX + 6, 14);
      ctx.fillText(
        `${t.toFixed(1)}s / ${durationRef.current.toFixed(1)}s`,
        W - 110,
        H - 10,
      );

      // Legend (color chips only — no lane lines).
      let lx = 10;
      for (const el of els) {
        const c = COLORS[el.id] ?? [200, 200, 200];
        ctx.fillStyle = rgba(c, 0.9);
        ctx.fillRect(lx, 8, 9, 9);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        const label = el.label;
        ctx.fillText(label, lx + 13, 16);
        lx += 13 + ctx.measureText(label).width + 14;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="h-[60vh] w-full rounded-lg bg-[#0a0a0f]"
      data-testid="flow-visualizer"
    />
  );
}

/** Build a function that returns the melody-line y at a given time (or center). */
function makeMelodySampler(
  melody: VisualElement | null,
  yOfPitch: (p: number) => number,
  midY: number,
): (time: number) => number {
  if (!melody || melody.contour.length === 0) return () => midY;
  const c = melody.contour;
  return (time: number) => {
    // Binary search nearest contour point.
    let lo = 0;
    let hi = c.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (c[mid].t < time) lo = mid + 1;
      else hi = mid;
    }
    const pt = c[lo];
    if (!pt || Math.abs(pt.t - time) > 0.2) return midY;
    return yOfPitch(pt.p);
  };
}

/** Draw a percussive element bouncing along the melody line. */
function drawBouncers(
  ctx: CanvasRenderingContext2D,
  el: VisualElement | null | undefined,
  color: RGB,
  shape: "ball" | "burst",
  t: number,
  tMin: number,
  tMax: number,
  xOf: (time: number) => number,
  W: number,
  H: number,
  melodyYAt: (time: number) => number,
): void {
  if (!el) return;
  for (const ev of el.events) {
    if (ev.t < tMin || ev.t > tMax) continue;
    const x = xOf(ev.t);
    const a = edgeAlpha(x, W);
    if (a <= 0) continue;
    const dt = Math.abs(ev.t - t);
    const pulse = Math.max(0, 1 - dt / PULSE_S);
    const strength = Math.max(0.3, Math.min(1, ev.strength || 0.5));
    const baseY = melodyYAt(ev.t);
    const y = baseY - pulse * H * 0.07; // bounce up as it crosses NOW
    const r = (8 + strength * 12) * (0.7 + 0.5 * pulse);

    if (shape === "ball") {
      // Kick: solid ball with a soft halo.
      if (pulse > 0) {
        ctx.fillStyle = rgba(color, a * 0.25 * pulse);
        ctx.beginPath();
        ctx.arc(x, y, r * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgba(color, a);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Snare/clap: starburst of spokes.
      ctx.strokeStyle = rgba(color, a * (0.6 + 0.4 * pulse));
      ctx.lineWidth = 2;
      const spokes = 8;
      const R = r * (1.2 + 0.8 * pulse);
      ctx.beginPath();
      for (let i = 0; i < spokes; i++) {
        const ang = (i / spokes) * Math.PI * 2;
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(ang) * R, y + Math.sin(ang) * R);
      }
      ctx.stroke();
    }
  }
}
