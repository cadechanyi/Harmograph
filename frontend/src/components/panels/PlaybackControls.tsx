"use client";

/**
 * PlaybackControls — play / pause / seek.
 *
 * Reads and drives the playback store. The store currently holds UI-facing
 * state only; the authoritative Audio_Engine lands in task 6.
 */
import type { PlaybackStore } from "@/stores";

export interface PlaybackControlsProps {
  playback: PlaybackStore;
}

export function PlaybackControls({ playback }: PlaybackControlsProps) {
  const { isPlaying, currentTime, duration, isLoaded, play, pause, seek } =
    playback;
  const max = duration > 0 ? duration : 1;

  return (
    <section
      className="pointer-events-auto flex items-center gap-3 rounded-md bg-black/40 p-3 text-sm text-white"
      aria-label="Playback controls"
    >
      <button
        type="button"
        className="rounded bg-white/15 px-3 py-1 disabled:opacity-40"
        onClick={() => (isPlaying ? pause() : play())}
        disabled={!isLoaded}
        data-testid="playpause-button"
      >
        {isPlaying ? "Pause" : "Play"}
      </button>
      <input
        type="range"
        min={0}
        max={max}
        step={0.01}
        value={currentTime}
        onChange={(e) => seek(Number(e.target.value))}
        className="flex-1"
        aria-label="Seek"
        data-testid="seek-input"
      />
      <span className="tabular-nums opacity-80">
        {currentTime.toFixed(1)} / {duration.toFixed(1)}s
      </span>
    </section>
  );
}
