import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { validateUpload } from "./validateUpload";

// Feature: harmograph, Property 1: Upload validation classifies any file deterministically

/**
 * Property 1: Upload validation classifies any file deterministically.
 *
 * For any file (arbitrary size including zero, arbitrary format/extension) and
 * configured `maxBytes`, `validateUpload` returns `ok: true` iff the format is a
 * Supported_Audio_Format (MP3/WAV) AND size > 0 AND size <= maxBytes; otherwise
 * it returns `ok: false` with reason:
 *   - "empty"              for zero (or non-positive) byte sizes
 *   - "unsupported_format" for a non-MP3/WAV format
 *   - "too_large"          for a size exceeding maxBytes
 *
 * The implementation's deterministic precedence is:
 *   empty > unsupported_format > too_large
 *
 * Validates: Requirements 1.2, 1.3, 1.4
 */

/** Independent restatement of the spec's Supported_Audio_Format detection. */
const SUPPORTED_MIME_TYPES = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/wave",
  "audio/x-wav",
  "audio/vnd.wave",
]);
const SUPPORTED_EXTENSIONS = [".mp3", ".wav"];

function isSupportedFormatOracle(name: string, type: string): boolean {
  const mime = type.trim().toLowerCase();
  if (mime !== "" && SUPPORTED_MIME_TYPES.has(mime)) {
    return true;
  }
  const lower = name.toLowerCase();
  return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// A pool of MIME types mixing supported, unsupported, and empty values. Casing
// is varied so the case-insensitive comparison is exercised.
const mimeArb = fc.constantFrom(
  "",
  "audio/mpeg",
  "audio/mp3",
  "AUDIO/WAV",
  "audio/wave",
  "audio/x-wav",
  "audio/vnd.wave",
  "audio/ogg",
  "audio/flac",
  "video/mp4",
  "image/png",
  "text/plain",
  "application/octet-stream",
);

// A pool of file extensions mixing supported (varied casing) and unsupported.
const extArb = fc.constantFrom(
  ".mp3",
  ".MP3",
  ".wav",
  ".WAV",
  ".Wav",
  ".mp4",
  ".ogg",
  ".flac",
  ".txt",
  ".png",
  "", // no extension at all
);

// File names built from an arbitrary basename plus an extension from the pool.
const nameArb = fc
  .tuple(
    fc.string({ minLength: 0, maxLength: 12 }).filter((s) => !s.includes(".")),
    extArb,
  )
  .map(([base, ext]) => `${base || "track"}${ext}`);

// Sizes spanning the meaningful boundaries: zero, small, and large values that
// can fall on either side of maxBytes.
const sizeArb = fc.oneof(
  fc.constant(0),
  fc.integer({ min: 1, max: 200_000_000 }),
);

// Configured maximum upload size — arbitrary positive bound.
const maxBytesArb = fc.integer({ min: 1, max: 200_000_000 });

const fileArb = fc.record({
  name: nameArb,
  type: mimeArb,
  size: sizeArb,
});

describe("validateUpload — Property 1: deterministic classification", () => {
  it("classifies any file by the empty > unsupported_format > too_large precedence", () => {
    fc.assert(
      fc.property(fileArb, maxBytesArb, (file, maxBytes) => {
        const result = validateUpload(file, maxBytes);

        const supported = isSupportedFormatOracle(file.name, file.type);
        const nonEmpty = file.size > 0;
        const withinLimit = file.size <= maxBytes;
        const shouldBeOk = supported && nonEmpty && withinLimit;

        // The iff: ok is true exactly when all three conditions hold.
        expect(result.ok).toBe(shouldBeOk);

        if (shouldBeOk) {
          expect(result).toEqual({ ok: true });
          return;
        }

        // Otherwise, the reason must follow the deterministic precedence.
        expect(result.ok).toBe(false);
        if (result.ok) return; // narrows the type for TS

        let expectedReason: "empty" | "unsupported_format" | "too_large";
        if (!nonEmpty) {
          expectedReason = "empty";
        } else if (!supported) {
          expectedReason = "unsupported_format";
        } else {
          expectedReason = "too_large";
        }

        expect(result.reason).toBe(expectedReason);
        // Every rejection carries a non-empty user-facing message.
        expect(typeof result.message).toBe("string");
        expect(result.message.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});
