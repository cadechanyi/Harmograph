"use client";

/**
 * Analysis status store.
 *
 * Mirrors the design's `AnalysisStatus`: which features are pending / succeeded
 * / failed plus the estimated tempo and key the UI_Overlay displays (Req 3.6,
 * 8.1-8.5). The actual Analysis_Engine (Meyda/Essentia) lands in a later task
 * (task 8); this store holds only the UI-facing status and exposes placeholder
 * setters wired into `HarmographPage`.
 */
import { useCallback, useMemo, useState } from "react";
import type { PitchClass } from "@/models";

export type FeatureName =
  | "rms"
  | "spectral"
  | "tempo"
  | "key"
  | "melody"
  | "chords";

export const ALL_FEATURES: readonly FeatureName[] = [
  "rms",
  "spectral",
  "tempo",
  "key",
  "melody",
  "chords",
] as const;

export interface KeyEstimate {
  tonic: PitchClass;
  mode: "major" | "minor";
}

export interface AnalysisStatus {
  pending: FeatureName[];
  succeeded: FeatureName[];
  failed: FeatureName[];
  tempoBpm: number | null;
  key: KeyEstimate | null;
}

export interface AnalysisStatusStore extends AnalysisStatus {
  setStatus: (status: AnalysisStatus) => void;
  reset: () => void;
}

/** All features pending, no tempo/key yet — the state before analysis runs. */
export function createInitialAnalysisStatus(): AnalysisStatus {
  return {
    pending: [...ALL_FEATURES],
    succeeded: [],
    failed: [],
    tempoBpm: null,
    key: null,
  };
}

export function useAnalysisStatusStore(): AnalysisStatusStore {
  const [status, setStatusState] = useState<AnalysisStatus>(
    createInitialAnalysisStatus,
  );

  const setStatus = useCallback(
    (next: AnalysisStatus) => setStatusState(next),
    [],
  );

  const reset = useCallback(
    () => setStatusState(createInitialAnalysisStatus()),
    [],
  );

  return useMemo(
    () => ({ ...status, setStatus, reset }),
    [status, setStatus, reset],
  );
}
