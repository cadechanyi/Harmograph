/**
 * Pure upload validation for the Harmograph Frontend (Req 1.1-1.4).
 *
 * `validateUpload` classifies any candidate file deterministically before it
 * is handed to the Audio_Engine. It is a pure function: its result depends only
 * on the file's size and format and the configured `maxBytes`, with no side
 * effects. Decode failures (Req 1.5) are detected later by the decoder, not
 * here — see the design's Error Handling section.
 *
 * Classification (design Property 1):
 *   ok: true  iff  format is a Supported_Audio_Format (MP3/WAV)
 *                  AND size > 0
 *                  AND size <= maxBytes
 *   otherwise ok: false with one of:
 *     - "empty"              when size is zero bytes        (Req 1.4)
 *     - "unsupported_format" when format is not MP3/WAV     (Req 1.2)
 *     - "too_large"          when size exceeds maxBytes     (Req 1.3)
 *
 * Precedence (deterministic, consistent with the design's Error Handling):
 *   empty  >  unsupported_format  >  too_large
 * A zero-byte file is reported as `empty` regardless of its format (emptiness
 * is the most fundamental defect, and a zero-byte file can never be
 * `too_large`). Among non-empty files, an unsupported format is reported before
 * an oversize check so the user is told the accepted formats first.
 */

/**
 * The result of validating a candidate upload.
 *
 * Mirrors the design's Upload Handler / UploadPanel interface.
 */
export type UploadValidation =
  | { ok: true }
  | {
      ok: false;
      reason: "unsupported_format" | "too_large" | "empty";
      message: string;
    };

/** A minimal structural view of the parts of `File` this module reads. */
interface FileLike {
  /** File name, used for extension-based format detection. */
  name: string;
  /** MIME type, used for type-based format detection. May be empty. */
  type: string;
  /** Size in bytes. */
  size: number;
}

/** Accepted MIME types for MP3 and WAV audio. */
const SUPPORTED_MIME_TYPES: ReadonlySet<string> = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/vnd.wave",
]);

/** Accepted file extensions (lower-cased, including the leading dot). */
const SUPPORTED_EXTENSIONS: readonly string[] = [".mp3", ".wav"];

/**
 * Returns true when the file looks like a Supported_Audio_Format based on its
 * MIME type and/or its file extension (Req 1.2). Either signal is sufficient,
 * since browsers do not always populate `File.type`.
 */
function isSupportedFormat(file: FileLike): boolean {
  const mime = file.type.trim().toLowerCase();
  if (mime !== "" && SUPPORTED_MIME_TYPES.has(mime)) {
    return true;
  }

  const name = file.name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => name.endsWith(ext));
}

/** Formats a byte count as a human-readable megabyte value for messages. */
function formatMegabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  // Drop a trailing ".0" so whole numbers read cleanly (e.g. "100 MB").
  const rounded = Math.round(mb * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);
}

/**
 * Validates a candidate upload against the supported formats, the non-empty
 * requirement, and the configured maximum size (Req 1.1-1.4).
 *
 * @param file - The candidate file (only `name`, `type`, and `size` are read).
 * @param maxBytes - The configured maximum upload size in bytes (Req 1.3).
 * @returns `{ ok: true }` when the file is acceptable, otherwise
 *   `{ ok: false, reason, message }` with a user-facing message.
 */
export function validateUpload(
  file: FileLike,
  maxBytes: number,
): UploadValidation {
  // Emptiness takes precedence: a zero-byte file is always reported as empty
  // (Req 1.4) and can never be too_large.
  if (file.size <= 0) {
    return {
      ok: false,
      reason: "empty",
      message: "The file is empty. Please choose an audio file that contains data.",
    };
  }

  // Format next, so the user is told the accepted formats (Req 1.2).
  if (!isSupportedFormat(file)) {
    return {
      ok: false,
      reason: "unsupported_format",
      message: "Unsupported file format. Please upload an MP3 or WAV file.",
    };
  }

  // Size limit last (Req 1.3).
  if (file.size > maxBytes) {
    return {
      ok: false,
      reason: "too_large",
      message: `File is too large. The maximum allowed size is ${formatMegabytes(
        maxBytes,
      )} MB (${maxBytes.toLocaleString("en-US")} bytes).`,
    };
  }

  // Supported format, non-empty, within the size limit (Req 1.1).
  return { ok: true };
}
