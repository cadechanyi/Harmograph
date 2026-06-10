"use client";

/**
 * Harmograph — upload a song, separate it into its components with the
 * Demucs_Service, then visualize them as a flowing "Geometry Dash" graph synced
 * to playback. The separated stems are also listed below for verification.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlowVisualizer, type VisualElement } from "./FlowVisualizer";

/** Base URL of the Demucs_Service (configurable; defaults to local dev). */
const ENDPOINT =
  process.env.NEXT_PUBLIC_DEMUCS_ENDPOINT ?? "http://localhost:8200";

/** A separated stem descriptor as returned by POST /separate. */
interface StemEntry {
  key: string;
  label: string;
  url: string;
  bytes: number;
}

const STEM_LABELS: Record<string, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Melody / Other",
};

const STEM_ORDER = ["vocals", "drums", "bass", "other"];

type Status =
  | { kind: "idle" }
  | { kind: "separating"; fileName: string }
  | { kind: "done"; fileName: string; durationSeconds: number }
  | { kind: "error"; message: string };

function joinUrl(base: string, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  return `${base.replace(/\/+$/, "")}${path.startsWith("/") ? "" : "/"}${path}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function StemLab() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [stems, setStems] = useState<StemEntry[]>([]);
  const [elements, setElements] = useState<VisualElement[]>([]);
  const [songUrl, setSongUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const songUrlRef = useRef<string | null>(null);

  // Revoke the previous object URL when it changes / on unmount.
  useEffect(() => {
    songUrlRef.current = songUrl;
    return () => {
      if (songUrlRef.current) URL.revokeObjectURL(songUrlRef.current);
    };
  }, [songUrl]);

  const separate = useCallback(async (file: File) => {
    setStems([]);
    setElements([]);
    setIsPlaying(false);
    // Local playback of the original mix, synced to the visual.
    setSongUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setStatus({ kind: "separating", fileName: file.name });
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(joinUrl(ENDPOINT, "/separate"), {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        let message = `Separation failed (status ${res.status}).`;
        try {
          const body = await res.json();
          message = body?.error?.message ?? message;
        } catch {
          /* keep default */
        }
        setStatus({ kind: "error", message });
        return;
      }
      const body = await res.json();
      const rawStems = (body?.stems ?? {}) as Record<
        string,
        { url: string; bytes: number }
      >;
      const entries: StemEntry[] = STEM_ORDER.filter((k) => rawStems[k]).map(
        (key) => ({
          key,
          label: STEM_LABELS[key] ?? key,
          url: joinUrl(ENDPOINT, rawStems[key].url),
          bytes: rawStems[key].bytes,
        }),
      );
      const rawElements = (body?.elements ?? []) as Array<{
        id: string;
        label: string;
        parent: string;
        kind: "percussive" | "tonal";
        events: { t: number; strength: number }[];
        envelope: { t: number; v: number }[];
        contour: { t: number; p: number; v: number }[];
      }>;
      setStems(entries);
      setElements(
        rawElements.map((e) => ({
          id: e.id,
          label: e.label,
          parent: e.parent,
          kind: e.kind,
          events: e.events ?? [],
          envelope: e.envelope ?? [],
          contour: e.contour ?? [],
        })),
      );
      setStatus({
        kind: "done",
        fileName: file.name,
        durationSeconds: Number(body?.duration_seconds ?? 0),
      });
    } catch {
      setStatus({
        kind: "error",
        message:
          "Could not reach the separation service. Is the backend running?",
      });
    }
  }, []);

  const onFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) void separate(file);
    },
    [separate],
  );

  const getCurrentTime = useCallback(() => audioRef.current?.currentTime ?? 0, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play();
    } else {
      audio.pause();
    }
  }, []);

  const busy = status.kind === "separating";
  const ready = status.kind === "done" && elements.length > 0;

  const statusLine = useMemo(() => {
    switch (status.kind) {
      case "separating":
        return `Separating "${status.fileName}" with Demucs… this runs locally and can take ~20–30s for a full song.`;
      case "done":
        return `Ready — press play to watch "${status.fileName}" flow.`;
      case "error":
        return status.message;
      default:
        return "Upload an MP3 or WAV to separate it and watch its components flow.";
    }
  }, [status]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Harmograph</h1>
        <p className="text-sm opacity-70">
          Separate a song into its parts and watch them flow in time.
        </p>
      </header>

      <div className="mb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Separating…" : "Upload audio"}
        </button>
        {ready && (
          <button
            type="button"
            onClick={togglePlay}
            className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-emerald-500"
          >
            {isPlaying ? "Pause" : "Play"}
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
          onChange={onFile}
          className="hidden"
        />
        {busy && (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-sky-400 border-t-transparent"
            aria-hidden="true"
          />
        )}
      </div>

      <p
        className={`mb-4 text-sm ${status.kind === "error" ? "text-red-400" : "opacity-80"}`}
      >
        {statusLine}
      </p>

      {/* Original mix drives playback + the visual clock. */}
      {songUrl && (
        <audio
          ref={audioRef}
          src={songUrl}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          className="hidden"
        />
      )}

      {ready && (
        <div className="mb-8">
          <FlowVisualizer
            elements={elements}
            getCurrentTime={getCurrentTime}
            duration={status.kind === "done" ? status.durationSeconds : 0}
          />
        </div>
      )}

      {stems.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold opacity-70">
            Components (verify separation)
          </h2>
          <ul className="space-y-3">
            {stems.map((stem) => {
              const stemElements = elements.filter((e) => e.parent === stem.key);
              return (
                <li
                  key={stem.key}
                  className="rounded-lg border border-neutral-700 bg-neutral-900/60 p-4"
                >
                  <div className="mb-2 flex items-baseline justify-between">
                    <span className="font-medium">{stem.label}</span>
                    <span className="text-xs opacity-60">
                      {formatBytes(stem.bytes)}
                    </span>
                  </div>
                  <audio
                    controls
                    preload="none"
                    className="w-full"
                    src={stem.url}
                  >
                    Your browser does not support audio playback.
                  </audio>
                  {stemElements.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {stemElements.map((el) => (
                        <span
                          key={el.id}
                          className={`rounded-full px-2.5 py-1 text-xs ${
                            el.kind === "percussive"
                              ? "bg-amber-500/15 text-amber-300"
                              : "bg-emerald-500/15 text-emerald-300"
                          }`}
                        >
                          {el.label} · {el.events.length}
                          {el.kind === "percussive" ? " hits" : " onsets"}
                        </span>
                      ))}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
