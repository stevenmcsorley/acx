import { useCallback, useRef, useState } from "react";
import type { DroneTelemetry, MissionWaypoint } from "../types/domain";

interface FlightRecorderResult {
  recording: boolean;
  recordedPoints: number;
  toggleRecording: () => void;
  tick: (telemetry: DroneTelemetry) => void;
  saveAsWaypoints: () => MissionWaypoint[];
  clear: () => void;
}

export function useFlightRecorder(): FlightRecorderResult {
  const [recording, setRecording] = useState(false);
  const pointsRef = useRef<Array<{ lat: number; lon: number; alt: number; timestamp: number }>>([]);
  const [pointCount, setPointCount] = useState(0);
  const lastRecordRef = useRef(0);

  const toggleRecording = useCallback(() => {
    if (recording) {
      setRecording(false);
    } else {
      pointsRef.current = [];
      setPointCount(0);
      setRecording(true);
    }
  }, [recording]);

  const tick = useCallback(
    (telemetry: DroneTelemetry) => {
      if (!recording) return;

      const now = Date.now();
      if (now - lastRecordRef.current < 500) return;
      lastRecordRef.current = now;

      pointsRef.current.push({
        lat: telemetry.position.lat,
        lon: telemetry.position.lon,
        alt: telemetry.position.alt,
        timestamp: now
      });
      setPointCount(pointsRef.current.length);
    },
    [recording]
  );

  const saveAsWaypoints = useCallback((): MissionWaypoint[] => {
    const points = pointsRef.current;
    if (points.length === 0) return [];

    // Downsample to max 50 waypoints
    const maxWaypoints = 50;
    const step = Math.max(1, Math.floor(points.length / maxWaypoints));

    const waypoints: MissionWaypoint[] = [];
    for (let i = 0; i < points.length; i += step) {
      const p = points[i];
      waypoints.push({
        lat: p.lat,
        lon: p.lon,
        alt: Math.max(10, p.alt),
        hover: 1
      });
    }

    // Always include the last point
    const last = points[points.length - 1];
    const lastWp = waypoints[waypoints.length - 1];
    if (lastWp.lat !== last.lat || lastWp.lon !== last.lon) {
      waypoints.push({
        lat: last.lat,
        lon: last.lon,
        alt: Math.max(10, last.alt),
        hover: 2
      });
    }

    return waypoints;
  }, []);

  const clear = useCallback(() => {
    pointsRef.current = [];
    setPointCount(0);
    setRecording(false);
  }, []);

  return {
    recording,
    recordedPoints: pointCount,
    toggleRecording,
    tick,
    saveAsWaypoints,
    clear
  };
}
