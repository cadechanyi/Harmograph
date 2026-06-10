# Implementation Plan: Harmograph

## Overview

This plan implements Harmograph as two independently deployable artifacts: a Python FastAPI **Demucs_Service** (backend, group 1) and a Next.js 14 + React + TypeScript **Frontend** (groups 2–5). Work proceeds in five ordered groups — backend setup and frontend scaffold first (so both deployment artifacts and the component tree exist), then the audio pipeline (decode/playback, analysis, timeline, coordinate system, Demucs client), then the p5.js graph renderers, and finally integration and polish (overlay wiring, full upload→separation→analysis→render flow, deployment smoke tests).

The Frontend pure-logic layer is implemented in TypeScript and the backend in Python. Property-based tests use **fast-check** (≥100 iterations each), tagged `// Feature: harmograph, Property N: ...`, and cover the 17 correctness properties from the design. Unit/example, integration, and smoke tests follow the design's Testing Strategy. Test sub-tasks are marked optional with `*` and may be skipped for a faster MVP.

## Tasks

### Group 1 — Backend setup (Demucs_Service)

- [x] 1. Scaffold the Demucs_Service FastAPI application
  - [x] 1.1 Create FastAPI project skeleton and app entrypoint
    - Create the Python project layout (e.g. `backend/app/`), `requirements.txt`/`pyproject.toml`, FastAPI app instance, and the route stubs `POST /separate`, `GET /health`, `GET /meta`
    - Define a shared structured error body helper returning `{ "error": { "code, message, details } }`
    - _Requirements: 4.7, 12.2_

  - [x] 1.2 Implement request validation (content type and size)
    - Reject non-MP3/WAV bodies with `415 UNSUPPORTED_FORMAT` including `details.accepted = ["mp3","wav"]`
    - Reject missing/empty file field with `400 INVALID_REQUEST`
    - Reject files exceeding the configured max separation size with `413 FILE_TOO_LARGE` including `details.max_bytes`
    - _Requirements: 4.2, 4.3_

  - [x] 1.3 Implement Demucs separation in `POST /separate`
    - Invoke the `htdemucs` 4-stem model, returning `drums`, `bass`, `vocals`, `other`, each a Supported_Audio_Format, with the documented success body (`job_id`, `duration_seconds`, `format`, `stems`)
    - _Requirements: 4.1_

  - [x] 1.4 Implement processing timeout and server-error handling
    - Enforce the configured maximum processing time, responding `504 PROCESSING_TIMEOUT` with `details.timeout_seconds` and no stem files
    - Respond `500 SEPARATION_FAILED` when separation fails during processing
    - Respond `503 SERVICE_UNAVAILABLE` for resource exhaustion / unavailability
    - _Requirements: 4.4, 4.5, 4.6_

  - [x] 1.5 Implement `GET /health` and `GET /meta`
    - `GET /health` returns `200 { status, model, version }` when ready; `GET /meta` returns `{ max_bytes, timeout_seconds, accepted }`
    - Ensure both endpoints accept no audio data
    - _Requirements: 12.7_

  - [x] 1.6 Write integration tests for the Demucs_Service API
    - Assert 4-stem success body shape; assert `415/413/400/500/504/503` error paths return correct status codes and structured bodies with no stem files
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 2. Dockerize the Demucs_Service for independent deployment
  - [x] 2.1 Author the Dockerfile and deployment config
    - Create a Dockerfile that bundles the FastAPI app and Demucs model weights; add Fly.io/Modal deployment configuration so the service deploys independently of the Frontend
    - _Requirements: 4.7, 12.1, 12.2_

- [x] 3. Checkpoint - backend
  - Ensure all tests pass, ask the user if questions arise.

### Group 2 — Frontend scaffold

- [x] 4. Scaffold the Next.js 14 frontend project
  - [x] 4.1 Initialize Next.js 14 (App Router) + React + TypeScript + Tailwind
    - Create the project, configure Tailwind, TypeScript, ESLint, and the Vitest test runner with fast-check installed
    - Add the configurable `NEXT_PUBLIC_DEMUCS_ENDPOINT` and an `AppConfig` (`maxUploadBytes = 104857600`, `maxAnalysisMs`, `plausibleTempo = [40,250]`, `demucsEndpoint`)
    - _Requirements: 12.1, 12.3_

  - [x] 4.2 Define core data-model types and constants
    - Implement `StemType`, `DemucsStem`, `TimelinePoint`, `PitchClass`, `GraphStyle`, `DEMUCS_TO_STEM`, `DEFAULT_STYLE`, `StemConfig`/`StemConfigMap`
    - _Requirements: 10.1, 10.2, 4.9, 7.6_

  - [x] 4.3 Build the React component tree and state stores
    - Create `HarmographPage`, `CanvasStage`, `P5Canvas` wrapper, and `UIOverlay` with child panels (`UploadPanel`, `PlaybackControls`, `StemTogglePanel`/`StemToggle`, `GraphStylePanel`/`GraphStylePicker`, `CoordinateUnitPicker`, `TempoKeyReadout`, `StatusBanner`)
    - Create the state stores (playback, timeline index, stem config, analysis status) wired into `HarmographPage`; render placeholder content so the tree mounts
    - _Requirements: 6.3_

- [x] 5. Checkpoint - frontend scaffold
  - Ensure all tests pass, ask the user if questions arise.

### Group 3 — Audio pipeline

- [x] 6. Implement upload validation and the Audio_Engine
  - [x] 6.1 Implement `validateUpload` pure function
    - Classify any file as `ok` only when format is MP3/WAV, size > 0, and size ≤ `maxBytes`; otherwise return `empty`, `unsupported_format`, or `too_large` with the matching message
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

  - [x] 6.2 Write property test for upload validation
    - **Property 1: Upload validation classifies any file deterministically**
    - **Validates: Requirements 1.2, 1.3, 1.4**

  - [x] 6.3 Implement the Audio_Engine (Web Audio decode/playback)
    - Implement `load` (decode → duration > 0, `decode_failed` on undecodable), `play`/`pause` (default position 0, retain on pause), `onEnded` suspend-at-duration, `getCurrentTime` updated ≥30 Hz, `getDuration`, `isLoaded`
    - Implement `seek` clamping the requested time into `[0, duration]`
    - _Requirements: 1.1, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 6.4 Write property test for seek clamping
    - **Property 2: Seek position is always clamped into the playback range**
    - **Validates: Requirements 2.3, 2.5**

  - [x] 6.5 Write unit/example tests for playback lifecycle
    - Test play-from-zero default, pause-retain, play-with-no-file guard (message displayed), end-of-song suspend
    - _Requirements: 2.1, 2.2, 2.6, 2.7_

  - [x] 6.6 Write integration tests for browser audio
    - Load a real MP3/WAV → duration > 0; corrupt file → decode error; assert `getCurrentTime` cadence ≥ 30 Hz
    - _Requirements: 1.1, 1.5, 1.6, 2.4_

- [x] 7. Implement the Timeline_Stream
  - [x] 7.1 Implement Timeline_Stream validation, routing, and ordering
    - Implement `emit` (accept only numeric `t ∈ [0, songDuration]`, numeric `value ∈ [-1,1]`, valid `stem`; exclude invalid and retain prior), `subscribe` (deliver only that stem's points), `getPoints` (kept sorted, non-decreasing `t`)
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_

  - [x] 7.2 Write property test for Timeline_Point normalization
    - **Property 3: Every emitted Timeline_Point satisfies the normalized data model**
    - **Validates: Requirements 3.4, 10.1, 10.2**

  - [x] 7.3 Write property test for invalid-candidate exclusion
    - **Property 4: Invalid candidates are excluded and prior points retained**
    - **Validates: Requirements 10.4**

  - [x] 7.4 Write property test for per-stem subscriber routing
    - **Property 7: Subscribers receive only their stem's points**
    - **Validates: Requirements 10.3**

  - [x] 7.5 Write property test for non-decreasing delivery order
    - **Property 8: Points are delivered in non-decreasing time order**
    - **Validates: Requirements 10.5**

- [x] 8. Implement the Analysis_Engine
  - [x] 8.1 Implement Meyda + Essentia feature extraction and normalization
    - Run Meyda (RMS, spectral envelope → drum onsets) and Essentia (tempo, key, melody pitch, chords); normalize each raw feature into `[-1,1]` and emit `Timeline_Point`s via the Timeline_Stream; derive `chords` from harmonic analysis of the mix
    - Maintain `AnalysisStatus` (pending/succeeded/failed, `tempoBpm`, `key`); on full failure/timeout show "analysis failed" and keep audio playable; on partial failure report which features failed while still emitting succeeded features
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 4.10_

  - [x] 8.2 Write property test for partial-failure resilience
    - **Property 9: Partial analysis failure does not suppress succeeded features**
    - **Validates: Requirements 3.7**

  - [x] 8.3 Write integration tests for in-browser analysis
    - On a known sample, assert Meyda/Essentia produce RMS, spectral/onset, tempo, key, and melody points
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 9. Implement the Coordinate_System
  - [x] 9.1 Implement axis mapping and clamping
    - Implement `setSongDuration` (x-range `[0, max(d,1)]`), `setYUnit`, `activeYRange` (`[-1,1]`/`[20,20000]`/`[0,127]`/`[-60,0]`), `xToCanvas`, and `yToCanvas` clamping value into the active y-range before mapping
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 9.2 Write property test for coordinate mapping and clamping
    - **Property 10: Coordinate mapping selects correct ranges and clamps to canvas**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

- [x] 10. Implement the Demucs client (Frontend)
  - [x] 10.1 Implement the typed Demucs client and stem routing
    - Implement `separate`/`health`/`meta` calls against the configurable endpoint; on success map `other → melody` via `DEMUCS_TO_STEM` and dispatch exactly one Analysis_Engine pass per returned stem; on unreachable service show "stem separation is unavailable" and retain the loaded file and its in-browser analysis
    - Send audio only on separation requests; keep health/meta audio-free
    - _Requirements: 4.8, 4.9, 4.10, 12.4, 12.5, 12.6, 12.7_

  - [x] 10.2 Write property test for Demucs stem routing
    - **Property 5: Demucs stems route correctly and chords never come from separation**
    - **Validates: Requirements 4.9, 4.10**

  - [x] 10.3 Write property test for per-stem analysis dispatch
    - **Property 6: Each returned stem triggers exactly one analysis pass** (use a mocked Analysis_Engine)
    - **Validates: Requirements 4.8**

  - [x] 10.4 Write integration tests for connectivity handling
    - Unreachable service → message shown + file/analysis retained; assert health/meta carry no audio
    - _Requirements: 12.5, 12.6, 12.7_

- [x] 11. Checkpoint - audio pipeline
  - Ensure all tests pass, ask the user if questions arise.

### Group 4 — Graph renderers

- [x] 12. Implement the Graph_Renderer p5 instance and render-gating
  - [x] 12.1 Implement the Graph_Renderer draw loop and playhead sync
    - Mount a single p5 instance; position the graph x at the current playback time while playing (within 100 ms) and hold at the retained time while paused; set/replace the Coordinate_System; delegate per-stem drawing
    - Gate rendering so a Stem_Renderer with an empty point buffer draws no element
    - _Requirements: 5.1, 5.7, 5.8, 5.10, 9.6_

  - [x] 12.2 Write property test for empty-buffer render gating
    - **Property 11: A stem with no points renders no element**
    - **Validates: Requirements 5.10, 6.5**

- [x] 13. Implement the five Stem_Renderers with default styles
  - [x] 13.1 Implement the drums Stem_Renderer (bouncing balls)
    - Render balls falling under constant downward acceleration; reset every ball to the top of the active y-range on kick onset
    - _Requirements: 5.2, 5.9_

  - [x] 13.2 Implement the melody, bass, vocals, and chords Stem_Renderers
    - Melody: continuous parametric curve of pitch frequency; bass: sine wave whose amplitude is low-band energy; vocals: RMS envelope rising with vocal presence; chords: stacked translucent curves; each ingests its Timeline_Points and updates its animation
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7_

  - [x] 13.3 Write property test for drum ball physics
    - **Property 17: Drum balls fall under constant acceleration and reset on kick onset**
    - **Validates: Requirements 5.2, 5.9**

  - [x] 13.4 Write unit/example tests for melody/bass/vocals/chords renderers
    - Assert renderer state/snapshots for the four non-drum styles and Timeline_Point ingestion
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.7_

- [x] 14. Checkpoint - renderers
  - Ensure all tests pass, ask the user if questions arise.

### Group 5 — Integration and polish

- [x] 15. Implement UI_Overlay controls and stem/style resolution
  - [x] 15.1 Implement pointer-event routing and stacking order
    - Render the overlay above the canvas; give the container `pointer-events: none` and interactive controls `pointer-events: auto` so control events are handled (not forwarded) and empty-region events fall through to the canvas
    - _Requirements: 11.1, 11.2, 11.3_

  - [x] 15.2 Implement stem toggles and style/unit pickers
    - Present exactly five Stem_Toggles (all enabled on load); toggling a stem starts/stops only that stem's element within 100 ms; present a Graph_Style picker per stem listing all defined styles (disabling those whose data is unavailable) and applying selections from the next frame; resolve unselected stems to their table default; present the y-unit picker driving the Coordinate_System
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 9.6_

  - [x] 15.3 Write property test for toggle isolation
    - **Property 12: Toggling a stem affects only that stem**
    - **Validates: Requirements 6.1, 6.2**

  - [x] 15.4 Write property test for toggle set coverage
    - **Property 13: The toggle set always covers exactly the five stems**
    - **Validates: Requirements 6.3**

  - [x] 15.5 Write property test for default style resolution
    - **Property 14: An unselected stem resolves to its table default style**
    - **Validates: Requirements 7.5, 7.6**

  - [x] 15.6 Write unit/example tests for toggle and style picker behaviors
    - Toggle initialization all-enabled on load; style picker presence/listing/disabled-when-data-missing/apply; coordinate and style changes applied to subsequent frames
    - _Requirements: 6.4, 7.1, 7.2, 7.3, 7.4, 9.6_

  - [x] 15.7 Write integration tests for pointer-event routing
    - Control events not forwarded; empty-region events forwarded; overlay stacking order above canvas
    - _Requirements: 11.1, 11.2, 11.3_

- [x] 16. Implement the TempoKeyReadout
  - [x] 16.1 Implement tempo/key readout with pending/placeholder states
    - Show tempo rounded to nearest integer when within `[40,250]`, else the "could not be determined" placeholder; show key as `{tonic, mode}` when valid, else placeholder while retaining the tempo; show a pending indicator while estimates are pending
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 16.2 Write property test for tempo readout plausibility
    - **Property 15: Tempo readout reflects plausibility**
    - **Validates: Requirements 8.1, 8.2**

  - [x] 16.3 Write property test for key readout formatting
    - **Property 16: Key readout formats valid keys and placeholders otherwise**
    - **Validates: Requirements 8.3, 8.4**

  - [x] 16.4 Write unit/example tests for readout states
    - Key-absent placeholder with retained tempo; pending indicators
    - _Requirements: 8.4, 8.5_

- [x] 17. Wire the full flow and status banners
  - [x] 17.1 Wire upload → separation → analysis → render end to end
    - Connect `UploadPanel` → validation → `Audio_Engine` load → in-browser `Analysis_Engine` pass → `Timeline_Stream` → `Graph_Renderer`; trigger Demucs separation, route stems, run per-stem analysis, and derive chords; surface analysis/separation/connectivity states through the `StatusBanner`
    - _Requirements: 3.4, 4.8, 4.9, 4.10, 5.1, 12.4, 12.5, 12.6_

- [x] 18. Deployment smoke tests
  - [x] 18.1 Write deployment smoke tests
    - Frontend builds and deploys independently of the Demucs_Service; Demucs_Service Docker image builds and `GET /health` responds standalone; Frontend honors the configured `demucsEndpoint`
    - _Requirements: 4.7, 12.1, 12.2, 12.3_

- [x] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (unit, property, integration, and smoke tests) and can be skipped for a faster MVP.
- Each task references specific requirement sub-clauses for traceability.
- Checkpoints ensure incremental validation between the five groups.
- All 17 correctness properties from the design are implemented as fast-check property tests (≥100 iterations each), tagged `// Feature: harmograph, Property N: ...`.
- Property tests verify universal invariants on the pure-logic layer; unit/example tests verify concrete scenarios; integration tests cover browser, third-party, service, and DOM behavior; smoke tests verify configuration and deployment.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.5", "4.2"] },
    { "id": 2, "tasks": ["1.4", "1.6", "2.1", "4.3"] },
    { "id": 3, "tasks": ["6.1", "7.1", "9.1"] },
    { "id": 4, "tasks": ["6.2", "6.3", "7.2", "7.3", "7.4", "7.5", "9.2"] },
    { "id": 5, "tasks": ["6.4", "6.5", "8.1", "10.1"] },
    { "id": 6, "tasks": ["6.6", "8.2", "8.3", "10.2", "10.3", "10.4", "12.1"] },
    { "id": 7, "tasks": ["12.2", "13.1", "13.2"] },
    { "id": 8, "tasks": ["13.3", "13.4", "15.1"] },
    { "id": 9, "tasks": ["15.2", "16.1"] },
    { "id": 10, "tasks": ["15.3", "15.4", "15.5", "15.6", "15.7", "16.2", "16.3", "16.4"] },
    { "id": 11, "tasks": ["17.1"] },
    { "id": 12, "tasks": ["18.1"] }
  ]
}
```
