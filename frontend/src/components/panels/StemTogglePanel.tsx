"use client";

/**
 * StemTogglePanel — presents exactly one StemToggle for each of the five
 * Stem_Type values, regardless of separation/analysis state (Req 6.3).
 */
import { STEM_TYPES, type StemConfigMap, type StemType } from "@/models";
import { StemToggle } from "./StemToggle";

export interface StemTogglePanelProps {
  config: StemConfigMap;
  onToggle: (stem: StemType) => void;
}

export function StemTogglePanel({ config, onToggle }: StemTogglePanelProps) {
  return (
    <section
      className="pointer-events-auto rounded-md bg-black/40 p-3 text-sm text-white"
      aria-label="Stem toggles"
    >
      <h2 className="mb-2 font-medium">Stems</h2>
      <div className="flex flex-col gap-1">
        {STEM_TYPES.map((stem) => (
          <StemToggle
            key={stem}
            stem={stem}
            enabled={config[stem].enabled}
            onToggle={onToggle}
          />
        ))}
      </div>
    </section>
  );
}
