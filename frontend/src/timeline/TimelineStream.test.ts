import { describe, it, expect, vi } from "vitest";
import { TimelineStream } from "./TimelineStream";
import type { TimelinePoint } from "../models/types";

describe("TimelineStream.emit validation (Req 10.1, 10.2, 10.4)", () => {
  it("accepts a well-formed point within range", () => {
    const stream = new TimelineStream({ songDuration: 10 });
    stream.emit({ t: 5, value: 0.5, stem: "drums" });
    expect(stream.getPoints("drums")).toEqual([
      { t: 5, value: 0.5, stem: "drums" },
    ]);
  });

  it("accepts boundary values for t and value (inclusive ranges)", () => {
    const stream = new TimelineStream({ songDuration: 10 });
    stream.emit({ t: 0, value: -1, stem: "bass" });
    stream.emit({ t: 10, value: 1, stem: "bass" });
    expect(stream.getPoints("bass")).toEqual([
      { t: 0, value: -1, stem: "bass" },
      { t: 10, value: 1, stem: "bass" },
    ]);
  });

  it("excludes candidates with missing or non-numeric fields", () => {
    const stream = new TimelineStream({ songDuration: 10 });
    stream.emit({ value: 0.1, stem: "drums" }); // missing t
    stream.emit({ t: 1, stem: "drums" }); // missing value
    stream.emit({ t: 1, value: 0.1 }); // missing stem
    stream.emit({ t: "1", value: 0.1, stem: "drums" }); // non-numeric t
    stream.emit({ t: NaN, value: 0.1, stem: "drums" }); // NaN t
    stream.emit(null);
    stream.emit(42);
    expect(stream.getPoints("drums")).toEqual([]);
  });

  it("excludes candidates with an unknown stem", () => {
    const stream = new TimelineStream({ songDuration: 10 });
    stream.emit({ t: 1, value: 0, stem: "guitar" });
    expect(stream.getPoints("drums")).toEqual([]);
  });

  it("excludes candidates whose t or value falls outside range", () => {
    const stream = new TimelineStream({ songDuration: 10 });
    stream.emit({ t: -0.1, value: 0, stem: "vocals" });
    stream.emit({ t: 10.1, value: 0, stem: "vocals" });
    stream.emit({ t: 1, value: -1.1, stem: "vocals" });
    stream.emit({ t: 1, value: 1.1, stem: "vocals" });
    expect(stream.getPoints("vocals")).toEqual([]);
  });

  it("retains previously accepted points when a later candidate is invalid (Req 10.4)", () => {
    const stream = new TimelineStream({ songDuration: 10 });
    stream.emit({ t: 1, value: 0.2, stem: "melody" });
    stream.emit({ t: 99, value: 0.2, stem: "melody" }); // invalid: out of range
    expect(stream.getPoints("melody")).toEqual([
      { t: 1, value: 0.2, stem: "melody" },
    ]);
  });
});

describe("TimelineStream routing and ordering (Req 10.3, 10.5)", () => {
  it("keeps each stem's points sorted non-decreasing by t regardless of emit order", () => {
    const stream = new TimelineStream({ songDuration: 100 });
    stream.emit({ t: 5, value: 0, stem: "chords" });
    stream.emit({ t: 1, value: 0, stem: "chords" });
    stream.emit({ t: 3, value: 0, stem: "chords" });
    expect(stream.getPoints("chords").map((p) => p.t)).toEqual([1, 3, 5]);
  });

  it("subscribe replays only the subscribed stem's points in sorted order (Req 10.3)", () => {
    const stream = new TimelineStream({ songDuration: 100 });
    stream.emit({ t: 4, value: 0, stem: "drums" });
    stream.emit({ t: 2, value: 0, stem: "drums" });
    stream.emit({ t: 1, value: 0, stem: "bass" });

    const received: TimelinePoint[] = [];
    stream.subscribe("drums", (p) => received.push(p));

    expect(received.map((p) => p.t)).toEqual([2, 4]);
    expect(received.every((p) => p.stem === "drums")).toBe(true);
  });

  it("delivers subsequently accepted points to live subscribers of that stem only", () => {
    const stream = new TimelineStream({ songDuration: 100 });
    const drumsCb = vi.fn();
    const bassCb = vi.fn();
    stream.subscribe("drums", drumsCb);
    stream.subscribe("bass", bassCb);

    stream.emit({ t: 1, value: 0, stem: "drums" });

    expect(drumsCb).toHaveBeenCalledTimes(1);
    expect(drumsCb).toHaveBeenCalledWith({ t: 1, value: 0, stem: "drums" });
    expect(bassCb).not.toHaveBeenCalled();
  });

  it("stops delivering after unsubscribe", () => {
    const stream = new TimelineStream({ songDuration: 100 });
    const cb = vi.fn();
    const unsubscribe = stream.subscribe("vocals", cb);
    unsubscribe();
    stream.emit({ t: 1, value: 0, stem: "vocals" });
    expect(cb).not.toHaveBeenCalled();
  });
});

describe("TimelineStream.setSongDuration", () => {
  it("uses an unbounded default duration so non-negative t is accepted", () => {
    const stream = new TimelineStream();
    stream.emit({ t: 1_000_000, value: 0, stem: "drums" });
    expect(stream.getPoints("drums")).toHaveLength(1);
  });

  it("affects only subsequent emits and retains prior points", () => {
    const stream = new TimelineStream({ songDuration: 100 });
    stream.emit({ t: 50, value: 0, stem: "drums" });
    stream.setSongDuration(10);
    stream.emit({ t: 50, value: 0, stem: "drums" }); // now out of range
    expect(stream.getPoints("drums").map((p) => p.t)).toEqual([50]);
  });
});
