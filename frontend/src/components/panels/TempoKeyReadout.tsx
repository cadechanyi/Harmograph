"use client";

/**
 * TempoKeyReadout — displays tempo + key with pending/placeholder states
 * (Req 8.1-8.5).
 *
 * All display decisions live in the pure {@link formatTempo} / {@link formatKey}
 * functions so they stay directly testable. This component is a thin view that
 * derives the pending flags from the {@link AnalysisStatus} and renders the
 * formatted text. Tempo and key are formatted independently, so an absent key
 * never clears a displayed tempo (Req 8.4).
 */
import { appConfig } from "@/config/appConfig";
import type { AnalysisStatus, FeatureName } from "@/stores";
import { formatKey, formatTempo } from "./tempoKeyReadout.logic";

export interface TempoKeyReadoutProps {
  status: AnalysisStatus;
}

function isPending(status: AnalysisStatus, feature: FeatureName): boolean {
  return status.pending.includes(feature);
}

export function TempoKeyReadout({ status }: TempoKeyReadoutProps) {
  const tempoText = formatTempo(
    status.tempoBpm,
    isPending(status, "tempo"),
    appConfig.plausibleTempo,
  );
  const keyText = formatKey(status.key, isPending(status, "key"));

  return (
    <section
      className="pointer-events-auto rounded-md bg-black/40 p-3 text-sm text-white"
      aria-label="Tempo and key"
      data-testid="tempo-key-readout"
    >
      <p data-testid="tempo-readout">Tempo: {tempoText}</p>
      <p data-testid="key-readout">Key: {keyText}</p>
    </section>
  );
}
