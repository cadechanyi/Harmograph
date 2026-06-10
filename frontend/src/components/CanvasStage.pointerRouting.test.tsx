import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { HarmographPage } from "./HarmographPage";

afterEach(cleanup);

/**
 * Pointer-event routing and stacking order (Req 11.1, 11.2, 11.3).
 *
 * These assertions cover the overlay structure established in task 15.1: the
 * overlay stacks above the canvas, its container forwards empty-region events
 * to the canvas (`pointer-events: none`), and each interactive control captures
 * its own events (`pointer-events: auto`). The end-to-end event integration
 * test lives in task 15.7.
 */
describe("CanvasStage / UIOverlay pointer-event routing", () => {
  it("stacks the overlay above the canvas within a shared stacking context (Req 11.1)", () => {
    render(<HarmographPage />);

    const stage = screen.getByTestId("canvas-stage");
    const canvas = screen.getByTestId("p5-canvas");
    const overlay = screen.getByTestId("ui-overlay");

    // Stage establishes a stacking context so child z-indices are comparable.
    expect(stage.className).toMatch(/\brelative\b/);
    expect(stage.className).toMatch(/\bisolate\b/);

    // Canvas sits at z-0, overlay at z-10 → overlay renders above the canvas.
    expect(canvas.className).toMatch(/\bz-0\b/);
    expect(overlay.className).toMatch(/\bz-10\b/);

    // Both layers are absolutely positioned over the stage.
    expect(canvas.className).toMatch(/\babsolute\b/);
    expect(overlay.className).toMatch(/\babsolute\b/);
  });

  it("gives the overlay container pointer-events:none so empty regions fall through to the canvas (Req 11.3)", () => {
    render(<HarmographPage />);

    const overlay = screen.getByTestId("ui-overlay");
    expect(overlay.className).toMatch(/\bpointer-events-none\b/);
  });

  it("gives every interactive control pointer-events:auto so its events are not forwarded to the canvas (Req 11.2)", () => {
    render(<HarmographPage />);

    const overlay = screen.getByTestId("ui-overlay");

    // Walk the overlay subtree and collect interactive elements (and the
    // control surfaces that wrap them).
    const interactive = Array.from(
      overlay.querySelectorAll<HTMLElement>(
        "button, input, select, label, [role='status']",
      ),
    );

    // Sanity: the overlay actually contains controls to verify.
    expect(interactive.length).toBeGreaterThan(0);

    // Every interactive element must have pointer-events re-enabled either on
    // itself or on an ancestor control surface within the overlay.
    for (const el of interactive) {
      let node: HTMLElement | null = el;
      let reEnabled = false;
      while (node && node !== overlay) {
        if (node.className?.toString().includes("pointer-events-auto")) {
          reEnabled = true;
          break;
        }
        node = node.parentElement;
      }
      expect(reEnabled).toBe(true);
    }
  });

  it("re-enables pointer events on each control panel surface (Req 11.2)", () => {
    render(<HarmographPage />);

    // Representative panels: each is a control surface that must capture events.
    const playpause = screen.getByTestId("playpause-button");
    const seek = screen.getByTestId("seek-input");
    const unitPicker = screen.getByTestId("coordinate-unit-picker");
    const uploadInput = screen.getByTestId("upload-input");

    for (const control of [playpause, seek, unitPicker, uploadInput]) {
      // The control or one of its overlay ancestors enables pointer-events.
      const surface = control.closest(".pointer-events-auto");
      expect(surface).not.toBeNull();
    }
  });

  it("does not leak pointer-events:auto onto the overlay container itself (Req 11.3)", () => {
    render(<HarmographPage />);

    const overlay = screen.getByTestId("ui-overlay");
    // The container itself must remain transparent to pointer events; only its
    // descendants opt back in.
    expect(overlay.classList.contains("pointer-events-auto")).toBe(false);

    // The stem toggle panel is a descendant control surface that opts in.
    const togglePanel = within(overlay).getAllByTestId("stem-toggle")[0];
    expect(togglePanel.closest(".pointer-events-auto")).not.toBeNull();
  });
});
