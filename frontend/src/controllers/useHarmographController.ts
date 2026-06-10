"use client";

/**
 * useHarmographController — binds the non-React {@link HarmographController} to
 * the React state stores and the overlay so the app runs end to end.
 *
 * The controller is created once (engines are stateful and must not be rebuilt
 * on every render). Its callbacks flow engine state into the stores; the hook
 * returns store-backed view objects plus stable handlers (upload, play/pause/
 * seek, toggle/style/unit, renderer mount) the component tree consumes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphStyle, StemType, YUnit } from "@/models";
import {
  useAnalysisStatusStore,
  usePlaybackStore,
  useStemConfigStore,
  useTimelineIndexStore,
  type AnalysisStatus,
  type PlaybackStore,
  type StemConfigStore,
} from "@/stores";
import {
  HarmographController,
  type HarmographControllerCallbacks,
  type HarmographControllerOptions,
  type PlaybackSnapshot,
  type StatusTone,
} from "./HarmographController";

export interface UseHarmographControllerResult {
  /** Playback view (store state + controller-driven play/pause/seek). */
  playback: PlaybackStore;
  /** Stem config view (store state + controller-mirrored toggle/style). */
  stemConfig: StemConfigStore;
  timelineIndex: ReturnType<typeof useTimelineIndexStore>;
  analysisStatus: AnalysisStatus;
  yUnit: YUnit;
  setYUnit: (unit: YUnit) => void;
  statusMessage: string | null;
  statusTone: StatusTone;
  onUpload: (file: File) => void;
  mountRenderer: (container: HTMLElement) => void;
  unmountRenderer: () => void;
}

/**
 * Wire the controller to the stores. `options` lets tests inject engine/client
 * factories; production callers pass none and get the real engines.
 */
export function useHarmographController(
  options?: Omit<HarmographControllerOptions, "callbacks">,
): UseHarmographControllerResult {
  const playbackStore = usePlaybackStore();
  const timelineIndex = useTimelineIndexStore();
  const stemConfig = useStemConfigStore();
  const analysisStatusStore = useAnalysisStatusStore();

  const [yUnit, setYUnitState] = useState<YUnit>("normalized");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusTone, setStatusTone] = useState<StatusTone>("info");

  // Keep the latest store setters in a ref so the (stable) controller callbacks
  // always target current React state without re-creating the controller.
  const sinkRef = useRef<HarmographControllerCallbacks>({});
  sinkRef.current = {
    onPlayback: (snapshot: PlaybackSnapshot) => {
      playbackStore.setLoaded(snapshot.isLoaded);
      playbackStore.setPlaying(snapshot.isPlaying);
      playbackStore.setCurrentTime(snapshot.currentTime);
      playbackStore.setDuration(snapshot.duration);
    },
    onAnalysisStatus: (status) => analysisStatusStore.setStatus(status),
    onPointCounts: (counts) => timelineIndex.setPointCounts(counts),
    onStemConfig: () => stemConfig.resetAll(),
    onStatusMessage: (message, tone) => {
      setStatusMessage(message);
      setStatusTone(tone);
    },
  };

  const controller = useMemo(
    () =>
      new HarmographController({
        ...options,
        callbacks: {
          onPlayback: (s) => sinkRef.current.onPlayback?.(s),
          onAnalysisStatus: (s) => sinkRef.current.onAnalysisStatus?.(s),
          onPointCounts: (c) => sinkRef.current.onPointCounts?.(c),
          onStemConfig: (c) => sinkRef.current.onStemConfig?.(c),
          onStatusMessage: (m, t) => sinkRef.current.onStatusMessage?.(m, t),
        },
      }),
    // The controller is intentionally created once; option changes are ignored
    // after mount (engines are stateful).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => () => controller.unmount(), [controller]);

  const onUpload = useCallback(
    (file: File) => {
      void controller.handleUpload(file);
    },
    [controller],
  );

  const mountRenderer = useCallback(
    (container: HTMLElement) => {
      void controller.mountRenderer(container);
    },
    [controller],
  );

  const unmountRenderer = useCallback(() => controller.unmount(), [controller]);

  const setYUnit = useCallback(
    (unit: YUnit) => {
      setYUnitState(unit);
      controller.setYUnit(unit);
    },
    [controller],
  );

  const handleToggleStem = useCallback(
    (stem: StemType) => {
      const next = !stemConfig.config[stem].enabled;
      stemConfig.setStemEnabled(stem, next);
      controller.setStemEnabled(stem, next);
    },
    [controller, stemConfig],
  );

  const handleSelectStyle = useCallback(
    (stem: StemType, style: GraphStyle) => {
      stemConfig.setStemStyle(stem, style);
      controller.setStemStyle(stem, style);
    },
    [controller, stemConfig],
  );

  // View objects: store state with controller-driven actions layered on top.
  const playback = useMemo<PlaybackStore>(
    () => ({
      ...playbackStore,
      play: () => controller.play(),
      pause: () => controller.pause(),
      seek: (t: number) => controller.seek(t),
    }),
    [playbackStore, controller],
  );

  const stemConfigView = useMemo<StemConfigStore>(
    () => ({
      ...stemConfig,
      toggleStem: handleToggleStem,
      setStemStyle: handleSelectStyle,
    }),
    [stemConfig, handleToggleStem, handleSelectStyle],
  );

  return {
    playback,
    stemConfig: stemConfigView,
    timelineIndex,
    analysisStatus: analysisStatusStore,
    yUnit,
    setYUnit,
    statusMessage,
    statusTone,
    onUpload,
    mountRenderer,
    unmountRenderer,
  };
}
