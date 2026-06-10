"use client";

/**
 * UIOverlay — the React layer of interactive controls rendered above the p5.js
 * canvas (Req 11.1).
 *
 * The overlay container uses `pointer-events: none` so empty regions fall
 * through to the canvas, while each interactive control re-enables
 * `pointer-events: auto` (Req 11.2, 11.3). Full pointer-event routing is
 * finalized in task 15; the structure is established here.
 */
import type { GraphStyle, StemType, YUnit } from "@/models";
import type {
  AnalysisStatus,
  PlaybackStore,
  StemConfigStore,
  TimelineIndexStore,
} from "@/stores";
import { UploadPanel } from "./panels/UploadPanel";
import { PlaybackControls } from "./panels/PlaybackControls";
import { StemTogglePanel } from "./panels/StemTogglePanel";
import { GraphStylePanel } from "./panels/GraphStylePanel";
import { CoordinateUnitPicker } from "./panels/CoordinateUnitPicker";
import { TempoKeyReadout } from "./panels/TempoKeyReadout";
import { StatusBanner } from "./panels/StatusBanner";

export interface UIOverlayProps {
  playback: PlaybackStore;
  stemConfig: StemConfigStore;
  timelineIndex: TimelineIndexStore;
  analysisStatus: AnalysisStatus;
  yUnit: YUnit;
  onSelectYUnit: (unit: YUnit) => void;
  statusMessage: string | null;
  statusTone?: "info" | "error";
  onUpload?: (file: File) => void;
}

export function UIOverlay({
  playback,
  stemConfig,
  timelineIndex,
  analysisStatus,
  yUnit,
  onSelectYUnit,
  statusMessage,
  statusTone = "info",
  onUpload,
}: UIOverlayProps) {
  const handleStyleSelect = (stem: StemType, style: GraphStyle) =>
    stemConfig.setStemStyle(stem, style);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex flex-col gap-3 p-4"
      data-testid="ui-overlay"
    >
      <StatusBanner message={statusMessage} tone={statusTone} />
      <UploadPanel onUpload={onUpload} />
      <PlaybackControls playback={playback} />
      <div className="flex flex-wrap gap-3">
        <StemTogglePanel
          config={stemConfig.config}
          onToggle={stemConfig.toggleStem}
        />
        <GraphStylePanel
          config={stemConfig.config}
          hasPoints={timelineIndex.hasPoints}
          onSelect={handleStyleSelect}
        />
        <CoordinateUnitPicker unit={yUnit} onSelect={onSelectYUnit} />
        <TempoKeyReadout status={analysisStatus} />
      </div>
    </div>
  );
}
