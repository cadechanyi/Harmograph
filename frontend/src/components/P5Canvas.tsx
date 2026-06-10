"use client";

/**
 * P5Canvas — thin React wrapper that mounts the (non-React) Graph_Renderer p5
 * instance imperatively into its container.
 *
 * The Graph_Renderer is owned by the HarmographController; this wrapper only
 * provides the DOM container and drives mount/unmount via the injected
 * callbacks. Keeping the renderer outside React avoids re-render overhead on the
 * high-frequency animation loop (design "Component Tree").
 */
import { useEffect, useRef } from "react";

export interface P5CanvasProps {
  /** Mount the Graph_Renderer into the given container element. */
  mountRenderer?: (container: HTMLElement) => void;
  /** Tear down the Graph_Renderer. */
  unmountRenderer?: () => void;
}

export function P5Canvas({ mountRenderer, unmountRenderer }: P5CanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !mountRenderer) return undefined;
    mountRenderer(container);
    return () => unmountRenderer?.();
    // Mount once on attach; the controller (and thus the callbacks) is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 bg-neutral-900"
      data-testid="p5-canvas"
      aria-hidden="true"
    />
  );
}
