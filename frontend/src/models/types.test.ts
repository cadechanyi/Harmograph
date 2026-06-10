import { describe, it, expect } from "vitest";
import {
  DEMUCS_TO_STEM,
  DEFAULT_STYLE,
  type StemType,
  type DemucsStem,
  type GraphStyle,
} from "./types";

const STEM_TYPES: StemType[] = ["drums", "melody", "bass", "vocals", "chords"];
const DEMUCS_STEMS: DemucsStem[] = ["drums", "bass", "vocals", "other"];

describe("DEMUCS_TO_STEM", () => {
  it("maps the four Demucs stems, with `other` routed to melody (Req 4.9)", () => {
    expect(DEMUCS_TO_STEM).toEqual({
      drums: "drums",
      bass: "bass",
      vocals: "vocals",
      other: "melody",
    });
  });

  it("covers exactly the four Demucs stems", () => {
    expect(Object.keys(DEMUCS_TO_STEM).sort()).toEqual(
      [...DEMUCS_STEMS].sort(),
    );
  });

  it("never routes any Demucs stem to chords (Req 4.10)", () => {
    for (const target of Object.values(DEMUCS_TO_STEM)) {
      expect(target).not.toBe("chords");
    }
  });
});

describe("DEFAULT_STYLE", () => {
  it("defines the table default style per stem (Req 7.6)", () => {
    const expected: Record<StemType, GraphStyle> = {
      drums: "bouncing_balls",
      melody: "parametric_curve",
      bass: "sine_wave",
      vocals: "rms_envelope",
      chords: "stacked_curves",
    };
    expect(DEFAULT_STYLE).toEqual(expected);
  });

  it("defines exactly one default for each of the five stems (Req 6.3)", () => {
    expect(Object.keys(DEFAULT_STYLE).sort()).toEqual([...STEM_TYPES].sort());
  });
});
