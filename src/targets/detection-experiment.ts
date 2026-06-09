import type { RadarSpoke } from "../radar/decoder.js";

export interface TargetDetectionExperimentConfig {
  readonly bearingMergeDegrees: number;
  readonly maxDetectionsPerSpoke: number;
  readonly minimumIntensity: number;
  readonly rangeMergeMeters: number;
}

export interface ExperimentalTargetDetection {
  readonly bearingDegrees: number;
  readonly confidence: number;
  readonly intensity: number;
  readonly rangeMeters: number;
  readonly sampleIndex: number;
}

export interface ExperimentalTargetCluster {
  readonly bearingDegrees: number;
  readonly confidence: number;
  readonly detectionCount: number;
  readonly maxIntensity: number;
  readonly rangeMeters: number;
}

export interface ExperimentalSweepDetectionResult {
  readonly clusters: readonly ExperimentalTargetCluster[];
  readonly detections: readonly ExperimentalTargetDetection[];
  readonly experimental: true;
}

export const DEFAULT_TARGET_DETECTION_EXPERIMENT_CONFIG = {
  bearingMergeDegrees: 3,
  maxDetectionsPerSpoke: 32,
  minimumIntensity: 160,
  rangeMergeMeters: 35
} satisfies TargetDetectionExperimentConfig;

export const detectExperimentalTargets = (
  spokes: readonly RadarSpoke[],
  config: TargetDetectionExperimentConfig = DEFAULT_TARGET_DETECTION_EXPERIMENT_CONFIG
): ExperimentalSweepDetectionResult => {
  const detections = spokes.flatMap((spoke) => detectSpokeReturns(spoke, config));
  return {
    clusters: clusterDetections(detections, config),
    detections,
    experimental: true
  };
};

export const detectSpokeReturns = (
  spoke: RadarSpoke,
  config: TargetDetectionExperimentConfig = DEFAULT_TARGET_DETECTION_EXPERIMENT_CONFIG
): readonly ExperimentalTargetDetection[] => {
  const detections: ExperimentalTargetDetection[] = [];
  for (const [sampleIndex, intensity] of spoke.intensities.entries()) {
    if (intensity < config.minimumIntensity) {
      continue;
    }

    detections.push({
      bearingDegrees: spoke.angleDegrees,
      confidence: intensity / 255,
      intensity,
      rangeMeters: sampleIndexToRangeMeters(sampleIndex, spoke.sampleCount, spoke.rangeMeters),
      sampleIndex
    });
  }

  return detections
    .sort((left, right) => right.intensity - left.intensity)
    .slice(0, config.maxDetectionsPerSpoke)
    .sort((left, right) => left.sampleIndex - right.sampleIndex);
};

export const clusterDetections = (
  detections: readonly ExperimentalTargetDetection[],
  config: Pick<TargetDetectionExperimentConfig, "bearingMergeDegrees" | "rangeMergeMeters"> = DEFAULT_TARGET_DETECTION_EXPERIMENT_CONFIG
): readonly ExperimentalTargetCluster[] => {
  const clusters: ExperimentalTargetDetection[][] = [];
  for (const detection of detections) {
    const cluster = clusters.find((candidate) => belongsToCluster(detection, candidate, config));
    if (cluster) {
      cluster.push(detection);
    } else {
      clusters.push([detection]);
    }
  }

  return clusters.map(summarizeCluster).sort((left, right) => right.confidence - left.confidence);
};

const belongsToCluster = (
  detection: ExperimentalTargetDetection,
  cluster: readonly ExperimentalTargetDetection[],
  config: Pick<TargetDetectionExperimentConfig, "bearingMergeDegrees" | "rangeMergeMeters">
): boolean => {
  const summary = summarizeCluster(cluster);
  return (
    Math.abs(summary.rangeMeters - detection.rangeMeters) <= config.rangeMergeMeters &&
    bearingDeltaDegrees(summary.bearingDegrees, detection.bearingDegrees) <= config.bearingMergeDegrees
  );
};

const summarizeCluster = (cluster: readonly ExperimentalTargetDetection[]): ExperimentalTargetCluster => {
  const totalWeight = cluster.reduce((sum, detection) => sum + detection.intensity, 0);
  const weightedRange = cluster.reduce((sum, detection) => sum + detection.rangeMeters * detection.intensity, 0);
  const weightedBearing = cluster.reduce((sum, detection) => sum + detection.bearingDegrees * detection.intensity, 0);
  const maxIntensity = Math.max(...cluster.map((detection) => detection.intensity));
  return {
    bearingDegrees: weightedBearing / totalWeight,
    confidence: maxIntensity / 255,
    detectionCount: cluster.length,
    maxIntensity,
    rangeMeters: weightedRange / totalWeight
  };
};

const sampleIndexToRangeMeters = (sampleIndex: number, sampleCount: number, rangeMeters: number): number => {
  if (sampleCount <= 1) {
    return 0;
  }

  return (sampleIndex / (sampleCount - 1)) * rangeMeters;
};

const bearingDeltaDegrees = (left: number, right: number): number => {
  const delta = Math.abs(left - right) % 360;
  return delta > 180 ? 360 - delta : delta;
};
