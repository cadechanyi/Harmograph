/**
 * Drums Stem_Renderer — the "bouncing balls" Graph_Style (Req 5.2, 5.9).
 *
 * The drums stem renders one or more ball elements that fall downward over time
 * under a CONSTANT downward acceleration (gravity), and reset to the TOP of the
 * active y-axis range whenever a kick onset is detected.
 *
 * Design note — pure physics core: the falling/reset behaviour is implemented as
 * a small set of PURE functions ({@link createBallPhysics}, {@link advanceBalls},
 * {@link resetOnKick}, {@link withBounds}, {@link isKickOnset}) operating on an
 * immutable {@link BallPhysicsState}. This keeps the physics independent of p5,
 * so it can be exercised directly by task 13.3's Property 17 without a canvas.
 * The {@link DrumsStemRenderer} class holds the live state and wires the pure
 * core to the {@link P5DrawTarget} surface, drawing each ball with `ellipse`.
 */

import type { CoordinateSystem } from "../coordinate";
import type { GraphStyle, StemType } from "../models";
import { BaseStemRenderer, type P5DrawTarget } from "./StemRenderer";

/** A single falling ball. `y` is canvas pixels (top-left origin); `v` is the
 * downward velocity in pixels per time-unit (positive = moving down). */
export interface Ball {
  y: number;
  v: number;
}

/**
 * Immutable state of the drum-ball physics. Canvas uses a top-left origin so
 * `topY <= bottomY`; balls fall from `topY` toward `bottomY` and rest there.
 */
export interface BallPhysicsState {
  /** The balls in vertical free-fall. */
  readonly balls: readonly Ball[];
  /** Constant downward acceleration (px per time-unit^2), `>= 0` (Req 5.2). */
  readonly acceleration: number;
  /** Canvas y of the top of the active y-range — the reset target (Req 5.9). */
  readonly topY: number;
  /** Canvas y of the bottom of the active y-range — the rest floor. */
  readonly bottomY: number;
}

/** Default constant downward acceleration in px per frame^2 (Req 5.2). */
export const DEFAULT_DRUM_ACCELERATION = 0.6;

/** Default ball count rendered for the drums stem ("one or more", Req 5.2). */
export const DEFAULT_DRUM_BALL_COUNT = 3;

/** Default ball diameter in canvas pixels. */
export const DEFAULT_DRUM_BALL_DIAMETER = 18;

/**
 * Default kick-onset threshold. A drums Timeline_Point whose `value` meets or
 * exceeds this is treated as a kick onset that resets every ball (Req 5.9).
 */
export const DEFAULT_KICK_THRESHOLD = 0.5;

/** Clamp `value` into the inclusive range `[min, max]`. */
function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Create an initial physics state with `count` balls resting at the top of the
 * range with zero velocity. `acceleration` is forced non-negative so balls only
 * ever accelerate downward (Req 5.2).
 */
export function createBallPhysics(
  count: number,
  topY: number,
  bottomY: number,
  acceleration: number = DEFAULT_DRUM_ACCELERATION,
): BallPhysicsState {
  const safeCount = Math.max(1, Math.floor(Number.isFinite(count) ? count : 1));
  const balls: Ball[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    balls.push({ y: topY, v: 0 });
  }
  return {
    balls,
    acceleration: Math.max(0, Number.isFinite(acceleration) ? acceleration : 0),
    topY,
    bottomY,
  };
}

/**
 * Advance the physics by one step of duration `dt` under constant downward
 * acceleration (semi-implicit Euler): `v' = v + a·dt`, `y' = y + v'·dt`. Each
 * ball is clamped to the floor (`bottomY`); a ball at the floor stays there with
 * zero velocity. Because `a >= 0` and balls start with `v >= 0`, velocity stays
 * non-negative and so every ball's `y` is NON-DECREASING (moving downward)
 * between resets (Req 5.2). Pure: returns a new state, mutating nothing.
 */
export function advanceBalls(
  state: BallPhysicsState,
  dt = 1,
): BallPhysicsState {
  const step = Number.isFinite(dt) && dt > 0 ? dt : 1;
  const balls = state.balls.map((ball) => {
    const v = ball.v + state.acceleration * step;
    const y = ball.y + v * step;
    if (y >= state.bottomY) {
      // Rest on the floor: no further downward motion until the next kick.
      return { y: state.bottomY, v: 0 };
    }
    return { y, v };
  });
  return { ...state, balls };
}

/**
 * Reset EVERY ball to the top of the active y-range with zero velocity. Invoked
 * on a detected kick onset (Req 5.9). Pure: returns a new state.
 */
export function resetOnKick(state: BallPhysicsState): BallPhysicsState {
  const balls = state.balls.map(() => ({ y: state.topY, v: 0 }));
  return { ...state, balls };
}

/**
 * Return a new state with updated top/bottom bounds (e.g. after the canvas
 * resizes or the y-unit changes), clamping each existing ball into the new
 * range. Pure: returns a new state.
 */
export function withBounds(
  state: BallPhysicsState,
  topY: number,
  bottomY: number,
): BallPhysicsState {
  const balls = state.balls.map((ball) => ({
    y: clamp(ball.y, topY, bottomY),
    v: ball.v,
  }));
  return { ...state, topY, bottomY, balls };
}

/**
 * Whether a drums Timeline_Point `value` represents a kick onset: its magnitude
 * meets or exceeds `threshold` (Req 5.9). Uses the absolute value so onsets in
 * a normalized `[-1, 1]` stream are detected regardless of sign.
 */
export function isKickOnset(
  value: number,
  threshold: number = DEFAULT_KICK_THRESHOLD,
): boolean {
  if (!Number.isFinite(value)) return false;
  return Math.abs(value) >= threshold;
}

/** Construction options for the drums renderer. */
export interface DrumsStemRendererOptions {
  /** Number of ball elements to render (defaults to {@link DEFAULT_DRUM_BALL_COUNT}). */
  ballCount?: number;
  /** Constant downward acceleration in px/frame^2 (defaults to {@link DEFAULT_DRUM_ACCELERATION}). */
  acceleration?: number;
  /** Ball diameter in canvas pixels (defaults to {@link DEFAULT_DRUM_BALL_DIAMETER}). */
  ballDiameter?: number;
  /** Kick-onset threshold (defaults to {@link DEFAULT_KICK_THRESHOLD}). */
  kickThreshold?: number;
}

/**
 * Drums Stem_Renderer: subclass of {@link BaseStemRenderer} overriding
 * {@link DrumsStemRenderer.drawElement} with the bouncing-balls style.
 *
 * It inherits the render-gating rule from the base class — {@link BaseStemRenderer.draw}
 * early-returns when disabled or when its received-point buffer is empty, so
 * `drawElement` (and thus any `ellipse` call) never runs without points
 * (Req 5.10, 6.5).
 *
 * Each frame `drawElement` runs the pure physics core: it consumes any newly
 * ingested Timeline_Points, resets the balls if one is a kick onset (Req 5.9),
 * advances the balls one step under constant acceleration (Req 5.2), then draws
 * each ball as an `ellipse` on the {@link P5DrawTarget}.
 */
export class DrumsStemRenderer extends BaseStemRenderer {
  private readonly ballCount: number;
  private readonly acceleration: number;
  private readonly ballDiameter: number;
  private readonly kickThreshold: number;

  /** Live physics state; lazily created once the bounds are known. */
  private physics: BallPhysicsState | null = null;

  /** Number of points already consumed for kick-onset detection. */
  private processedCount = 0;

  constructor(
    stem: StemType = "drums",
    style?: GraphStyle,
    options: DrumsStemRendererOptions = {},
  ) {
    super(stem, style);
    this.ballCount = options.ballCount ?? DEFAULT_DRUM_BALL_COUNT;
    this.acceleration = options.acceleration ?? DEFAULT_DRUM_ACCELERATION;
    this.ballDiameter = options.ballDiameter ?? DEFAULT_DRUM_BALL_DIAMETER;
    this.kickThreshold = options.kickThreshold ?? DEFAULT_KICK_THRESHOLD;
  }

  /** The current physics state (exposed for inspection/testing); may be null
   * before the first {@link DrumsStemRenderer.drawElement}. */
  getPhysics(): BallPhysicsState | null {
    return this.physics;
  }

  /**
   * Advance the simulation by one step for the given y-range bounds, processing
   * any pending kick onsets first. Separated from p5 drawing so it is testable
   * without a draw target. Returns the resulting state.
   */
  step(topY: number, bottomY: number, dt = 1): BallPhysicsState {
    // (Re)create or rebind the physics to the current bounds.
    if (!this.physics) {
      this.physics = createBallPhysics(
        this.ballCount,
        topY,
        bottomY,
        this.acceleration,
      );
    } else if (this.physics.topY !== topY || this.physics.bottomY !== bottomY) {
      this.physics = withBounds(this.physics, topY, bottomY);
    }

    // Consume newly ingested points; a kick onset resets every ball (Req 5.9).
    let kicked = false;
    for (let i = this.processedCount; i < this.points.length; i += 1) {
      if (isKickOnset(this.points[i].value, this.kickThreshold)) {
        kicked = true;
      }
    }
    this.processedCount = this.points.length;
    if (kicked) {
      this.physics = resetOnKick(this.physics);
    }

    // Advance under constant downward acceleration (Req 5.2).
    this.physics = advanceBalls(this.physics, dt);
    return this.physics;
  }

  /**
   * Draw the bouncing balls for the current frame. Only reached after the base
   * gating check, so the buffer is guaranteed non-empty here (Req 5.10).
   *
   * @param p - The p5 drawing target (real instance or mock).
   * @param cs - The active Coordinate_System; its active y-range top/bottom map
   *   to the canvas reset target and floor (Req 5.9).
   * @param playheadX - Current playhead x in canvas pixels (informational).
   */
  protected drawElement(
    p: P5DrawTarget,
    cs: CoordinateSystem,
    playheadX: number,
  ): void {
    void playheadX;
    const width = this.canvasWidth;
    const height = this.canvasHeight;

    // Top of the active y-range maps to the reset target; bottom is the floor.
    const [yMin, yMax] = cs.activeYRange();
    const topY = cs.yToCanvas(yMax, height);
    const bottomY = cs.yToCanvas(yMin, height);

    const state = this.step(topY, bottomY);

    p.push();
    p.noStroke();
    p.fill(120, 200, 255);
    const balls = state.balls;
    const count = balls.length;
    for (let i = 0; i < count; i += 1) {
      // Spread the balls evenly across the canvas width.
      const x = ((i + 0.5) / count) * width;
      p.ellipse(x, balls[i].y, this.ballDiameter, this.ballDiameter);
    }
    p.pop();
  }
}

/** Factory for a fresh drums Stem_Renderer. */
export function createDrumsStemRenderer(
  options?: DrumsStemRendererOptions,
): DrumsStemRenderer {
  return new DrumsStemRenderer("drums", undefined, options);
}
