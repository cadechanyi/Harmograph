"use client";

/**
 * FlowVisualizer — the Phase 2 "Geometry Dash" flow.
 *
 * Detected musical elements flow right-to-left through a fixed NOW line. Future
 * events spawn on the right, travel toward NOW, animate as they cross it (kick
 * balls bounce, snares flash, hi-hats tick, tonal stems flow as ribbons), then
 * fade out on the left. Only a short look-ahead window is shown so it feels
 * active. Driven by the song's playback clock via `getCurrentTime`.
 */

import { useEffect, useRef } from "react";

/** A single detected element with its full event / envelope track. */
export interface VisualElement {
  id: string;
  label: string;
  parent: string;
  kind: "percussive" | "tonal";
  events: { t: number; strength: number }[];
  envelope: { t: number; v: number }[];
}

export interface FlowVisualizerProps {
  elements: VisualElement[];
  /** Reads the live playback time in seconds. */
  getCurrentTime: () => number;
  /** Song duration in seconds (for the progress readout). */
  duration: number;
}

/** Per-element visual styling: color + the lane it occupies. */
interface LaneStyle {
  color: [number, number, number];
}

const STYLES: Record<string, LaneStyle> = {
  vocals: { color: [183, 148, 246] }, // purple — clouds
  other: { color: [110, 231, 183] }, // green — melody line
  guitar: { color: [251, 191, 36] },
  piano: { color: [244, 114, 182] },
  bass: { color: [90, 156, 255] }, // blue — wave
  kick: { color: [255, 90, 95] }, // red — bouncing ball
  snare: { color: [255, 209, 102] }, // amber — flash
  hihat: { color: [139, 233, 253] }, // cyan — tick
};

/** Preferred top-to-bottom lane order. */
const LANE_ORDER = [
  "vocals",
  "other",
  "guitar",
  "piano",
  "bass",
  "kick",
  "snare",
  "hihat",
];

/** Seconds of look-behind (left of NOW) is derived from nowX; these tune flow. */
const PX_PER_SEC = 150; // horizontal flow speed
const NOW_FRACTION = 0.3; // NOW line position from the left
const FADE_PX = 90; // edge fade width

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

/** Linear fade-in on the right edge, fade-out on the left edge. */
function edgeAlpha(x: number, width: number): number {
  const left = Math.min(1, Math.max(0, x / FADE_PX));
  const right = Math.min(1, Math.max(0, (width - x) / FADE_PX));
  return Math.min(left, right);
}

export function FlowVisualizer({
  elements,
  getCurrentTime,
  duration,
}: FlowVisualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep the latest props in refs so the rAF loop (started once) stays current.
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

      // Visible time window.
      const tBehind = nowX / PX_PER_SEC;
      const tAhead = (W - nowX) / PX_PER_SEC;
      const tMin = t - tBehind;
      const tMax = t + tAhead;
      const xOf = (time: number) => nowX + (time - t) * PX_PER_SEC;

      // Background.
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#0a0a0f";
      ctx.fillRect(0, 0, W, H);

      // Active lanes (only elements that are present), in preferred order.
      const orderOf = (id: string) => {
        const idx = LANE_ORDER.indexOf(id);
        return idx === -1 ? LANE_ORDER.length : idx;
      };
      const lanes = elementsRef.current
        .slice()
        .sort((a, b) => orderOf(a.id) - orderOf(b.id));
      const n = Math.max(1, lanes.length);
      const laneH = H / n;

      lanes.forEach((el, i) => {
        const cy = laneH * (i + 0.5);
        const style = STYLES[el.id] ?? { color: [200, 200, 200] };
        const color = style.color;

        // Lane label + faint baseline.
        ctx.fillStyle = rgba(color, 0.5);
        ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
        ctx.fillText(el.label, 8, cy - laneH * 0.32);
        ctx.strokeStyle = rgba(color, 0.08);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(W, cy);
        ctx.stroke();

        if (el.kind === "tonal") {
          drawTonal(ctx, el, color, cy, laneH, t, tMin, tMax, xOf, W);
        } else {
          drawPercussive(ctx, el, color, cy, laneH, t, tMin, tMax, xOf, W);
        }
      });

      // NOW line.
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(nowX, 0);
      ctx.lineTo(nowX, H);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("NOW", nowX + 6, 14);

      // Time readout.
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillText(
        `${t.toFixed(1)}s / ${durationRef.current.toFixed(1)}s`,
        W - 110,
        H - 10,
      );

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

/** Draw a percussive element's events as flowing shapes that animate at NOW. */
function drawPercussive(
  ctx: CanvasRenderingContext2D,
  el: VisualElement,
  color: [number, number, number],
  cy: number,
  laneH: number,
  t: number,
  tMin: number,
  tMax: number,
  xOf: (time: number) => number,
  W: number,
): void {
  const baseR = Math.min(18, laneH * 0.28);
  for (const ev of el.events) {
    if (ev.t < tMin || ev.t > tMax) continue;
    const x = xOf(ev.t);
    const alpha = edgeAlpha(x, W);
    if (alpha <= 0) continue;
    const strength = Math.max(0.2, Math.min(1, ev.strength || 0.5));
    const r = baseR * (0.6 + 0.4 * strength);

    // Proximity to NOW drives a bounce/flash as the event crosses.
    const dt = Math.abs(ev.t - t);
    const pulse = Math.max(0, 1 - dt / 0.18); // 1 at NOW, fades over 180ms
    const bounce = pulse * laneH * 0.32;

    if (el.id === "hihat") {
      // Hi-hat / tick: short vertical tick mark.
      ctx.strokeStyle = rgba(color, alpha * (0.5 + 0.5 * strength));
      ctx.lineWidth = 2;
      const h = r * (1 + pulse);
      ctx.beginPath();
      ctx.moveTo(x, cy - h);
      ctx.lineTo(x, cy + h);
      ctx.stroke();
    } else if (el.id === "snare") {
      // Snare / clap: diamond that flashes at NOW.
      ctx.fillStyle = rgba(color, alpha * (0.6 + 0.4 * pulse));
      ctx.save();
      ctx.translate(x, cy);
      ctx.rotate(Math.PI / 4);
      const s = r * (1 + 0.5 * pulse);
      ctx.fillRect(-s, -s, 2 * s, 2 * s);
      ctx.restore();
    } else {
      // Kick (and any other percussive): ball that bounces up at NOW.
      if (pulse > 0) {
        ctx.fillStyle = rgba(color, alpha * 0.25 * pulse);
        ctx.beginPath();
        ctx.arc(x, cy - bounce, r * 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = rgba(color, alpha);
      ctx.beginPath();
      ctx.arc(x, cy - bounce, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Draw a tonal element's loudness envelope as a flowing filled ribbon. */
function drawTonal(
  ctx: CanvasRenderingContext2D,
  el: VisualElement,
  color: [number, number, number],
  cy: number,
  laneH: number,
  t: number,
  tMin: number,
  tMax: number,
  xOf: (time: number) => number,
  W: number,
): void {
  const pts = el.envelope.filter((p) => p.t >= tMin && p.t <= tMax);
  const amp = laneH * 0.4;
  if (pts.length >= 2) {
    // Filled ribbon mirrored around the lane center.
    ctx.beginPath();
    ctx.moveTo(xOf(pts[0].t), cy - pts[0].v * amp);
    for (const p of pts) ctx.lineTo(xOf(p.t), cy - p.v * amp);
    for (let i = pts.length - 1; i >= 0; i--) {
      ctx.lineTo(xOf(pts[i].t), cy + pts[i].v * amp);
    }
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, rgba(color, 0));
    grad.addColorStop(0.3, rgba(color, 0.55));
    grad.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = grad;
    ctx.fill();
  }
  // Onset markers riding the ribbon.
  for (const ev of el.events) {
    if (ev.t < tMin || ev.t > tMax) continue;
    const x = xOf(ev.t);
    const alpha = edgeAlpha(x, W);
    if (alpha <= 0) continue;
    const dt = Math.abs(ev.t - t);
    const pulse = Math.max(0, 1 - dt / 0.18);
    ctx.fillStyle = rgba(color, alpha * (0.4 + 0.6 * pulse));
    ctx.beginPath();
    ctx.arc(x, cy, 2.5 + 3 * pulse, 0, Math.PI * 2);
    ctx.fill();
  }
}
