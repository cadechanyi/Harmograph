/**
 * Application configuration for the Harmograph Frontend.
 *
 * Mirrors the design's Configuration data model. The Frontend reaches the
 * Demucs_Service through a configurable network endpoint so the two components
 * can be deployed independently (Req 12.1, 12.3).
 */
export interface AppConfig {
  /** Maximum upload size in bytes — 100 MB (Req 1.3). */
  maxUploadBytes: number;
  /** Maximum in-browser analysis duration in milliseconds (Req 3.5). */
  maxAnalysisMs: number;
  /** Plausible tempo range in BPM, inclusive (Req 8.1, 8.2). */
  plausibleTempo: [number, number];
  /** Configurable Demucs_Service network endpoint (Req 12.3). */
  demucsEndpoint: string;
}

/** 100 MB in bytes (Req 1.3). */
export const MAX_UPLOAD_BYTES = 104_857_600;

/** Default maximum in-browser analysis duration in milliseconds (Req 3.5). */
export const DEFAULT_MAX_ANALYSIS_MS = 60_000;

/** Plausible tempo range in BPM, inclusive (Req 8.1, 8.2). */
export const PLAUSIBLE_TEMPO: [number, number] = [40, 250];

/** Fallback endpoint used when NEXT_PUBLIC_DEMUCS_ENDPOINT is not set. */
export const DEFAULT_DEMUCS_ENDPOINT = "http://localhost:8000";

/**
 * The configurable Demucs_Service endpoint, read from the public env var so it
 * is available in the browser bundle (Req 12.3).
 */
export const DEMUCS_ENDPOINT =
  process.env.NEXT_PUBLIC_DEMUCS_ENDPOINT ?? DEFAULT_DEMUCS_ENDPOINT;

/** The active application configuration instance. */
export const appConfig: AppConfig = {
  maxUploadBytes: MAX_UPLOAD_BYTES,
  maxAnalysisMs: DEFAULT_MAX_ANALYSIS_MS,
  plausibleTempo: PLAUSIBLE_TEMPO,
  demucsEndpoint: DEMUCS_ENDPOINT,
};
