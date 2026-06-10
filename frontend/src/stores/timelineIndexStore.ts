"use client";

/**
 * Timeline index store.
 *
 * Tracks how many Timeline_Points are currently available per stem so the UI
 * can reflect data availability (e.g. enabling/disabling style options whose
 * required data has not yet been produced). The authoritative Timeline_Stream
 * — validation, routing, ordering — lands in a later task (task 7); this store
 * holds only the lightweight per-stem index the overlay reads.
 */
import { useCallback, useMemo, useState } from "react";
import { STEM_TYPES, type StemType } from "@/models";

export type StemPointCounts = Record<StemType, number>;

export interface TimelineIndexStore {
  /** Number of points currently available per stem. */
  pointCounts: StemPointCounts;
  /** Whether a stem has at least one available point. */
  hasPoints: (stem: StemType) => boolean;
  /** Record that `count` points became available for a stem. */
  addPoints: (stem: StemType, count: number) => void;
  /** Replace the per-stem counts wholesale (e.g. after an analysis pass). */
  setPointCounts: (counts: StemPointCounts) => void;
  /** Clear all per-stem counts (e.g. on loading a new file). */
  reset: () => void;
}

export function createEmptyPointCounts(): StemPointCounts {
  return STEM_TYPES.reduce((acc, stem) => {
    acc[stem] = 0;
    return acc;
  }, {} as StemPointCounts);
}

export function useTimelineIndexStore(): TimelineIndexStore {
  const [pointCounts, setPointCounts] = useState<StemPointCounts>(
    createEmptyPointCounts,
  );

  const hasPoints = useCallback(
    (stem: StemType) => pointCounts[stem] > 0,
    [pointCounts],
  );

  const addPoints = useCallback((stem: StemType, count: number) => {
    setPointCounts((prev) => ({ ...prev, [stem]: prev[stem] + count }));
  }, []);

  const setPointCountsAll = useCallback((counts: StemPointCounts) => {
    setPointCounts({ ...counts });
  }, []);

  const reset = useCallback(
    () => setPointCounts(createEmptyPointCounts()),
    [],
  );

  return useMemo(
    () => ({
      pointCounts,
      hasPoints,
      addPoints,
      setPointCounts: setPointCountsAll,
      reset,
    }),
    [pointCounts, hasPoints, addPoints, setPointCountsAll, reset],
  );
}
