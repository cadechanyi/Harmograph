"use client";

/**
 * UploadPanel — file picker that forwards the chosen file to the controller.
 *
 * Validation, Audio_Engine loading, analysis, and separation are orchestrated
 * by the HarmographController (task 17.1); this component only surfaces the
 * chosen file name and hands the File to `onUpload`. Validation/decode/
 * separation messages are surfaced through the StatusBanner.
 */
import { useState } from "react";

export interface UploadPanelProps {
  /** Called with the selected File when the user picks one. */
  onUpload?: (file: File) => void;
}

export function UploadPanel({ onUpload }: UploadPanelProps) {
  const [fileName, setFileName] = useState<string | null>(null);

  return (
    <section
      className="pointer-events-auto rounded-md bg-black/40 p-3 text-sm text-white"
      aria-label="Upload"
    >
      <label className="block font-medium">Upload audio (MP3 or WAV)</label>
      <input
        type="file"
        accept="audio/mpeg,audio/wav,.mp3,.wav"
        className="mt-1 block w-full text-xs"
        onChange={(e) => {
          const file = e.target.files?.[0] ?? null;
          setFileName(file?.name ?? null);
          if (file) onUpload?.(file);
        }}
        data-testid="upload-input"
      />
      {fileName ? (
        <p className="mt-1 text-xs opacity-80">Selected: {fileName}</p>
      ) : null}
    </section>
  );
}
