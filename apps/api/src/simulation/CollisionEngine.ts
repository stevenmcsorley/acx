import type { SimDroneState, CollisionResponse } from "./types";
import { haversineMeters } from "./geo";

export class CollisionEngine {
  // Hard collision threshold — flag is set, strong evasion applied.
  private readonly hardThreshold: number;
  // Soft threshold — early avoidance kicks in proportionally.
  private readonly softThreshold: number;
  // Reduced thresholds for drones in the same swarm group.
  private readonly swarmHardThreshold = 3;
  private readonly swarmSoftThreshold = 6;

  constructor(hardThresholdMeters = 8, softThresholdMeters = 20) {
    this.hardThreshold = hardThresholdMeters;
    this.softThreshold = softThresholdMeters;
  }

  /**
   * @param swarmMembers Map of droneId -> groupId. Drones sharing a groupId
   *   use reduced collision thresholds so avoidance vectors don't fight
   *   formation waypoints.
   */
  detect(drones: SimDroneState[], swarmMembers?: Map<string, string>): CollisionResponse {
    const activeDrones = drones.filter((drone) =>
      ["taking_off", "airborne", "rtl", "landing", "emergency"].includes(drone.flightState)
    );

    const cellSize = this.softThreshold * 2;
    const grid = new Map<string, string[]>();

    const cellFor = (drone: SimDroneState): string => {
      const x = Math.floor((drone.lon * 111320 * Math.cos((drone.lat * Math.PI) / 180)) / cellSize);
      const y = Math.floor((drone.lat * 111320) / cellSize);
      const z = Math.floor(drone.alt / cellSize);
      return `${x}:${y}:${z}`;
    };

    for (const drone of activeDrones) {
      const cell = cellFor(drone);
      const bucket = grid.get(cell);
      if (bucket) {
        bucket.push(drone.id);
      } else {
        grid.set(cell, [drone.id]);
      }
    }

    const droneById = new Map(activeDrones.map((d) => [d.id, d]));
    const collisions = new Set<string>();
    // Accumulate avoidance vectors — a drone may be near multiple others.
    const avoidanceAccum = new Map<string, { north: number; east: number; up: number }>();

    const addAvoidance = (id: string, north: number, east: number, up: number): void => {
      const existing = avoidanceAccum.get(id);
      if (existing) {
        existing.north += north;
        existing.east += east;
        existing.up += up;
      } else {
        avoidanceAccum.set(id, { north, east, up });
      }
    };

    for (const [cellKey, ids] of grid.entries()) {
      const [x, y, z] = cellKey.split(":").map(Number);
      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dz = -1; dz <= 1; dz += 1) {
            const neighbor = `${x + dx}:${y + dy}:${z + dz}`;
            const otherIds = grid.get(neighbor);
            if (!otherIds) {
              continue;
            }

            for (const idA of ids) {
              for (const idB of otherIds) {
                if (idA >= idB) {
                  continue;
                }

                const a = droneById.get(idA);
                const b = droneById.get(idB);
                if (!a || !b) {
                  continue;
                }

                const horizontalDistance = haversineMeters(a.lat, a.lon, b.lat, b.lon);
                const verticalDistance = Math.abs(a.alt - b.alt);
                const dist3d = Math.sqrt(horizontalDistance * horizontalDistance + verticalDistance * verticalDistance);

                // Use reduced thresholds for drones in the same swarm group
                // to prevent avoidance vectors from fighting formation waypoints.
                const sameSwarm =
                  swarmMembers !== undefined &&
                  swarmMembers.has(a.id) &&
                  swarmMembers.get(a.id) === swarmMembers.get(b.id);
                const effectiveHard = sameSwarm ? this.swarmHardThreshold : this.hardThreshold;
                const effectiveSoft = sameSwarm ? this.swarmSoftThreshold : this.softThreshold;

                if (dist3d >= effectiveSoft) {
                  continue;
                }

                // Mark hard collision when within hard threshold.
                if (dist3d < effectiveHard) {
                  collisions.add(a.id);
                  collisions.add(b.id);
                }

                // Distance-proportional avoidance force: stronger when closer.
                // Force scales from 0 at softThreshold to max at 0 distance.
                const proximity = 1 - dist3d / effectiveSoft; // 0..1
                const forceMagnitude = proximity * proximity * 12; // quadratic ramp, max 12 m/s^2

                const latDiff = a.lat - b.lat;
                const lonDiff = a.lon - b.lon;
                const horizontalNorm = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff) || 1e-9;
                const northDir = latDiff / horizontalNorm;
                const eastDir = lonDiff / horizontalNorm;

                // Vertical separation: push drones apart vertically too.
                const altDiff = a.alt - b.alt;
                const verticalForce = verticalDistance < 4 ? (altDiff >= 0 ? 2 : -2) * proximity : 0;

                addAvoidance(a.id, northDir * forceMagnitude, eastDir * forceMagnitude, verticalForce);
                addAvoidance(b.id, -northDir * forceMagnitude, -eastDir * forceMagnitude, -verticalForce);
              }
            }
          }
        }
      }
    }

    // Convert accumulated vectors to the output format.
    const avoidanceVectors = new Map<string, { north: number; east: number }>();
    for (const [id, vec] of avoidanceAccum) {
      avoidanceVectors.set(id, { north: vec.north, east: vec.east });
      // Apply vertical avoidance directly to drone velocity.
      const drone = droneById.get(id);
      if (drone) {
        drone.vUp += vec.up * 0.3;
      }
    }

    return { collisions, avoidanceVectors };
  }
}
