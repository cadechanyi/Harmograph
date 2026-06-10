"use client";

/**
 * Playback state store.
 *
 * Mirrors the slice of Audio_Engine state the UI_Overlay needs to display and
 * control (play/pause/seek, current time, duration, loaded flag). The actual
 * Web Audio decode/playback engine lands in a later task (task 6); this store
 * holds only the UI-facing state and exposes placeholder actions wired into
 * `HarmographPage`.
 */
import { useCallback, useMemo, useState } from "react";

export interface PlaybackState {
  /** Whether audio is currently playing. */
  isPlaying: boolean;
  /** Current playback position in seconds. */
  currentTime: number;
  /** Song duration in seconds (0 until a file is loaded). */
  duration: number;
  /** Whether an audio file is loaded into the Audio_Engine. */
  isLoaded: boolean;
}

export interface PlaybackStore extends PlaybackState {
  play: () => void;
  pause: () => void;
  seek: (timeSeconds: number) => void;
  setDuration: (durationSeconds: number) => void;
  setLoaded: (loaded: boolean) => void;
  /** Mirror the Audio_Engine's live playback position into the UI (Req 2.4). */
  setCurrentTime: (timeSeconds: number) => void;
  /** Mirror the Audio_Engine's playing flag into the UI. */
  setPlaying: (playing: boolean) => void;
  reset: () => void;
}

export const INITIAL_PLAYBACK: PlaybackState = {
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  isLoaded: false,
};

export function usePlaybackStore(): PlaybackStore {
  const [state, setState] = useState<PlaybackState>(INITIAL_PLAYBACK);

  const play = useCallback(() => {
    setState((prev) => (prev.isLoaded ? { ...prev, isPlaying: true } : prev));
  }, []);

  const pause = useCallback(() => {
    setState((prev) => ({ ...prev, isPlaying: false }));
  }, []);

  // Placeholder clamp; the authoritative [0, duration] clamp lands with the
  // Audio_Engine in task 6.
  const seek = useCallback((timeSeconds: number) => {
    setState((prev) => {
      const upper = prev.duration > 0 ? prev.duration : timeSeconds;
      const clamped = Math.max(0, Math.min(timeSeconds, upper));
      return { ...prev, currentTime: clamped };
    });
  }, []);

  const setDuration = useCallback((durationSeconds: number) => {
    setState((prev) => ({ ...prev, duration: durationSeconds }));
  }, []);

  const setLoaded = useCallback((loaded: boolean) => {
    setState((prev) => ({ ...prev, isLoaded: loaded }));
  }, []);

  const setCurrentTime = useCallback((timeSeconds: number) => {
    setState((prev) => ({ ...prev, currentTime: timeSeconds }));
  }, []);

  const setPlaying = useCallback((playing: boolean) => {
    setState((prev) => ({ ...prev, isPlaying: playing }));
  }, []);

  const reset = useCallback(() => setState(INITIAL_PLAYBACK), []);

  return useMemo(
    () => ({
      ...state,
      play,
      pause,
      seek,
      setDuration,
      setLoaded,
      setCurrentTime,
      setPlaying,
      reset,
    }),
    [
      state,
      play,
      pause,
      seek,
      setDuration,
      setLoaded,
      setCurrentTime,
      setPlaying,
      reset,
    ],
  );
}
