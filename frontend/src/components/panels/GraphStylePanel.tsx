"use client";

/**
 * GraphStylePanel — a Graph_Style picker per Stem_Type (Req 7.1).
 */
import {
  STEM_TYPES,
  type GraphStyle,
  type StemConfigMap,
  type StemType,
} from "@/models";
import { GraphStylePicker } from "./GraphStylePicker";

export interface GraphStylePanelProps {
  config: StemConfigMap;
  /** Whether a stem has Timeline_Points available — drives style availability (Req 7.4). */
  hasPoints: (stem: StemType) => boolean;
  onSelect: (stem: StemType, style: GraphStyle) => void;
}

export function GraphStylePanel({
  config,
  hasPoints,
  onSelect,
}: GraphStylePanelProps) {
  return (
    <section
      className="pointer-events-auto rounded-md bg-black/40 p-3 text-sm text-white"
      aria-label="Graph styles"
    >
      <h2 className="mb-2 font-medium">Graph styles</h2>
      <div className="flex flex-col gap-1">
        {STEM_TYPES.map((stem) => (
          <GraphStylePicker
            key={stem}
            stem={stem}
            style={config[stem].style}
            hasData={hasPoints(stem)}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}
