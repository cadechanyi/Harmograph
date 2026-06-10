/**
 * Demucs Client (Frontend) — a thin, typed client over the API contract
 * between the Frontend and the Demucs_Service.
 *
 * Mirrors the design's "Demucs Client (Frontend)" component and
 * "API Contract: Frontend ⇄ Demucs_Service" section. Responsibilities:
 *
 *   - `separate(file)` — POST the audio file as `multipart/form-data` to
 *     `{endpoint}/separate`, parse the success / structured-error body, map
 *     each returned Demucs stem to a Stem_Type via `DEMUCS_TO_STEM`
 *     (`other → melody`, Req 4.9), and dispatch exactly one Analysis_Engine
 *     pass per returned stem (Req 4.8). `chords` is never produced by
 *     separation — it is derived from harmonic analysis of the mix elsewhere
 *     (Req 4.10), so it never appears in the routed stems.
 *   - `health()` — GET `{endpoint}/health`, carrying no audio (Req 12.7).
 *   - `meta()` — GET `{endpoint}/meta`, carrying no audio (Req 12.7).
 *
 * Audio is sent only on separation requests (Req 12.5); health/meta are
 * audio-free. When `/separate` cannot reach the service (network error / no
 * response), `separate` surfaces an "unavailable" result carrying the
 * "stem separation is unavailable" message rather than throwing, so the caller
 * can retain the loaded file and its in-browser analysis (Req 12.6).
 *
 * Both the network `fetch` implementation and the Analysis_Engine dispatcher
 * are injectable so the routing and per-stem-dispatch logic can be exercised
 * by property and integration tests with mocked dependencies.
 */

import type { DemucsStem, StemType } from "../models";
import { DEMUCS_TO_STEM } from "../models";

/** The message shown when stem separation is unreachable (Req 12.6). */
export const STEM_SEPARATION_UNAVAILABLE_MESSAGE =
  "stem separation is unavailable";

/** A single separated stem file descriptor returned by `POST /separate`. */
export interface SeparatedStem {
  /** URL to download the stem audio (a Supported_Audio_Format). */
  url: string;
  /** Size of the stem file in bytes. */
  bytes: number;
}

/** The four stems Demucs always returns, keyed by Demucs stem name (Req 4.1). */
export type DemucsStems = Record<DemucsStem, SeparatedStem>;

/** The documented `POST /separate` success body. */
export interface SeparateSuccessBody {
  job_id: string;
  duration_seconds: number;
  format: string;
  stems: DemucsStems;
}

/** The shared structured-error body shape for non-2xx responses. */
export interface StructuredErrorBody {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}

/** The `GET /health` success body. */
export interface HealthBody {
  status: string;
  model: string;
  version: string;
}

/** The `GET /meta` success body (service limits used for pre-validation). */
export interface MetaBody {
  max_bytes: number;
  timeout_seconds: number;
  accepted: string[];
}

/**
 * One returned Demucs stem routed to its resolved Stem_Type. `chords` never
 * appears here because Demucs has no chord stem (Req 4.10).
 */
export interface RoutedStem {
  /** The Demucs source stem key (`drums | bass | vocals | other`). */
  demucsStem: DemucsStem;
  /** The resolved Stem_Type via `DEMUCS_TO_STEM` (`other → melody`, Req 4.9). */
  stem: StemType;
  /** The separated stem file descriptor. */
  file: SeparatedStem;
}

/** The result of a `separate` call. Never thrown — always returned. */
export type SeparateResult =
  | {
      ok: true;
      jobId: string;
      durationSeconds: number;
      format: string;
      /** One entry per returned stem, in canonical Demucs order. */
      routed: RoutedStem[];
    }
  | {
      /** The service could not be reached (network error / no response). */
      ok: false;
      kind: "unavailable";
      message: string;
    }
  | {
      /** The service responded with a structured error body. */
      ok: false;
      kind: "error";
      status: number;
      code: string;
      message: string;
      details?: Record<string, unknown>;
    };

/** The result of a `health` call. */
export type HealthResult =
  | { ok: true; status: string; model: string; version: string }
  | { ok: false; kind: "unavailable" | "error"; status?: number; message: string };

/** The result of a `meta` call. */
export type MetaResult =
  | { ok: true; maxBytes: number; timeoutSeconds: number; accepted: string[] }
  | { ok: false; kind: "unavailable" | "error"; status?: number; message: string };

/**
 * The Analysis_Engine dependency the client dispatches to. Kept minimal and
 * injectable so a mocked dispatcher can assert exactly one pass per stem
 * (Req 4.8). The concrete Analysis_Engine (Meyda/Essentia) implements this.
 */
export interface StemAnalysisDispatcher {
  /** Run one analysis pass for the given resolved Stem_Type and stem file. */
  analyzeStem(stem: StemType, source: SeparatedStem): void | Promise<void>;
}

/** Construction options for {@link DemucsClient}. */
export interface DemucsClientOptions {
  /** The configurable Demucs_Service base endpoint (Req 12.3). */
  endpoint: string;
  /** Injectable `fetch`; defaults to the global `fetch`. */
  fetchFn?: typeof fetch;
  /** Injectable Analysis_Engine dispatcher used after a successful separation. */
  analyzer?: StemAnalysisDispatcher;
}

/** Canonical order of the four Demucs stems (matches the success body). */
const DEMUCS_STEM_ORDER: readonly DemucsStem[] = [
  "drums",
  "bass",
  "vocals",
  "other",
];

/** Type guard: a value is a well-formed {@link SeparatedStem}. */
function isSeparatedStem(value: unknown): value is SeparatedStem {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.url === "string" && typeof v.bytes === "number";
}

/**
 * Pure stem-routing rule: map each returned Demucs stem to its resolved
 * Stem_Type via `DEMUCS_TO_STEM` (`other → melody`, Req 4.9). Only present,
 * well-formed stem descriptors are routed. `chords` never appears because it
 * is not a Demucs stem (Req 4.10). Kept pure so it can be property-tested in
 * isolation (task 10.2).
 */
export function routeStems(stems: Partial<DemucsStems>): RoutedStem[] {
  const routed: RoutedStem[] = [];
  for (const demucsStem of DEMUCS_STEM_ORDER) {
    const file = stems[demucsStem];
    if (isSeparatedStem(file)) {
      routed.push({
        demucsStem,
        stem: DEMUCS_TO_STEM[demucsStem],
        file,
      });
    }
  }
  return routed;
}

/** Join a base endpoint and a path, tolerating a trailing slash on the base. */
function joinUrl(endpoint: string, path: string): string {
  return `${endpoint.replace(/\/+$/, "")}${path}`;
}

/**
 * A typed client over the Demucs_Service API contract. Network and analysis
 * dependencies are injectable for testing.
 */
export class DemucsClient {
  private readonly endpoint: string;
  private readonly fetchFn: typeof fetch;
  private readonly analyzer?: StemAnalysisDispatcher;

  constructor(options: DemucsClientOptions) {
    this.endpoint = options.endpoint;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
    this.analyzer = options.analyzer;
  }

  /**
   * POST the audio file to `{endpoint}/separate` as `multipart/form-data`
   * (the only request that carries audio, Req 12.5). On success, route each
   * returned stem (`other → melody`, Req 4.9) and dispatch exactly one
   * Analysis_Engine pass per returned stem (Req 4.8). On an unreachable
   * service, return an "unavailable" result carrying the
   * "stem separation is unavailable" message so the caller can retain the
   * loaded file and its in-browser analysis (Req 12.6).
   */
  async separate(file: File): Promise<SeparateResult> {
    const form = new FormData();
    form.append("file", file);

    let response: Response;
    try {
      response = await this.fetchFn(joinUrl(this.endpoint, "/separate"), {
        method: "POST",
        body: form,
      });
    } catch {
      // Network error / no response: the service is unreachable (Req 12.6).
      return {
        ok: false,
        kind: "unavailable",
        message: STEM_SEPARATION_UNAVAILABLE_MESSAGE,
      };
    }

    if (!response.ok) {
      return this.toErrorResult(response);
    }

    let body: SeparateSuccessBody;
    try {
      body = (await response.json()) as SeparateSuccessBody;
    } catch {
      // A 2xx with an unparseable body is treated as a service error.
      return {
        ok: false,
        kind: "error",
        status: response.status,
        code: "INVALID_RESPONSE",
        message: "separation response could not be parsed",
      };
    }

    const routed = routeStems(body.stems ?? {});

    // Dispatch exactly one Analysis_Engine pass per returned stem (Req 4.8).
    // `chords` is intentionally excluded — it is derived from the mix elsewhere
    // (Req 4.10). Passes run sequentially so a slow engine cannot drop one.
    if (this.analyzer) {
      for (const { stem, file: stemFile } of routed) {
        await this.analyzer.analyzeStem(stem, stemFile);
      }
    }

    return {
      ok: true,
      jobId: body.job_id,
      durationSeconds: body.duration_seconds,
      format: body.format,
      routed,
    };
  }

  /**
   * GET `{endpoint}/health`. Carries no audio (Req 12.7). A non-2xx response or
   * no response indicates the service is unreachable (Req 12.6).
   */
  async health(): Promise<HealthResult> {
    let response: Response;
    try {
      response = await this.fetchFn(joinUrl(this.endpoint, "/health"), {
        method: "GET",
      });
    } catch {
      return {
        ok: false,
        kind: "unavailable",
        message: STEM_SEPARATION_UNAVAILABLE_MESSAGE,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        kind: "error",
        status: response.status,
        message: `health check failed with status ${response.status}`,
      };
    }

    const body = (await response.json()) as HealthBody;
    return {
      ok: true,
      status: body.status,
      model: body.model,
      version: body.version,
    };
  }

  /**
   * GET `{endpoint}/meta`. Carries no audio (Req 12.7). Returns service limits
   * the Frontend can use to pre-validate uploads.
   */
  async meta(): Promise<MetaResult> {
    let response: Response;
    try {
      response = await this.fetchFn(joinUrl(this.endpoint, "/meta"), {
        method: "GET",
      });
    } catch {
      return {
        ok: false,
        kind: "unavailable",
        message: STEM_SEPARATION_UNAVAILABLE_MESSAGE,
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        kind: "error",
        status: response.status,
        message: `meta request failed with status ${response.status}`,
      };
    }

    const body = (await response.json()) as MetaBody;
    return {
      ok: true,
      maxBytes: body.max_bytes,
      timeoutSeconds: body.timeout_seconds,
      accepted: body.accepted,
    };
  }

  /** Parse a non-2xx `/separate` response into a structured error result. */
  private async toErrorResult(response: Response): Promise<SeparateResult> {
    let code = "SEPARATION_FAILED";
    let message = `separation failed with status ${response.status}`;
    let details: Record<string, unknown> | undefined;
    try {
      const body = (await response.json()) as Partial<StructuredErrorBody>;
      if (body.error) {
        code = body.error.code ?? code;
        message = body.error.message ?? message;
        details = body.error.details;
      }
    } catch {
      // Keep the default code/message when the error body is unparseable.
    }
    return {
      ok: false,
      kind: "error",
      status: response.status,
      code,
      message,
      ...(details ? { details } : {}),
    };
  }
}

/** Factory for a {@link DemucsClient} with the given options. */
export function createDemucsClient(options: DemucsClientOptions): DemucsClient {
  return new DemucsClient(options);
}
