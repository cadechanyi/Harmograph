import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TempoKeyReadout } from "./TempoKeyReadout";
import { PENDING_INDICATOR } from "./tempoKeyReadout.logic";
import type { AnalysisStatus, FeatureName } from "@/stores";

afterEach(cleanup);

/** Build an AnalysisStatus, defaulting features to succeeded. */
function makeStatus(overrides: Partial<AnalysisStatus> = {}): AnalysisStatus {
  const all: FeatureName[] = ["rms", "spectral", "tempo", "key", "melody", "chords"];
  return {
    pending: [],
    succeeded: all,
    failed: [],
    tempoBpm: null,
    key: null,
    ...overrides,
  };
}

describe("TempoKeyReadout (Req 8.1-8.5)", () => {
  it("shows a rounded plausible tempo and a valid key (Req 8.1, 8.3)", () => {
    render(
      <TempoKeyReadout
        status={makeStatus({ tempoBpm: 120.4, key: { tonic: "A", mode: "minor" } })}
      />,
    );
    expect(screen.getByTestId("tempo-readout")).toHaveTextContent("Tempo: 120 BPM");
    expect(screen.getByTestId("key-readout")).toHaveTextContent("Key: A minor");
  });

  it("shows the placeholder for an implausible tempo (Req 8.2)", () => {
    render(<TempoKeyReadout status={makeStatus({ tempoBpm: 300 })} />);
    expect(screen.getByTestId("tempo-readout")).toHaveTextContent(
      "Tempo: could not be determined",
    );
  });

  it("retains a displayed tempo when the key is absent (Req 8.4)", () => {
    render(<TempoKeyReadout status={makeStatus({ tempoBpm: 90, key: null })} />);
    expect(screen.getByTestId("tempo-readout")).toHaveTextContent("Tempo: 90 BPM");
    expect(screen.getByTestId("key-readout")).toHaveTextContent(
      "Key: could not be determined",
    );
  });

  it("shows a pending indicator per estimate while pending (Req 8.5)", () => {
    render(
      <TempoKeyReadout
        status={makeStatus({
          pending: ["tempo", "key"],
          succeeded: ["rms", "spectral", "melody", "chords"],
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

  it("shows the pending key indicator while keeping a resolved tempo (Req 8.4, 8.5)", () => {
    render(
      <TempoKeyReadout
        status={makeStatus({
          pending: ["key"],
          succeeded: ["rms", "spectral", "tempo", "melody", "chords"],
          tempoBpm: 128,
        })}
      />,
    );
    expect(screen.getByTestId("tempo-readout")).toHaveTextContent("Tempo: 128 BPM");
    expect(screen.getByTestId("key-readout")).toHaveTextContent(
      `Key: ${PENDING_INDICATOR}`,
    );
  });
});
