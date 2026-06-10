import { describe, it, expect } from "vitest";
import { validateUpload } from "./validateUpload";
import { MAX_UPLOAD_BYTES } from "../config/appConfig";

/**
 * Example/unit tests for the pure `validateUpload` function (Req 1.1-1.4).
 * Universal-invariant coverage lives in the Property 1 property test (task 6.2).
 */

type Fixture = { name: string; type: string; size: number };

const mp3 = (size: number): Fixture => ({
  name: "song.mp3",
  type: "audio/mpeg",
  size,
});
const wav = (size: number): Fixture => ({
  name: "song.wav",
  type: "audio/wav",
  size,
});

describe("validateUpload", () => {
  it("accepts a non-empty MP3 within the size limit (Req 1.1)", () => {
    expect(validateUpload(mp3(1_000), MAX_UPLOAD_BYTES)).toEqual({ ok: true });
  });

  it("accepts a non-empty WAV within the size limit (Req 1.1)", () => {
    expect(validateUpload(wav(1_000), MAX_UPLOAD_BYTES)).toEqual({ ok: true });
  });

  it("accepts a file at exactly the size limit (boundary)", () => {
    expect(validateUpload(mp3(MAX_UPLOAD_BYTES), MAX_UPLOAD_BYTES)).toEqual({
      ok: true,
    });
  });

  it("accepts based on extension when MIME type is missing", () => {
    expect(
      validateUpload({ name: "track.WAV", type: "", size: 500 }, MAX_UPLOAD_BYTES),
    ).toEqual({ ok: true });
  });

  it("rejects a zero-byte file as empty (Req 1.4)", () => {
    const result = validateUpload(mp3(0), MAX_UPLOAD_BYTES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("empty");
      expect(result.message).toMatch(/empty/i);
    }
  });

  it("reports empty before format for a zero-byte unsupported file (precedence)", () => {
    const result = validateUpload(
      { name: "doc.txt", type: "text/plain", size: 0 },
      MAX_UPLOAD_BYTES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("empty");
  });

  it("rejects an unsupported format and names accepted formats (Req 1.2)", () => {
    const result = validateUpload(
      { name: "image.png", type: "image/png", size: 1_000 },
      MAX_UPLOAD_BYTES,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unsupported_format");
      expect(result.message).toMatch(/MP3/i);
      expect(result.message).toMatch(/WAV/i);
    }
  });

  it("rejects a file exceeding the size limit and states the max (Req 1.3)", () => {
    const result = validateUpload(mp3(MAX_UPLOAD_BYTES + 1), MAX_UPLOAD_BYTES);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("too_large");
      expect(result.message).toMatch(/100 MB/);
    }
  });
});
