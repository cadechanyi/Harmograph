"use client";

/**
 * CanvasStage — positions the canvas and the UI_Overlay in a shared stacking
 * context, with the overlay above the canvas (Req 11.1).
 *
 * The stage container establishes a stacking context (`relative isolate`); the
 * canvas layer sits at `z-0` and the overlay layer at `z-10`, so overlay
 * controls always render above whatever the Graph_Renderer draws (Req 11.1).
 */
import type { YUnit } from "@/models";
import type {
  AnalysisStatus,
  PlaybackStore,
  StemConfigStore,
  TimelineIndexStore,
} from "@/stores";
import { P5Canvas } from "./P5Canvas";
import { UIOverlay } from "./UIOverlay";

export interface CanvasStageProps {
  playback: PlaybackStore;
  stemConfig: StemConfigStore;
  timelineIndex: TimelineIndexStore;
  analysisStatus: AnalysisStatus;
  yUnit: YUnit;
  onSelectYUnit: (unit: YUnit) => void;
  statusMessage: string | null;
  statusTone?: "info" | "error";
  onUpload?: (file: File) => void;
  mountRenderer?: (container: HTMLElement) => void;
  unmountRenderer?: () => void;
}

export function CanvasStage({
  mountRenderer,
  unmountRenderer,
  ...overlayProps
}: CanvasStageProps) {
  return (
    <div
      className="relative isolate h-[70vh] w-full overflow-hidden rounded-lg"
      data-testid="canvas-stage"
    >
      <P5Canvas mountRenderer={mountRenderer} unmountRenderer={unmountRenderer} />
      <UIOverlay {...overlayProps} />
    </div>
  );
}
