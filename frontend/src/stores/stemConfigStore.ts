"use client";

/**
 * Stem configuration store.
 *
 * Owns the per-stem UI state: enabled/disabled and selected Graph_Style. The
 * map always has exactly one entry per Stem_Type (Req 6.3) and every stem is
 * initialized to enabled (Req 6.4) with its table default style (Req 7.5, 7.6).
 */
import { useCallback, useMemo, useState } from "react";
import {
  DEFAULT_STYLE,
  STEM_TYPES,
  type GraphStyle,
  type StemConfig,
  type StemConfigMap,
  type StemType,
} from "@/models";

export interface StemConfigStore {
  config: StemConfigMap;
  toggleStem: (stem: StemType) => void;
  setStemEnabled: (stem: StemType, enabled: boolean) => void;
  setStemStyle: (stem: StemType, style: GraphStyle) => void;
  /** Re-initialize every stem to enabled + default style (e.g. on load). */
  resetAll: () => void;
}

/**
 * Build the initial StemConfigMap: every stem enabled (Req 6.4) using its
 * default style (Req 7.5, 7.6).
 */
export function createInitialStemConfig(): StemConfigMap {
  return STEM_TYPES.reduce((acc, stem) => {
    acc[stem] = { enabled: true, style: DEFAULT_STYLE[stem] };
    return acc;
  }, {} as StemConfigMap);
}

export function useStemConfigStore(): StemConfigStore {
  const [config, setConfig] = useState<StemConfigMap>(createInitialStemConfig);

  const updateStem = useCallback(
    (stem: StemType, patch: Partial<StemConfig>) => {
      setConfig((prev) => ({ ...prev, [stem]: { ...prev[stem], ...patch } }));
    },
    [],
  );

  const toggleStem = useCallback((stem: StemType) => {
    setConfig((prev) => ({
      ...prev,
      [stem]: { ...prev[stem], enabled: !prev[stem].enabled },
    }));
  }, []);

  const setStemEnabled = useCallback(
    (stem: StemType, enabled: boolean) => updateStem(stem, { enabled }),
    [updateStem],
  );

  const setStemStyle = useCallback(
    (stem: StemType, style: GraphStyle) => updateStem(stem, { style }),
    [updateStem],
  );

  const resetAll = useCallback(
    () => setConfig(createInitialStemConfig()),
    [],
  );

  return useMemo(
    () => ({ config, toggleStem, setStemEnabled, setStemStyle, resetAll }),
    [config, toggleStem, setStemEnabled, setStemStyle, resetAll],
  );
}
