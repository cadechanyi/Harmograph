import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TempoKeyReadout } from "./TempoKeyReadout";
import {
  PENDING_INDICATOR,
  KEY_PLACEHOLDER,
} from "./tempoKeyReadout.logic";
import type { AnalysisStatus, FeatureName } from "@/stores";

afterEach(cleanup);

const ALL: FeatureName[] = ["rms", "spectral", "tempo", "key", "melody", "chords"];

/**
 * Build an AnalysisStatus where every feature defaults to succeeded. Callers
 * override `pending`/`succeeded`/`tempoBpm`/`key` for the scenario under test.
 */
function makeStatus(overrides: Partial<AnalysisStatus> = {}): AnalysisStatus {
  return {
    pending: [],
    succeeded: ALL,
    failed: [],
    tempoBpm: null,
    key: null,
    ...overrides,
  };
}

/** Mark a single feature as pending, leaving the rest succeeded. */
function pendingOnly(feature: FeatureName): Pick<AnalysisStatus, "pending" | "succeeded"> {
  return {
    pending: [feature],
    succeeded: ALL.filter((f) => f !== feature),
  };
}

describe("TempoKeyReadout state scenarios (Req 8.4, 8.5)", () => {
  describe("key-absent placeholder retains the displayed tempo (Req 8.4)", () => {
    it("shows 128 BPM while the resolved key is absent (null, not pending)", () => {
      render(
        <TempoKeyReadout status={makeStatus({ tempoBpm: 128, key: null })} />,
      );

      // An absent key must not clear the separately displayed tempo.
      expect(screen.getByTestId("tempo-readout")).toHaveTextContent(
        "Tempo: 128 BPM",
      );
      expect(screen.getByTestId("key-readout")).toHaveTextContent(
        `Key: ${KEY_PLACEHOLDER}`,
      );
    });

    it.each([40, 95, 174, 250])(
      "retains a plausible tempo of %i BPM alongside the key placeholder",
      (bpm) => {
        render(
          <TempoKeyReadout status={makeStatus({ tempoBpm: bpm, key: null })} />,
        );

        expect(screen.getByTestId("tempo-readout")).toHaveTextContent(
          `Tempo: ${bpm} BPM`,
        );
        expect(screen.getByTestId("key-readout")).toHaveTextContent(
          `Key: ${KEY_PLACEHOLDER}`,
        );
      },
    );

    it("renders the tempo and key readouts as independent elements", () => {
      render(
        <TempoKeyReadout status={makeStatus({ tempoBpm: 128, key: null })} />,
      );

      // The key placeholder lives only in the key readout, never in the tempo
      // readout — confirming the two are formatted independently (Req 8.4).
      expect(screen.getByTestId("tempo-readout")).not.toHaveTextContent(
        KEY_PLACEHOLDER,
      );
    });
  });

  describe("pending indicators per estimate (Req 8.5)", () => {
    it("shows the pending indicator for the tempo while the key is resolved", () => {
      render(
        <TempoKeyReadout
          status={makeStatus({
            ...pendingOnly("tempo"),
            key: { tonic: "G", mode: "major" },
          })}
        />,
      );

      expect(screen.getByTestId("tempo-readout")).toHaveTextContent(
        `Tempo: ${PENDING_INDICATOR}`,
      );
      // A resolved key still renders while only the tempo is pending.
      expect(screen.getByTestId("key-readout")).toHaveTextContent(
        "Key: G major",
      );
    });

    it("shows the pending indicator for the key while the tempo is resolved", () => {
      render(
        <TempoKeyReadout
          status={makeStatus({ ...pendingOnly("key"), tempoBpm: 100 })}
        />,
      );

      expect(screen.getByTestId("tempo-readout")).toHaveTextContent(
        "Tempo: 100 BPM",
      );
      expect(screen.getByTestId("key-readout")).toHaveTextContent(
        `Key: ${PENDING_INDICATOR}`,
      );
    });

    it("shows the pending indicator for both estimates while both are pending", () => {
      render(
        <TempoKeyReadout
          status={makeStatus({
            pending: ["tempo", "key"],
            succeeded: ["rms", "spectral", "melody", "chords"],
            // Stale/in-flight values must stay hidden behind the indicator.
            tempoBpm: 120,
            key: { tonic: "C", mode: "minor" },
          })}
        />,
      );

      expect(screen.getByTestId("tempo-readout")).toHaveTextContent(
        `Tempo: ${PENDING_INDICATOR}`,
      );
      expect(screen.getByTestId("key-readout")).toHaveTextContent(
        `Key: ${PENDING_INDICATOR}`,
      );
    });

    it("prefers the pending indicator over an absent value while pending", () => {
      // Pending takes precedence even when no estimate has arrived yet, so the
      // readout never flashes the placeholder before analysis completes.
      render(
        <TempoKeyReadout
          status={makeStatus({
            pending: ["tempo", "key"],
            succeeded: ["rms", "spectral", "melody", "chords"],
            tempoBpm: null,
            key: null,
          })}
        />,
      );

      expect(screen.getByTestId("tempo-readout")).toHaveTextContent(
        `Tempo: ${PENDING_INDICATOR}`,
      );
      expect(screen.getByTestId("key-readout")).toHaveTextContent(
        `Key: ${PENDING_INDICATOR}`,
      );
    });
  });
});
