/**
 * Deployment smoke test (task 18.1) — the Frontend honors the configured
 * Demucs_Service endpoint (Req 12.3).
 *
 * Two things are asserted here:
 *
 *   1. `appConfig.demucsEndpoint` resolves from `NEXT_PUBLIC_DEMUCS_ENDPOINT`
 *      when that env var is set, and falls back to the documented default
 *      (`DEFAULT_DEMUCS_ENDPOINT`) when it is unset. Because `appConfig` reads
 *      the env var at module-evaluation time, each case re-imports the module
 *      with `vi.resetModules()` after mutating `process.env`.
 *
 *   2. The Demucs client targets that configured endpoint for every request
 *      (`/separate`, `/health`, `/meta`). A stub `fetch` captures the request
 *      URL and we assert it is prefixed by the configured endpoint, proving the
 *      Frontend reaches the backend through the configurable network endpoint
 *      rather than a hard-coded host.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemucsClient } from "../demucs";

const ENV_KEY = "NEXT_PUBLIC_DEMUCS_ENDPOINT";

describe("deployment smoke: Frontend honors the configured demucsEndpoint (Req 12.3)", () => {
  const originalEnv = process.env[ENV_KEY];

  afterEach(() => {
    // Restore the original environment so other tests see a stable config.
    if (originalEnv === undefined) {
      delete process.env[ENV_KEY];
    } else {
      process.env[ENV_KEY] = originalEnv;
    }
    vi.resetModules();
  });

  it("resolves demucsEndpoint from NEXT_PUBLIC_DEMUCS_ENDPOINT when set", async () => {
    process.env[ENV_KEY] = "https://demucs.example.com";
    vi.resetModules();

    const { appConfig, DEMUCS_ENDPOINT } = await import("./appConfig");

    expect(DEMUCS_ENDPOINT).toBe("https://demucs.example.com");
    expect(appConfig.demucsEndpoint).toBe("https://demucs.example.com");
  });

  it("falls back to the documented default when the env var is unset", async () => {
    delete process.env[ENV_KEY];
    vi.resetModules();

    const { appConfig, DEMUCS_ENDPOINT, DEFAULT_DEMUCS_ENDPOINT } = await import(
      "./appConfig"
    );

    expect(DEFAULT_DEMUCS_ENDPOINT).toBe("http://localhost:8000");
    expect(DEMUCS_ENDPOINT).toBe(DEFAULT_DEMUCS_ENDPOINT);
    expect(appConfig.demucsEndpoint).toBe(DEFAULT_DEMUCS_ENDPOINT);
  });

  it("trims to a non-empty string usable as a base URL", async () => {
    process.env[ENV_KEY] = "https://stems.fly.dev";
    vi.resetModules();

    const { appConfig } = await import("./appConfig");

    expect(typeof appConfig.demucsEndpoint).toBe("string");
    expect(appConfig.demucsEndpoint.length).toBeGreaterThan(0);
  });
});

describe("deployment smoke: Demucs client targets the configured endpoint", () => {
  /** A stub fetch that records the URL it was called with and returns 200 JSON. */
  function recordingFetch(body: unknown) {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    return { calls, fetchFn };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("issues /health against the configured endpoint", async () => {
    const endpoint = "https://demucs.example.com";
    const { calls, fetchFn } = recordingFetch({
      status: "ok",
      model: "htdemucs",
      version: "0.1.0",
    });

    const client = createDemucsClient({
      endpoint,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    const result = await client.health();

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(`${endpoint}/health`);
    expect(calls[0].startsWith(endpoint)).toBe(true);
  });

  it("issues /meta against the configured endpoint", async () => {
    const endpoint = "https://stems.fly.dev";
    const { calls, fetchFn } = recordingFetch({
      max_bytes: 104857600,
      timeout_seconds: 600,
      accepted: ["mp3", "wav"],
    });

    const client = createDemucsClient({
      endpoint,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await client.meta();

    expect(calls[0]).toBe(`${endpoint}/meta`);
  });

  it("POSTs /separate against the configured endpoint", async () => {
    const endpoint = "https://stems.fly.dev/api";
    const { calls, fetchFn } = recordingFetch({
      job_id: "j1",
      duration_seconds: 1,
      format: "wav",
      stems: {},
    });

    const client = createDemucsClient({
      endpoint,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await client.separate(new File([new Uint8Array([1, 2, 3])], "song.wav"));

    expect(calls[0]).toBe(`${endpoint}/separate`);
  });

  it("uses appConfig.demucsEndpoint as the client base URL", async () => {
    process.env[ENV_KEY] = "https://configured.example.com";
    vi.resetModules();

    const { appConfig } = await import("./appConfig");
    const { calls, fetchFn } = recordingFetch({
      status: "ok",
      model: "htdemucs",
      version: "0.1.0",
    });

    const client = createDemucsClient({
      endpoint: appConfig.demucsEndpoint,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    await client.health();

    expect(calls[0]).toBe("https://configured.example.com/health");

    delete process.env[ENV_KEY];
    vi.resetModules();
  });
});
