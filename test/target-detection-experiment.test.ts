import { describe, expect, it } from "vitest";

import type { RadarSpoke } from "../src/radar/decoder.js";
import { clusterDetections, detectExperimentalTargets, detectSpokeReturns } from "../src/targets/detection-experiment.js";

const spoke = (angleDegrees: number, intensities: readonly number[]): RadarSpoke => ({
  angleDegrees,
  intensities: Uint8Array.from(intensities),
  maxIntensity: Math.max(...intensities),
  rangeMeters: 1000,
  sampleCount: intensities.length,
  type: "spoke"
});

describe("target detection experiment scaffold", () => {
  it("thresholds bright spoke samples into experimental detections", () => {
    expect(detectSpokeReturns(spoke(90, [0, 80, 180, 220]), { bearingMergeDegrees: 3, maxDetectionsPerSpoke: 1, minimumIntensity: 160, rangeMergeMeters: 35 })).toEqual([
      {
        bearingDegrees: 90,
        confidence: 220 / 255,
        intensity: 220,
        rangeMeters: 1000,
        sampleIndex: 3
      }
    ]);
  });

  it("clusters nearby detections across adjacent spokes", () => {
    const result = detectExperimentalTargets([
      spoke(90, [0, 0, 220, 0]),
      spoke(91, [0, 0, 210, 0]),
      spoke(140, [0, 0, 230, 0])
    ]);

    expect(result.experimental).toBe(true);
    expect(result.detections).toHaveLength(3);
    expect(result.clusters).toHaveLength(2);
    expect(result.clusters[0]).toMatchObject({
      detectionCount: 1,
      maxIntensity: 230
    });
    expect(result.clusters[1]).toMatchObject({
      detectionCount: 2,
      maxIntensity: 220
    });
  });

  it("handles bearing wraparound while clustering", () => {
    const clusters = clusterDetections([
      { bearingDegrees: 359, confidence: 0.8, intensity: 220, rangeMeters: 100, sampleIndex: 1 },
      { bearingDegrees: 1, confidence: 0.7, intensity: 200, rangeMeters: 105, sampleIndex: 1 }
    ]);

    expect(clusters).toHaveLength(1);
  });
});
