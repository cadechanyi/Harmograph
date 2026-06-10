import { describe, it, expect, vi } from "vitest";
import {
  DemucsClient,
  createDemucsClient,
  routeStems,
  STEM_SEPARATION_UNAVAILABLE_MESSAGE,
  type DemucsStems,
  type SeparateSuccessBody,
} from "./DemucsClient";

/** Build a well-formed four-stem success body for tests. */
function successBody(): SeparateSuccessBody {
  return {
    job_id: "job-1",
    duration_seconds: 120,
    format: "wav",
    stems: {
      drums: { url: "/stems/job-1/drums.wav", bytes: 10 },
      bass: { url: "/stems/job-1/bass.wav", bytes: 11 },
      vocals: { url: "/stems/job-1/vocals.wav", bytes: 12 },
      other: { url: "/stems/job-1/other.wav", bytes: 13 },
    },
  };
}

/** A minimal JSON Response stub. */
function jsonResponse(body: unknown, init?: { ok?: boolean; status?: number }): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    json: async () => body,
  } as unknown as Response;
}

describe("routeStems (Req 4.9, 4.10)", () => {
  it("maps the Demucs other stem to melody and never yields chords", () => {
    const routed = routeStems(successBody().stems);
    const byDemucs = Object.fromEntries(routed.map((r) => [r.demucsStem, r.stem]));
    expect(byDemucs.other).toBe("melody");
    expect(byDemucs.drums).toBe("drums");
    expect(byDemucs.bass).toBe("bass");
    expect(byDemucs.vocals).toBe("vocals");
    expect(routed.some((r) => r.stem === "chords")).toBe(false);
  });

  it("skips missing or malformed stem descriptors", () => {
    const partial = {
      drums: { url: "/d.wav", bytes: 1 },
      bass: { url: "/b.wav" }, // malformed: no bytes
    } as unknown as Partial<DemucsStems>;
    const routed = routeStems(partial);
    expect(routed.map((r) => r.demucsStem)).toEqual(["drums"]);
  });
});

describe("DemucsClient.separate (Req 4.8, 4.9, 12.5, 12.6)", () => {
  it("dispatches exactly one analysis pass per returned stem on success", async () => {
    const analyzeStem = vi.fn();
    const fetchFn = vi.fn(async () => jsonResponse(successBody()));
    const client = new DemucsClient({
      endpoint: "http://svc",
      fetchFn: fetchFn as unknown as typeof fetch,
      analyzer: { analyzeStem },
    });

    const result = await client.separate(new File(["x"], "song.wav"));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routed).toHaveLength(4);
    // Exactly one pass per returned stem; none for chords (Req 4.8, 4.10).
    expect(analyzeStem).toHaveBeenCalledTimes(4);
    const dispatched = analyzeStem.mock.calls.map((c) => c[0]).sort();
    expect(dispatched).toEqual(["bass", "drums", "melody", "vocals"]);
  });

  it("POSTs multipart audio to /separate", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse(successBody()),
    );
    const client = new DemucsClient({
      endpoint: "http://svc/",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await client.separate(new File(["x"], "song.wav"));

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://svc/separate");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeInstanceOf(FormData);
    expect((init?.body as FormData).has("file")).toBe(true);
  });

  it("returns the unavailable message on a network error and does not throw (Req 12.6)", async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError("network down");
    });
    const analyzeStem = vi.fn();
    const client = new DemucsClient({
      endpoint: "http://svc",
      fetchFn: fetchFn as unknown as typeof fetch,
      analyzer: { analyzeStem },
    });

    const result = await client.separate(new File(["x"], "song.wav"));

    expect(result).toEqual({
      ok: false,
      kind: "unavailable",
      message: STEM_SEPARATION_UNAVAILABLE_MESSAGE,
    });
    // No analysis dispatched, so the caller can retain prior state.
    expect(analyzeStem).not.toHaveBeenCalled();
  });

  it("surfaces a structured server error body", async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        { error: { code: "FILE_TOO_LARGE", message: "too big", details: { max_bytes: 100 } } },
        { ok: false, status: 413 },
      ),
    );
    const client = new DemucsClient({
      endpoint: "http://svc",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await client.separate(new File(["x"], "song.wav"));
    expect(result).toEqual({
      ok: false,
      kind: "error",
      status: 413,
      code: "FILE_TOO_LARGE",
      message: "too big",
      details: { max_bytes: 100 },
    });
  });
});

describe("DemucsClient.health / meta carry no audio (Req 12.7)", () => {
  it("GETs /health with no body", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ status: "ok", model: "demucs", version: "1.0" }),
    );
    const client = createDemucsClient({
      endpoint: "http://svc",
      fetchFn: fetchFn as unknown as typeof fetch,
    });

    const result = await client.health();
    expect(result).toEqual({ ok: true, status: "ok", model: "demucs", version: "1.0" });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://svc/health");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
  });

  it("GETs /meta with no body", async () => {
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      jsonResponse({ max_bytes: 104857600, timeout_seconds: 600, accepted: ["mp3", "wav"] }),
    );
    const client = createDemucsClient({
      endpoint: "http://svc",
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
    expect(url).toBe("http://svc/meta");
    expect(init?.method).toBe("GET");
    expect(init?.body).toBeUndefined();
  });

  it("reports unavailable when health cannot reach the service", async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error("no route");
    });
    const client = createDemucsClient({
      endpoint: "http://svc",
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const result = await client.health();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe("unavailable");
  });
});
