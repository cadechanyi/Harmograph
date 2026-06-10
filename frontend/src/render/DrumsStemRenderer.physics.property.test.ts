import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  createBallPhysics,
  advanceBalls,
  resetOnKick,
  type BallPhysicsState,
} from "./DrumsStemRenderer";

/**
 * Property 17: Drum balls fall under constant acceleration and reset on kick onset.
 *
 * For any sequence of time steps with no intervening kick onset, each drum
 * ball's vertical position is non-decreasing (moving downward) consistent with
 * constant downward acceleration; and for any set of ball positions, a kick
 * onset resets every ball to the top of the active y-axis range.
 *
 * The canvas uses a top-left origin, so the "top of the active y-range" is the
 * smaller canvas y (`topY`) and "downward" means an increasing canvas y. The
 * physics core rests balls on the floor (`bottomY`) with zero velocity — a ball
 * already on the floor stays there, which is still non-decreasing.
 *
 * Validates: Requirements 5.2, 5.9
 */

// Feature: harmograph, Property 17: Drum balls fall under constant acceleration and reset on kick onset.

describe("DrumsStemRenderer physics — Property 17", () => {
  it("falls under constant acceleration (no kick) and resets every ball on kick onset", () => {
    fc.assert(
      fc.property(
        // Arbitrary ball count.
        fc.integer({ min: 1, max: 8 }),
        // Top of range (smaller canvas y) and a strictly-larger bottom (floor).
        fc.double({ min: 0, max: 500, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 2000, noNaN: true, noDefaultInfinity: true }),
        // Non-negative constant downward acceleration.
        fc.double({ min: 0, max: 50, noNaN: true, noDefaultInfinity: true }),
        // A sequence of positive time steps with no intervening kick.
        fc.array(
          fc.double({ min: 0.01, max: 5, noNaN: true, noDefaultInfinity: true }),
          { minLength: 1, maxLength: 30 },
        ),
        (count, topY, bottomGap, acceleration, dts) => {
          const bottomY = topY + bottomGap;

          // --- Falling under constant acceleration (no kick) ---
          let state = createBallPhysics(count, topY, bottomY, acceleration);

          // Initial state: every ball rests at the top with zero velocity.
          expect(state.balls).toHaveLength(count);
          for (const ball of state.balls) {
            expect(ball.y).toBe(topY);
            expect(ball.v).toBe(0);
          }

          let prev: BallPhysicsState = state;
          for (const dt of dts) {
            const next = advanceBalls(prev, dt);
            expect(next.balls).toHaveLength(count);

            for (let i = 0; i < count; i += 1) {
              const before = prev.balls[i];
              const after = next.balls[i];

              // Vertical position is non-decreasing (moving downward or resting).
              expect(after.y).toBeGreaterThanOrEqual(before.y);

              // Stays within the active y-range [topY, bottomY]; never past floor.
              expect(after.y).toBeGreaterThanOrEqual(topY);
              expect(after.y).toBeLessThanOrEqual(bottomY);
            }

            prev = next;
          }

          // --- Reset on kick onset ---
          // Start from the evolved positions (an arbitrary set of ball positions)
          // and apply a kick onset: every ball returns to the top with v = 0.
          const reset = resetOnKick(prev);
          expect(reset.balls).toHaveLength(count);
          for (const ball of reset.balls) {
            expect(ball.y).toBe(topY);
            expect(ball.v).toBe(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});
