import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import { STEM_TYPES, DEFAULT_STYLE, type StemType } from "@/models";
import {
  GraphStylePicker,
  styleOptions,
  resolveStyle,
} from "./GraphStylePicker";
import { GraphStylePanel } from "./GraphStylePanel";
import { StemTogglePanel } from "./StemTogglePanel";
import { CoordinateUnitPicker } from "./CoordinateUnitPicker";
import { createInitialStemConfig } from "@/stores";

afterEach(cleanup);

describe("GraphStylePicker data availability (Req 7.3, 7.4)", () => {
  it("disables the style and blocks selection when the stem has no data", () => {
    const onSelect = vi.fn();
    render(
      <GraphStylePicker
        stem="drums"
        style={DEFAULT_STYLE.drums}
        hasData={false}
        onSelect={onSelect}
      />,
    );
    const select = screen.getByLabelText("Graph style for drums") as HTMLSelectElement;
    // No data -> the only style is not selectable, so the control is disabled.
    expect(select).toBeDisabled();
    // Attempting to change does not apply a disabled style.
    fireEvent.change(select, { target: { value: DEFAULT_STYLE.drums } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("applies a selection once the stem's data is available (Req 7.2)", () => {
    const onSelect = vi.fn();
    render(
      <GraphStylePicker
        stem="melody"
        style={DEFAULT_STYLE.melody}
        hasData
        onSelect={onSelect}
      />,
    );
    const select = screen.getByLabelText("Graph style for melody") as HTMLSelectElement;
    expect(select).not.toBeDisabled();
    fireEvent.change(select, { target: { value: DEFAULT_STYLE.melody } });
    expect(onSelect).toHaveBeenCalledWith("melody", DEFAULT_STYLE.melody);
  });
});

describe("style option/resolution helpers (Req 7.4, 7.5, 7.6)", () => {
  it("marks every defined style available iff the stem has data", () => {
    for (const stem of STEM_TYPES) {
      expect(styleOptions(stem, false)).toEqual([
        { style: DEFAULT_STYLE[stem], available: false },
      ]);
      expect(styleOptions(stem, true)).toEqual([
        { style: DEFAULT_STYLE[stem], available: true },
      ]);
    }
  });

  it("resolves an unselected stem to its table default (Req 7.5, 7.6)", () => {
    for (const stem of STEM_TYPES) {
      expect(resolveStyle(stem)).toBe(DEFAULT_STYLE[stem]);
      expect(resolveStyle(stem, undefined)).toBe(DEFAULT_STYLE[stem]);
    }
  });
});

describe("GraphStylePanel presents a picker per stem (Req 7.1)", () => {
  it("renders exactly one picker for each StemType", () => {
    render(
      <GraphStylePanel
        config={createInitialStemConfig()}
        hasPoints={() => true}
        onSelect={() => {}}
      />,
    );
    const pickers = screen.getAllByTestId("graph-style-picker");
    expect(pickers.map((el) => el.getAttribute("data-stem")).sort()).toEqual(
      [...STEM_TYPES].sort(),
    );
  });
});

describe("StemTogglePanel toggle isolation (Req 6.1, 6.2, 6.3, 6.4)", () => {
  it("presents five enabled toggles and flips only the toggled stem", () => {
    const onToggle = vi.fn();
    render(
      <StemTogglePanel config={createInitialStemConfig()} onToggle={onToggle} />,
    );
    const toggles = screen.getAllByTestId("stem-toggle");
    expect(toggles).toHaveLength(5);
    // All enabled on load (Req 6.4).
    for (const t of toggles) {
      expect(within(t).getByRole("checkbox")).toBeChecked();
    }
    // Toggling drums invokes the handler for drums only (Req 6.1).
    const drums = toggles.find((t) => t.getAttribute("data-stem") === "drums")!;
    fireEvent.click(within(drums).getByRole("checkbox"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("drums" satisfies StemType);
  });
});

describe("CoordinateUnitPicker drives the y-unit (Req 9.6)", () => {
  it("reports the selected y-unit", () => {
    const onSelect = vi.fn();
    render(<CoordinateUnitPicker unit="normalized" onSelect={onSelect} />);
    const select = screen.getByTestId("coordinate-unit-picker");
    fireEvent.change(select, { target: { value: "hz" } });
    expect(onSelect).toHaveBeenCalledWith("hz");
  });
});
