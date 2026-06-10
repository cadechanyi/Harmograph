"use client";

/**
 * FlowVisualizer — the Harmograph flow.
 *
 * One shared graph (no per-element lanes): time flows right-to-left through a
 * fixed NOW line; the vertical axis is musical pitch/height shared by every
 * element so they overlap and interact. Everything is *always in motion* (a
 * continuous animation clock drives waves, pulses and orbits) and every element
 * ramps to peak intensity — size, opacity, glow — as it reaches the NOW line.
 *
 * Layered back-to-front:
 *   vocals  — a soft cloud behind everything, breathing with vocal loudness
 *   bass    — large blobs that pulse and swell, peaking on bass hits at NOW
 *   melody  — a continuous wave line following pitch, undulating + brighter and
 *             thicker toward NOW
 *   kick    — a ball that dances around + bounces along the melody line at NOW
 *   snare   — a starburst that spins + flares at NOW
 *   hihat   — thin ticks that fall and flash at NOW
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
const NOW_RANGE = 160; // px around NOW over which intensity ramps to its peak

function rgba(c: RGB, a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.max(0, Math.min(1, a))})`;
}

function edgeAlpha(x: number, width: number): number {
  const left = Math.min(1, Math.max(0, x / FADE_PX));
  const right = Math.min(1, Math.max(0, (width - x) / FADE_PX));
  return Math.min(left, right);
}

function smooth(u: number): number {
  const c = Math.max(0, Math.min(1, u));
  return c * c * (3 - 2 * c);
}

/** Stable pseudo-random in [0,1) from a number (for scatter/phase seeds). */
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

    const ensureSize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width * dpr));
      const h = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return rect;
    };

    const draw = () => {
      if (!running) return;
      const rect = ensureSize();
      const W = rect.width;
      const H = rect.height;
      const t = timeRef.current();
      const ph = performance.now() / 1000; // continuous animation phase
      const nowX = W * NOW_FRACTION;
      const tBehind = nowX / PX_PER_SEC;
      const tAhead = (W - nowX) / PX_PER_SEC;
      const tMin = t - tBehind;
      const tMax = t + tAhead;
      const xOf = (time: number) => nowX + (time - t) * PX_PER_SEC;
      // Spatial highlight: peaks at the NOW line, smoothly falls off either side.
      const glowAt = (x: number) => smooth(1 - Math.abs(x - nowX) / NOW_RANGE);

      const yTop = H * 0.12;
      const yBot = H * 0.9;
      const yOfPitch = (p: number) => yBot - Math.max(0, Math.min(1, p)) * (yBot - yTop);
      const midY = (yTop + yBot) / 2;

      const els = elementsRef.current;
      const byId = (id: string) => els.find((e) => e.id === id);

      ctx.clearRect(0, 0, W, H);
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, "#0b0b12");
      bg.addColorStop(1, "#07070b");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      const melody = byId("other") ?? byId("guitar") ?? byId("piano") ?? null;
      const melodyYAt = makeMelodySampler(melody, yOfPitch, midY);

      // ---- Layer 1: vocals cloud (behind everything) --------------------
      const vocals = byId("vocals");
      if (vocals) {
        ctx.globalCompositeOperation = "lighter";
        const c = COLORS.vocals;
        const cyBase = midY + H * 0.12;
        for (const pt of vocals.envelope) {
          if (pt.t < tMin || pt.t > tMax) continue;
          const x = xOf(pt.t);
          const a = edgeAlpha(x, W);
          if (a <= 0) continue;
          const gl = glowAt(x);
          const breathe = 0.85 + 0.15 * Math.sin(ph * 1.7 + pt.t * 2.5);
          const cy = cyBase + Math.sin(ph * 0.8 + pt.t) * H * 0.02;
          const r = (36 + pt.v * Math.min(W, H) * 0.26) * (1 + 0.6 * gl) * breathe;
          const g = ctx.createRadialGradient(x, cy, 0, x, cy, r);
          g.addColorStop(0, rgba(c, a * (0.14 + 0.4 * gl) * (0.4 + pt.v)));
          g.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, cy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // ---- Layer 2: bass blobs (always pulsing, swell + peak at NOW) -----
      const bass = byId("bass");
      if (bass) {
        const c = COLORS.bass;
        ctx.globalCompositeOperation = "lighter";
        for (const ev of bass.events) {
          if (ev.t < tMin || ev.t > tMax) continue;
          const x = xOf(ev.t);
          const a = edgeAlpha(x, W);
          if (a <= 0) continue;
          const gl = glowAt(x);
          const seed = Math.round(ev.t * 1000);
          const strength = Math.max(0.25, Math.min(1, ev.strength || 0.5));
          // Always-on pulsation + drift; intensity peaks at NOW.
          const pulse = 0.8 + 0.2 * Math.sin(ph * 4 + seed);
          const jy =
            yTop +
            hash01(seed) * (yBot - yTop) +
            Math.sin(ph * 1.5 + seed) * H * 0.03;
          const r = (16 + strength * 30) * (0.8 + 1.1 * gl) * pulse;
          const g = ctx.createRadialGradient(x, jy, 0, x, jy, r);
          g.addColorStop(0, rgba(c, a * (0.28 + 0.5 * gl)));
          g.addColorStop(1, rgba(c, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.arc(x, jy, r, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
      }

      // ---- Layer 3: melody wave line ------------------------------------
      if (melody && melody.contour.length > 1) {
        const c = COLORS.other;
        const pts = melody.contour;
        // Vertical wobble keeps the line alive everywhere, larger toward NOW.
        const wobAt = (x: number, tt: number) =>
          Math.sin(ph * 2.6 + tt * 5) * (3 + 16 * glowAt(x));
        let prev: { t: number; p: number; v: number } | null = null;
        for (const pt of pts) {
          if (pt.t < tMin || pt.t > tMax) {
            if (pt.t < tMin) prev = pt;
            if (pt.t > tMax) break;
            continue;
          }
          if (prev && pt.t - prev.t < 0.12) {
            const x1 = xOf(prev.t);
            const x2 = xOf(pt.t);
            const y1 = yOfPitch(prev.p) + wobAt(x1, prev.t);
            const y2 = yOfPitch(pt.p) + wobAt(x2, pt.t);
            const v = (prev.v + pt.v) / 2;
            const gl = glowAt((x1 + x2) / 2);
            const a = Math.min(edgeAlpha(x1, W), edgeAlpha(x2, W));
            if (a > 0) {
              ctx.strokeStyle = rgba(c, a * (0.4 + 0.5 * v + 0.4 * gl));
              ctx.lineWidth = 1.5 + v * 5 + gl * 6;
              ctx.shadowColor = rgba(c, a * (0.4 + 0.6 * gl));
              ctx.shadowBlur = 6 + 16 * gl;
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

      // ---- Layer 4: kick + snare dancing along the melody line ----------
      drawBouncers(ctx, byId("kick"), COLORS.kick, "ball", ph, tMin, tMax, xOf, glowAt, W, H, melodyYAt);
      drawBouncers(ctx, byId("snare"), COLORS.snare, "burst", ph, tMin, tMax, xOf, glowAt, W, H, melodyYAt);

      // ---- Layer 5: hi-hat falling ticks (front) ------------------------
      const hihat = byId("hihat");
      if (hihat) {
        const c = COLORS.hihat;
        for (const ev of hihat.events) {
          if (ev.t < tMin || ev.t > tMax) continue;
          const x = xOf(ev.t);
          const a = edgeAlpha(x, W);
          if (a <= 0) continue;
          const gl = glowAt(x);
          const seed = Math.round(ev.t * 1000);
          const strength = Math.max(0.3, Math.min(1, ev.strength || 0.5));
          const sway = Math.sin(ph * 3 + seed) * 3; // gentle horizontal shimmer
          const top = yTop * 0.4 + (1 - gl) * H * 0.05;
          const len = 12 + strength * 22 + gl * 46;
          ctx.strokeStyle = rgba(c, a * (0.3 + 0.7 * gl));
          ctx.lineWidth = 1.5 + gl * 1.5;
          ctx.beginPath();
          ctx.moveTo(x + sway, top);
          ctx.lineTo(x + sway, top + len);
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

      let lx = 10;
      for (const el of els) {
        const c = COLORS[el.id] ?? [200, 200, 200];
        ctx.fillStyle = rgba(c, 0.9);
        ctx.fillRect(lx, 8, 9, 9);
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillText(el.label, lx + 13, 16);
        lx += 13 + ctx.measureText(el.label).width + 14;
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="block h-[60vh] w-full rounded-lg bg-[#0a0a0f]"
      data-testid="flow-visualizer"
    />
  );
}

function makeMelodySampler(
  melody: VisualElement | null,
  yOfPitch: (p: number) => number,
  midY: number,
): (time: number) => number {
  if (!melody || !melody.contour || melody.contour.length === 0) return () => midY;
  const c = melody.contour;
  return (time: number) => {
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

/** Draw a percussive element dancing around + bouncing along the melody line. */
function drawBouncers(
  ctx: CanvasRenderingContext2D,
  el: VisualElement | null | undefined,
  color: RGB,
  shape: "ball" | "burst",
  ph: number,
  tMin: number,
  tMax: number,
  xOf: (time: number) => number,
  glowAt: (x: number) => number,
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
    const gl = glowAt(x);
    const seed = Math.round(ev.t * 1000);
    const strength = Math.max(0.3, Math.min(1, ev.strength || 0.5));

    // Dance: orbit around the point on the line; bounce up + grow toward NOW.
    const ang = ph * 3 + hash01(seed) * Math.PI * 2;
    const danceR = 3 + 9 * gl;
    const baseY = melodyYAt(ev.t);
    const cx = x + Math.cos(ang) * danceR * 0.6;
    const cy = baseY + Math.sin(ang) * danceR - gl * H * 0.08;
    const r = (7 + strength * 11) * (0.7 + 0.9 * gl);

    if (shape === "ball") {
      if (gl > 0) {
        ctx.fillStyle = rgba(color, a * 0.3 * gl);
        ctx.beginPath();
        ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgba(color, a * (0.6 + 0.4 * gl));
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.strokeStyle = rgba(color, a * (0.5 + 0.5 * gl));
      ctx.lineWidth = 2;
      const spokes = 8;
      const R = r * (1.2 + 1.0 * gl);
      const spin = ph * 2 + hash01(seed) * Math.PI; // always spinning
      ctx.beginPath();
      for (let i = 0; i < spokes; i++) {
        const sa = spin + (i / spokes) * Math.PI * 2;
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(sa) * R, cy + Math.sin(sa) * R);
      }
      ctx.stroke();
    }
  }
}
