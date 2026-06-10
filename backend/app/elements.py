"""Element detection — break each separated stem into its basic building blocks.

Demucs gives us coarse stem groups (drums, bass, vocals, other/…). This module
inspects each stem and derives the finer *elements* a song actually contains,
as time-stamped event tracks rather than isolated audio:

* Drums -> percussive elements via band-limited onset detection:
    - kick   (low band, ~20-150 Hz)
    - snare  (mid band, ~150-2500 Hz)
    - hihat  (high band, ~6-16 kHz)
* Tonal stems (bass, vocals, other, guitar, piano) -> one element each carrying
  note-onset events plus a coarse loudness envelope.

Every candidate element is *presence-gated*: an element is only reported when it
actually occurs (enough onsets and meaningful energy). A song with no snare
yields no snare element. Heavy imports (numpy/librosa) are lazy so importing
this module never requires them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

# Analysis sample rate — downsampled for speed; plenty for onset/band work.
ANALYSIS_SR = 22050
N_FFT = 1024
HOP = 256

# Percussive sub-bands (Hz) used to split the drums stem into elements.
DRUM_BANDS: dict[str, tuple[float, float]] = {
    "kick": (20.0, 150.0),
    "snare": (150.0, 2500.0),
    "hihat": (6000.0, 16000.0),
}

# Display labels and the visual family each element belongs to.
ELEMENT_LABELS: dict[str, str] = {
    "kick": "Kick",
    "snare": "Snare / Clap",
    "hihat": "Hi-hat / Tick",
    "bass": "Bass",
    "vocals": "Vocals",
    "other": "Melody / Other",
    "guitar": "Guitar",
    "piano": "Piano",
    "drums": "Drums",
}

# Minimum onsets for a percussive element to count as "present".
MIN_ONSETS = 4
# Minimum mean RMS for a tonal stem to count as "present" (skip near-silent).
TONAL_RMS_FLOOR = 1e-3
# Cap on events returned per element to keep responses small.
MAX_EVENTS = 4000


@dataclass
class Element:
    """A detected musical element and its event track."""

    id: str
    label: str
    parent: str
    kind: str  # "percussive" | "tonal"
    events: list[dict[str, float]] = field(default_factory=list)
    envelope: list[dict[str, float]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "label": self.label,
            "parent": self.parent,
            "kind": self.kind,
            "event_count": len(self.events),
            "events": self.events,
            "envelope": self.envelope,
        }


def analyze_stems(stem_paths: dict[str, str]) -> list[dict[str, Any]]:
    """Detect present elements across all stems; returns a list of element dicts.

    Lazily imports numpy/librosa; if unavailable, returns an empty list so the
    separation result is still usable.
    """
    try:  # pragma: no cover - exercised only with the analysis stack installed.
        import librosa  # type: ignore  # noqa: F401
        import numpy as np  # type: ignore  # noqa: F401
    except ImportError:  # pragma: no cover - depends on environment.
        return []

    elements: list[Element] = []
    for stem_name, path in stem_paths.items():  # pragma: no cover
        if stem_name == "drums":
            elements.extend(_detect_drum_elements(path))
        else:
            tonal = _detect_tonal_element(stem_name, path)
            if tonal is not None:
                elements.append(tonal)
    return [e.to_dict() for e in elements]


def _load_mono(path: str):  # pragma: no cover - needs the analysis stack.
    import librosa  # type: ignore

    y, _sr = librosa.load(path, sr=ANALYSIS_SR, mono=True)
    return y


def _peak_times(env, sr: int, hop: int, min_gap_s: float = 0.05):  # pragma: no cover
    """Peak-pick an onset envelope, returning (times, strengths)."""
    import librosa  # type: ignore
    import numpy as np  # type: ignore

    if env.size == 0 or float(np.max(env)) <= 0:
        return np.array([]), np.array([])
    env = env / (np.max(env) + 1e-9)
    wait = max(1, int(round(min_gap_s * sr / hop)))
    peaks = librosa.util.peak_pick(
        env, pre_max=3, post_max=3, pre_avg=5, post_avg=5, delta=0.12, wait=wait
    )
    times = librosa.frames_to_time(peaks, sr=sr, hop_length=hop)
    return times, env[peaks]


def _detect_drum_elements(path: str) -> list[Element]:  # pragma: no cover
    """Split the drums stem into kick/snare/hihat via band-limited onsets."""
    import librosa  # type: ignore
    import numpy as np  # type: ignore

    y = _load_mono(path)
    S = np.abs(librosa.stft(y, n_fft=N_FFT, hop_length=HOP))
    freqs = librosa.fft_frequencies(sr=ANALYSIS_SR, n_fft=N_FFT)
    total_energy = float(S.sum()) + 1e-9

    found: list[Element] = []
    for elem_id, (lo, hi) in DRUM_BANDS.items():
        mask = (freqs >= lo) & (freqs < hi)
        if not mask.any():
            continue
        band = S[mask, :].sum(axis=0)
        # Half-wave-rectified flux is the onset envelope for this band.
        flux = np.maximum(0.0, np.diff(band, prepend=band[:1]))
        times, strengths = _peak_times(flux, ANALYSIS_SR, HOP)
        band_fraction = float(S[mask, :].sum()) / total_energy

        # Presence gating: enough onsets and a non-trivial share of energy.
        if len(times) < MIN_ONSETS or band_fraction < 0.005:
            continue

        events = [
            {"t": round(float(t), 4), "strength": round(float(s), 4)}
            for t, s in zip(times[:MAX_EVENTS], strengths[:MAX_EVENTS])
        ]
        found.append(
            Element(
                id=elem_id,
                label=ELEMENT_LABELS.get(elem_id, elem_id),
                parent="drums",
                kind="percussive",
                events=events,
            )
        )
    return found


def _detect_tonal_element(stem_name: str, path: str) -> Element | None:  # pragma: no cover
    """Detect a tonal stem's note onsets + loudness envelope, presence-gated."""
    import librosa  # type: ignore
    import numpy as np  # type: ignore

    y = _load_mono(path)
    rms = librosa.feature.rms(y=y, frame_length=N_FFT, hop_length=HOP)[0]
    if rms.size == 0 or float(np.mean(rms)) < TONAL_RMS_FLOOR:
        return None  # near-silent stem: not present (e.g. no separate bass)

    onset_env = librosa.onset.onset_strength(y=y, sr=ANALYSIS_SR, hop_length=HOP)
    times, strengths = _peak_times(onset_env, ANALYSIS_SR, HOP, min_gap_s=0.07)
    events = [
        {"t": round(float(t), 4), "strength": round(float(s), 4)}
        for t, s in zip(times[:MAX_EVENTS], strengths[:MAX_EVENTS])
    ]

    # Coarse loudness envelope (downsampled to ~20 Hz) for tonal visuals.
    env_times = librosa.frames_to_time(np.arange(rms.size), sr=ANALYSIS_SR, hop_length=HOP)
    norm = rms / (float(np.max(rms)) + 1e-9)
    step = max(1, rms.size // (int(env_times[-1]) + 1) // 20) if env_times.size else 1
    envelope = [
        {"t": round(float(env_times[i]), 3), "v": round(float(norm[i]), 4)}
        for i in range(0, rms.size, step)
    ]

    return Element(
        id=stem_name,
        label=ELEMENT_LABELS.get(stem_name, stem_name.title()),
        parent=stem_name,
        kind="tonal",
        events=events,
        envelope=envelope,
    )
