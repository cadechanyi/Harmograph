import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { HarmographPage } from "./HarmographPage";
import { STEM_TYPES } from "@/models";

afterEach(cleanup);

describe("HarmographPage component tree", () => {
  it("mounts the full tree without errors", () => {
    render(<HarmographPage />);
    // Stage, canvas, and overlay all mount.
    expect(screen.getByTestId("canvas-stage")).toBeInTheDocument();
    expect(screen.getByTestId("p5-canvas")).toBeInTheDocument();
    expect(screen.getByTestId("ui-overlay")).toBeInTheDocument();
    // Representative child panels mount.
    expect(screen.getByTestId("tempo-key-readout")).toBeInTheDocument();
    expect(screen.getByTestId("coordinate-unit-picker")).toBeInTheDocument();
  });

  it("renders exactly five stem toggles, one per StemType (Req 6.3)", () => {
    render(<HarmographPage />);
    const toggles = screen.getAllByTestId("stem-toggle");
    expect(toggles).toHaveLength(5);
    expect(toggles).toHaveLength(STEM_TYPES.length);

    // Exactly one toggle per StemType, with no duplicates or extras.
    const renderedStems = toggles
      .map((el) => el.getAttribute("data-stem"))
      .sort();
    expect(renderedStems).toEqual([...STEM_TYPES].sort());
  });

  it("initializes every stem toggle to enabled on mount (Req 6.4)", () => {
    render(<HarmographPage />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(5);
    for (const checkbox of checkboxes) {
      expect(checkbox).toBeChecked();
    }
  });
});
