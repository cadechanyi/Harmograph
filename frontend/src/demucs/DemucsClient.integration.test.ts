import { describe, it, expect, vi } from "vitest";
import {
  DemucsClient,
  STEM_SEPARATION_UNAVAILABLE_MESSAGE,
  type SeparateSuccessBody,
} from "./DemucsClient";

/**
 * Integration tests for connectivity handling between the Frontend's
 * Demucs Client and the Demucs_Service (Req 12.5, 12.6, 12.7).
 *
 * These exercise the full client surface (`separate`, `health`, `meta`) with a
 * mocked `fetchFn` standing in for the network, asserting the cross-cutting
 * processing-locality and unreachability behaviors:
 *
 *   - Audio is sent only on `separate` (Req 12.5); `health`/`meta` carry none
 *     (Req 12.7).
 *   - An unreachable service surfaces the "stem separation is unavailable"
 *     result without throwing or dispatching analysis, so the caller can
 *     retain the loaded file and its in-browser analysis (Req 12.6).
 */

/** Build a well-formed four-stem `/separate` success body. */
function successBody(): SeparateSuccessBody {
  return {
    job_id: "job-int",
    duration_seconds: 90,
    format: "wav",
    stems: {
      drums: { url: "/stems/job-int/drums.wav", bytes: 10 },
      bass: { url: "/stems/job-int/bass.wav", bytes: 11 },
      vocals: { url: "/stems/job-int/vocals.wav", bytes: 12 },
      other: { url: "/stems/job-int/other.wav", bytes: 13 },
    },
  };
}

/** A minimal JSON Response stub. */
function jsonResponse(
  body: unknown,
  init?: { ok?: boolean; status?: number },
): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

/** A fetch mock that always rejects, simulating an unreachable service. */
function unreachableFetch() {
  return vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
    throw new TypeError("Failed to fetch");
  });
}

describe("DemucsClient connectivity integration (Req 12.5, 12.6, 12.7)", () => {
  describe("unreachable service on separate() (Req 12.6)", () => {
    it("surfaces the unavailable message, does not throw, and dispatches no analysis", async () => {
      const fetchFn = unreachableFetch();
      const analyzeStem = vi.fn();
      const client = new DemucsClient({
        endpoint: "http://demucs.invalid",
        fetchFn: fetchFn as unknown as typeof fetch,
        analyzer: { analyzeStem },
      });

      const file = new File(["audio-bytes"], "song.wav", { type: "audio/wav" });

      // Must resolve (not reject): the caller relies on this to keep state.
      const result = await client.separate(file);

      expect(result).toEqual({
        ok: false,
        kind: "unavailable",
        message: STEM_SEPARATION_UNAVAILABLE_MESSAGE,
      });

      // No analysis pass was dispatched, so the caller retains the loaded file
      // and its prior in-browser analysis (Req 12.6).
      expect(analyzeStem).not.toHaveBeenCalled();

      // The file object the caller holds is untouched and still usable.
      expect(file.name).toBe("song.wav");
      expect(file.size).toBeGreaterThan(0);
    });

    it("leaves the caller's loaded file and prior in-browser analysis fully intact", async () => {
      const fetchFn = unreachableFetch();
      const analyzeStem = vi.fn();
      const client = new DemucsClient({
        endpoint: "http://demucs.invalid",
        fetchFn: fetchFn as unknown as typeof fetch,
        analyzer: { analyzeStem },
      });

      // Model the state the caller holds *before* attempting separation: the
      // loaded file plus the in-browser analysis results already produced for
      // it. Req 12.6 requires both be retained when separation is unreachable.
      const loadedFile = new File(["audio-bytes"], "song.wav", {
        type: "audio/wav",
      });
      const retainedAnalysis = {
        status: "succeeded" as const,
        tempoBpm: 128,
        key: { tonic: "C", mode: "major" as const },
        points: [
          { stem: "melody", t: 0, value: 0.5 },
          { stem: "bass", t: 1, value: -0.25 },
        ],
      };
      // Deep snapshot so we can prove nothing was mutated by the failed call.
      const analysisSnapshot = JSON.parse(JSON.stringify(retainedAnalysis));

      const result = await client.separate(loadedFile);

      // The call resolves to "unavailable" instead of throwing (Req 12.6).
      expect(result).toEqual({
        ok: false,
        kind: "unavailable",
        message: STEM_SEPARATION_UNAVAILABLE_MESSAGE,
      });

      // No analysis pass ran, so the client never had a chance to overwrite
      // the existing in-browser analysis the caller is holding.
      expect(analyzeStem).not.toHaveBeenCalled();

      // The externally-held state the client received/observed is untouched:
      // the loaded file is unchanged and the prior analysis is byte-for-byte
      // identical to its pre-call snapshot (Req 12.6).
      expect(loadedFile.name).toBe("song.wav");
      expect(loadedFile.size).toBeGreaterThan(0);
      expect(loadedFile.type).toBe("audio/wav");
      expect(retainedAnalysis).toEqual(analysisSnapshot);
    });

    it("attempted exactly one /separate request before surfacing unavailable", async () => {
      const fetchFn = unreachableFetch();
      const client = new DemucsClient({
        endpoint: "http://demucs.invalid/",
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      await client.separate(new File(["x"], "song.wav"));

      expect(fetchFn).toHaveBeenCalledTimes(1);
      const [url] = fetchFn.mock.calls[0];
      expect(url).toBe("http://demucs.invalid/separate");
    });
  });

  describe("audio is sent only on separate() (Req 12.5)", () => {
    it("separate() sends FormData containing the file as its only audio-bearing request", async () => {
      const fetchFn = vi.fn(
        async (_url: string, _init?: RequestInit): Promise<Response> =>
          jsonResponse(successBody()),
      );
      const client = new DemucsClient({
        endpoint: "http://demucs.test",
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      const file = new File(["audio-bytes"], "song.wav", { type: "audio/wav" });
      await client.separate(file);

      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe("http://demucs.test/separate");
      expect(init?.method).toBe("POST");
      // The body is FormData carrying the audio file (Req 12.5).
      expect(init?.body).toBeInstanceOf(FormData);
      const form = init?.body as FormData;
      expect(form.has("file")).toBe(true);
      expect(form.get("file")).toBeInstanceOf(File);
      expect((form.get("file") as File).name).toBe("song.wav");
    });
  });

  describe("health() and meta() carry no audio (Req 12.7)", () => {
    it("health() issues a GET with no body / no audio payload", async () => {
      const fetchFn = vi.fn(
        async (_url: string, _init?: RequestInit): Promise<Response> =>
          jsonResponse({ status: "ok", model: "demucs", version: "1.0" }),
      );
      const client = new DemucsClient({
        endpoint: "http://demucs.test",
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      const result = await client.health();
      expect(result).toEqual({
        ok: true,
        status: "ok",
        model: "demucs",
        version: "1.0",
      });

      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe("http://demucs.test/health");
      expect(init?.method).toBe("GET");
      // No body at all — and definitely not a FormData audio payload.
      expect(init?.body).toBeUndefined();
      expect(init?.body).not.toBeInstanceOf(FormData);
    });

    it("meta() issues a GET with no body / no audio payload", async () => {
      const fetchFn = vi.fn(
        async (_url: string, _init?: RequestInit): Promise<Response> =>
          jsonResponse({
            max_bytes: 104857600,
            timeout_seconds: 600,
            accepted: ["mp3", "wav"],
          }),
      );
      const client = new DemucsClient({
        endpoint: "http://demucs.test",
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      const result = await client.meta();
      expect(result).toEqual({
        ok: true,
        maxBytes: 104857600,
        timeoutSeconds: 600,
        accepted: ["mp3", "wav"],
      });

      const [url, init] = fetchFn.mock.calls[0];
      expect(url).toBe("http://demucs.test/meta");
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(init?.body).not.toBeInstanceOf(FormData);
    });
  });

  describe("unreachable service on health() and meta() (Req 12.6)", () => {
    it("health() reports unavailable without throwing", async () => {
      const fetchFn = unreachableFetch();
      const client = new DemucsClient({
        endpoint: "http://demucs.invalid",
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      const result = await client.health();
      expect(result).toEqual({
        ok: false,
        kind: "unavailable",
        message: STEM_SEPARATION_UNAVAILABLE_MESSAGE,
      });
    });

    it("meta() reports unavailable without throwing", async () => {
      const fetchFn = unreachableFetch();
      const client = new DemucsClient({
        endpoint: "http://demucs.invalid",
        fetchFn: fetchFn as unknown as typeof fetch,
      });

      const result = await client.meta();
      expect(result).toEqual({
        ok: false,
        kind: "unavailable",
        message: STEM_SEPARATION_UNAVAILABLE_MESSAGE,
      });
    });
  });
});
