import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { HarmographPage } from "./HarmographPage";

afterEach(cleanup);

/**
 * End-to-end pointer/keyboard event routing between the UI_Overlay and the
 * p5.js canvas (Req 11.1, 11.2, 11.3).
 *
 * This complements CanvasStage.pointerRouting.test.tsx (task 15.1), which
 * asserts the *class-based structure* of the layers. Here we mount the full
 * HarmographPage with its real state stores and exercise the *behavior*:
 * controls capture and act on their own events, and the canvas (the layer
 * beneath) can itself receive events.
 *
 * jsdom limitation (mirrors tasks 6.6 / 8.3): jsdom does not implement CSS
 * `pointer-events` hit-testing or geometric layout, so it cannot physically
 * route a click at an (x, y) screen point to whichever element is visually on
 * top. The browser contract that makes routing work is therefore validated in
 * two parts:
 *   - the structural contract (overlay `pointer-events: none`, controls
 *     `pointer-events: auto`, overlay stacked above canvas), and
 *   - the behavioral contract (a control's handler runs and its effect takes
 *     hold; events fired on a control never reach the canvas element; the
 *     canvas element does receive events dispatched at it directly).
 * Real cross-layer hit-testing is covered by manual / browser verification.
 */
describe("CanvasStage / UIOverlay pointer-event routing (integration)", () => {
  // -- Req 11.1: overlay stacks above the canvas and its controls are operable

  it("orders the overlay above the canvas within the shared stacking context (Req 11.1)", () => {
    render(<HarmographPage />);

    const stage = screen.getByTestId("canvas-stage");
    const canvas = screen.getByTestId("p5-canvas");
    const overlay = screen.getByTestId("ui-overlay");

    // Both layers live inside the same stacking context (relative isolate).
    expect(stage).toContainElement(canvas);
    expect(stage).toContainElement(overlay);
    expect(stage.className).toMatch(/\brelative\b/);
    expect(stage.className).toMatch(/\bisolate\b/);

    // The canvas (z-0) is painted first; the overlay (z-10) is painted after
    // and therefore renders on top. The overlay also follows the canvas in
    // document order, reinforcing the higher stacking order.
    expect(canvas.className).toMatch(/\bz-0\b/);
    expect(overlay.className).toMatch(/\bz-10\b/);
    expect(
      canvas.compareDocumentPosition(overlay) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps overlay controls present and operable over the canvas region (Req 11.1)", () => {
    render(<HarmographPage />);

    const overlay = screen.getByTestId("ui-overlay");

    // The overlay covers the whole stage (absolute inset-0) yet remains
    // transparent to pointer events except on its controls.
    expect(overlay.className).toMatch(/\babsolute\b/);
    expect(overlay.className).toMatch(/\binset-0\b/);

    // Representative controls render inside the overlay and are reachable —
    // i.e. operable over whatever the canvas draws beneath them.
    const seek = within(overlay).getByTestId("seek-input");
    const toggles = within(overlay).getAllByTestId("stem-toggle");
    expect(seek).toBeInTheDocument();
    expect(toggles.length).toBeGreaterThan(0);
  });

  // -- Req 11.2: control events are handled by the control, not the canvas

  it("handles a control's pointer/mouse/click events on the control and does not deliver them to the canvas (Req 11.2)", () => {
    render(<HarmographPage />);

    const canvas = screen.getByTestId("p5-canvas");
    const canvasHandler = vi.fn();
    canvas.addEventListener("pointerdown", canvasHandler);
    canvas.addEventListener("mousedown", canvasHandler);
    canvas.addEventListener("click", canvasHandler);

    // A stem toggle is always interactive (unlike play/pause, which is gated on
    // a loaded file). It carries pointer-events:auto, so the browser routes the
    // event to it rather than the canvas beneath.
    const firstToggle = screen.getAllByTestId("stem-toggle")[0];
    const checkbox = within(firstToggle).getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(true); // every stem starts enabled (Req 6.4)

    fireEvent.pointerDown(checkbox);
    fireEvent.mouseDown(checkbox);
    fireEvent.click(checkbox);

    // The control handled the interaction: its state flipped.
    expect(checkbox.checked).toBe(false);
    // The canvas received none of those events (they were not forwarded).
    expect(canvasHandler).not.toHaveBeenCalled();
  });

  it("handles a keyboard event on an interactive control without forwarding it to the canvas (Req 11.2)", () => {
    render(<HarmographPage />);

    const canvas = screen.getByTestId("p5-canvas");
    const canvasKeyHandler = vi.fn();
    canvas.addEventListener("keydown", canvasKeyHandler);

    const seek = screen.getByTestId("seek-input") as HTMLInputElement;
    seek.focus();
    fireEvent.keyDown(seek, { key: "ArrowRight" });

    // The keyboard event targeted the control; it never reached the canvas.
    expect(canvasKeyHandler).not.toHaveBeenCalled();
  });

  it("re-enables pointer events on the surrounding control surface so events stop at the control (Req 11.2)", () => {
    render(<HarmographPage />);

    const firstToggle = screen.getAllByTestId("stem-toggle")[0];
    const checkbox = within(firstToggle).getByRole("checkbox");

    // The checkbox (or an ancestor control surface) opts back into pointer
    // events — this is what makes the browser deliver the event here instead of
    // passing it through to the canvas.
    expect(checkbox.closest(".pointer-events-auto")).not.toBeNull();
  });

  // -- Req 11.3: empty-region events fall through to the canvas

  it("leaves the overlay container transparent to pointer events so empty regions fall through to the canvas (Req 11.3)", () => {
    render(<HarmographPage />);

    const overlay = screen.getByTestId("ui-overlay");

    // The container itself never captures pointer events; only its descendant
    // controls do. With pointer-events:none, the browser forwards events over
    // empty overlay regions to the element beneath (the canvas).
    expect(overlay.className).toMatch(/\bpointer-events-none\b/);
    expect(overlay.classList.contains("pointer-events-auto")).toBe(false);
  });

  it("delivers events to the canvas element that sits beneath the overlay (Req 11.3)", () => {
    render(<HarmographPage />);

    const canvas = screen.getByTestId("p5-canvas");
    const canvasHandler = vi.fn();
    canvas.addEventListener("pointerdown", canvasHandler);
    canvas.addEventListener("mousedown", canvasHandler);

    // jsdom cannot hit-test through the pointer-events:none overlay, so we
    // dispatch directly at the canvas (the element a real browser would forward
    // an empty-region event to) and confirm it is a live event target.
    fireEvent.pointerDown(canvas);
    fireEvent.mouseDown(canvas);

    expect(canvasHandler).toHaveBeenCalledTimes(2);
  });
});
