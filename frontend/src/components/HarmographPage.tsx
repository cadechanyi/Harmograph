"use client";

/**
 * HarmographPage — the client component that owns the app's state and wires the
 * non-React engines (Audio_Engine, Analysis_Engine, Timeline_Stream,
 * Coordinate_System, Graph_Renderer, Demucs client) to the component tree via
 * the {@link useHarmographController} hook.
 *
 * The hook constructs the HarmographController once and mirrors engine state
 * into the React stores; this component threads the resulting view objects and
 * handlers down through CanvasStage → UIOverlay / P5Canvas so the app runs the
 * full upload → analyze → separate → render flow (task 17.1).
 */
import { useHarmographController } from "@/controllers";
import { CanvasStage } from "./CanvasStage";

export function HarmographPage() {
  const {
    playback,
    stemConfig,
    timelineIndex,
    analysisStatus,
    yUnit,
    setYUnit,
    statusMessage,
    statusTone,
    onUpload,
    mountRenderer,
    unmountRenderer,
  } = useHarmographController();

  return (
    <main className="min-h-screen w-full p-4">
      <header className="mb-4">
        <h1 className="text-2xl font-semibold">Harmograph</h1>
        <p className="text-sm opacity-70">
          Visualize the musical components of a song as live, interactive
          graphs.
        </p>
      </header>
      <CanvasStage
        playback={playback}
        stemConfig={stemConfig}
        timelineIndex={timelineIndex}
        analysisStatus={analysisStatus}
        yUnit={yUnit}
        onSelectYUnit={setYUnit}
        statusMessage={statusMessage}
        statusTone={statusTone}
        onUpload={onUpload}
        mountRenderer={mountRenderer}
        unmountRenderer={unmountRenderer}
      />
    </main>
  );
}
