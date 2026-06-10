import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  cleanup,
  within,
  renderHook,
  act,
} from "@testing-library/react";
import {
  STEM_TYPES,
  DEFAULT_STYLE,
  type GraphStyle,
  type StemType,
  type YUnit,
} from "@/models";
import { GraphStylePanel } from "./GraphStylePanel";
import { GraphStylePicker, availableStyles } from "./GraphStylePicker";
import { StemTogglePanel } from "./StemTogglePanel";
import { CoordinateUnitPicker } from "./CoordinateUnitPicker";
import { createInitialStemConfig, useStemConfigStore } from "@/stores";
import { createCoordinateSystem } from "@/coordinate";

/**
 * Task 15.6 — unit/example tests for toggle and style picker behaviors.
 *
 * These complement the property tests (15.3–15.5) and the baseline
 * overlayControls.test.tsx by exercising concrete behaviors:
 *   - Toggle initialization: every stem enabled on load (Req 6.4)
 *   - Style picker presence (Req 7.1) and listing every defined style (Req 7.3)
 *   - Disabled-when-data-missing across a mixed-availability panel (Req 7.4)
 *   - Selections applied to subsequent frames via the store (Req 7.2)
 *   - Coordinate-unit changes applied to subsequent frames (Req 9.6)
 */

afterEach(cleanup);

describe("toggle initialization — all stems enabled on load (Req 6.4)", () => {
  it("createInitialStemConfig() enables every stem with its default style", () => {
    const config = createInitialStemConfig();
    for (const stem of STEM_TYPES) {
      expect(config[stem].enabled).toBe(true);
      expect(config[stem].style).toBe(DEFAULT_STYLE[stem]);
    }
  });

  it("a freshly loaded stem-config store reports every stem enabled", () => {
    const { result } = renderHook(() => useStemConfigStore());
    for (const stem of STEM_TYPES) {
      expect(result.current.config[stem].enabled).toBe(true);
    }
  });

  it("a freshly loaded StemTogglePanel renders five checked toggles", () => {
    render(
      <StemTogglePanel config={createInitialStemConfig()} onToggle={() => {}} />,
    );
    const toggles = screen.getAllByTestId("stem-toggle");
    expect(toggles).toHaveLength(STEM_TYPES.length);
    for (const toggle of toggles) {
      expect(within(toggle).getByRole("checkbox")).toBeChecked();
    }
  });
});

describe("style picker presence and listing (Req 7.1, 7.3)", () => {
  it("GraphStylePanel renders exactly one select per StemType (Req 7.1)", () => {
    render(
      <GraphStylePanel
        config={createInitialStemConfig()}
        hasPoints={() => true}
        onSelect={() => {}}
      />,
    );
    for (const stem of STEM_TYPES) {
      expect(screen.getByLabelText(`Graph style for ${stem}`)).toBeInTheDocument();
    }
  });

  it("each picker lists every defined style for its stem (Req 7.3)", () => {
    for (const stem of STEM_TYPES) {
      render(
        <GraphStylePicker
          stem={stem}
          style={DEFAULT_STYLE[stem]}
          hasData
          onSelect={() => {}}
        />,
      );
      const select = screen.getByLabelText(
        `Graph style for ${stem}`,
      ) as HTMLSelectElement;
      const optionValues = Array.from(select.options).map((o) => o.value);
      // MVP: exactly the styles defined for the stem (the single default).
      expect(optionValues).toEqual(availableStyles(stem));
      cleanup();
    }
  });
});

describe("style availability across a mixed-data panel (Req 7.4)", () => {
  it("disables only the pickers whose stem has no data and enables the rest", () => {
    // drums + bass have data; the other three do not.
    const withData = new Set<StemType>(["drums", "bass"]);
    render(
      <GraphStylePanel
        config={createInitialStemConfig()}
        hasPoints={(stem) => withData.has(stem)}
        onSelect={() => {}}
      />,
    );
    for (const stem of STEM_TYPES) {
      const select = screen.getByLabelText(
        `Graph style for ${stem}`,
      ) as HTMLSelectElement;
      if (withData.has(stem)) {
        expect(select).not.toBeDisabled();
      } else {
        expect(select).toBeDisabled();
      }
    }
  });

  it("does not invoke onSelect when changing a data-missing picker (Req 7.4)", () => {
    const onSelect = vi.fn();
    render(
      <GraphStylePicker
        stem="vocals"
        style={DEFAULT_STYLE.vocals}
        hasData={false}
        onSelect={onSelect}
      />,
    );
    const select = screen.getByLabelText("Graph style for vocals");
    fireEvent.change(select, { target: { value: DEFAULT_STYLE.vocals } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("invokes onSelect with the chosen style once data is available (Req 7.2)", () => {
    const onSelect = vi.fn();
    render(
      <GraphStylePicker
        stem="bass"
        style={DEFAULT_STYLE.bass}
        hasData
        onSelect={onSelect}
      />,
    );
    const select = screen.getByLabelText("Graph style for bass");
    fireEvent.change(select, { target: { value: DEFAULT_STYLE.bass } });
    expect(onSelect).toHaveBeenCalledWith("bass", DEFAULT_STYLE.bass);
  });
});

describe("style changes applied to subsequent frames via the store (Req 7.2)", () => {
  it("setStemStyle updates only the target stem's style so the next read uses it", () => {
    const { result } = renderHook(() => useStemConfigStore());

    const nextStyle: GraphStyle = "sine_wave";
    expect(result.current.config.drums.style).toBe(DEFAULT_STYLE.drums);

    act(() => {
      result.current.setStemStyle("drums", nextStyle);
    });

    // The store is the source the renderer reads each frame: the subsequent
    // read reflects the new style for the target stem only.
    expect(result.current.config.drums.style).toBe(nextStyle);
    for (const stem of STEM_TYPES) {
      if (stem === "drums") continue;
      expect(result.current.config[stem].style).toBe(DEFAULT_STYLE[stem]);
    }
  });

  it("a panel reads each stem's style from the config it is given each frame", () => {
    // The renderer rebuilds the panel from the current config every frame, so
    // the picker value always reflects config[stem].style (Req 7.2). MVP defines
    // one style per stem, so the configured style is each stem's default.
    const { rerender } = render(
      <GraphStylePanel
        config={createInitialStemConfig()}
        hasPoints={() => true}
        onSelect={() => {}}
      />,
    );
    for (const stem of STEM_TYPES) {
      const select = screen.getByLabelText(
        `Graph style for ${stem}`,
      ) as HTMLSelectElement;
      expect(select.value).toBe(DEFAULT_STYLE[stem]);
    }

    // A subsequent frame driven by a fresh config object renders consistently:
    // the picker re-reads the (same MVP) style from the new config.
    rerender(
      <GraphStylePanel
        config={createInitialStemConfig()}
        hasPoints={() => true}
        onSelect={() => {}}
      />,
    );
    expect(
      (screen.getByLabelText("Graph style for chords") as HTMLSelectElement).value,
    ).toBe(DEFAULT_STYLE.chords);
  });
});

describe("coordinate-unit changes applied to subsequent frames (Req 9.6)", () => {
  it("the picker reports the newly selected y-unit", () => {
    const onSelect = vi.fn();
    render(<CoordinateUnitPicker unit="normalized" onSelect={onSelect} />);
    fireEvent.change(screen.getByTestId("coordinate-unit-picker"), {
      target: { value: "midi" },
    });
    expect(onSelect).toHaveBeenCalledWith("midi" satisfies YUnit);
  });

  it("feeding the selected unit to the Coordinate_System changes its active y-range", () => {
    // Models HarmographPage forwarding the picker's selection to the
    // Coordinate_System used on the next frame (Req 9.6).
    const coords = createCoordinateSystem();
    expect(coords.activeYRange()).toEqual([-1, 1]); // default normalized

    let selected: YUnit = "normalized";
    const onSelect = (unit: YUnit) => {
      selected = unit;
      coords.setYUnit(unit);
    };
    render(<CoordinateUnitPicker unit={selected} onSelect={onSelect} />);

    fireEvent.change(screen.getByTestId("coordinate-unit-picker"), {
      target: { value: "hz" },
    });
    expect(selected).toBe("hz");
    // The subsequent frame's coordinate mapping uses the Hz range.
    expect(coords.activeYRange()).toEqual([20, 20000]);
  });
});
