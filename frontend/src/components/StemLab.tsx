"use client";

/**
 * StemLab — Phase 1 UI: upload a song, separate it into stems with the
 * Demucs_Service, and play each separated component individually to verify
 * separation quality. Deliberately minimal: upload + per-stem players, no graph
 * styles or unit pickers (those belong to the Phase 2 flow visual).
 */

import { useCallback, useMemo, useRef, useState } from "react";

/** Base URL of the Demucs_Service (configurable; defaults to local dev). */
const ENDPOINT =
  process.env.NEXT_PUBLIC_DEMUCS_ENDPOINT ?? "http://localhost:8200";

/** A separated stem descriptor as returned by POST /separate. */
interface StemEntry {
  /** Demucs stem key. */
  key: string;
  /** Human label shown in the UI. */
  label: string;
  /** Absolute URL to the stem WAV. */
  url: string;
  /** File size in bytes. */
  bytes: number;
}

/** A detected element (basic building block) within a stem. */
interface ElementEntry {
  id: string;
  label: string;
  parent: string;
  kind: "percussive" | "tonal";
  eventCount: number;
}

/** Demucs stem key → display label (htdemucs produces these four). */
const STEM_LABELS: Record<string, string> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  other: "Melody / Other",
};

/** Canonical display order. */
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
  const [elements, setElements] = useState<ElementEntry[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const separate = useCallback(async (file: File) => {
    setStems([]);
    setElements([]);
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
        event_count: number;
      }>;
      setStems(entries);
      setElements(
        rawElements.map((e) => ({
          id: e.id,
          label: e.label,
          parent: e.parent,
          kind: e.kind,
          eventCount: e.event_count,
        })),
      );
      setStatus({
        kind: "done",
        fileName: file.name,
        durationSeconds: Number(body?.duration_seconds ?? 0),
      });
    } catch (err) {
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

  const busy = status.kind === "separating";

  const statusLine = useMemo(() => {
    switch (status.kind) {
      case "separating":
        return `Separating "${status.fileName}" with Demucs… this runs on CPU and can take a bit.`;
      case "done":
        return `Separated "${status.fileName}" (${status.durationSeconds.toFixed(1)}s). Play each component below.`;
      case "error":
        return status.message;
      default:
        return "Upload an MP3 or WAV to separate it into its musical components.";
    }
  }, [status]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-3xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Harmograph — Stem Lab</h1>
        <p className="text-sm opacity-70">
          Phase 1: separate a song into its components and verify each one.
        </p>
      </header>

      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "Separating…" : "Upload audio"}
        </button>
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
        className={`mb-6 text-sm ${status.kind === "error" ? "text-red-400" : "opacity-80"}`}
      >
        {statusLine}
      </p>

      {stems.length > 0 && (
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
                <audio controls preload="none" className="w-full" src={stem.url}>
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
                        title={`${el.kind} element`}
                      >
                        {el.label} · {el.eventCount}
                        {el.kind === "percussive" ? " hits" : " onsets"}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
