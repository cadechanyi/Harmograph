import { describe, it, expect } from "vitest";
import {
  appConfig,
  MAX_UPLOAD_BYTES,
  PLAUSIBLE_TEMPO,
  DEFAULT_DEMUCS_ENDPOINT,
} from "./appConfig";

describe("appConfig", () => {
  it("uses 100 MB (104,857,600 bytes) as the max upload size", () => {
    expect(MAX_UPLOAD_BYTES).toBe(104_857_600);
    expect(appConfig.maxUploadBytes).toBe(104_857_600);
  });

  it("exposes the plausible tempo range [40, 250]", () => {
    expect(PLAUSIBLE_TEMPO).toEqual([40, 250]);
    expect(appConfig.plausibleTempo).toEqual([40, 250]);
  });

  it("has a positive max analysis duration", () => {
    expect(appConfig.maxAnalysisMs).toBeGreaterThan(0);
  });

  it("reads demucsEndpoint, falling back to the default when env is unset", () => {
    const expected =
      process.env.NEXT_PUBLIC_DEMUCS_ENDPOINT ?? DEFAULT_DEMUCS_ENDPOINT;
    expect(appConfig.demucsEndpoint).toBe(expected);
    expect(typeof appConfig.demucsEndpoint).toBe("string");
    expect(appConfig.demucsEndpoint.length).toBeGreaterThan(0);
  });
});
