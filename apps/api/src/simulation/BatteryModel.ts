import { clamp } from "./geo";

export class BatteryModel {
  // Reduced drain rates for ~90 min flight at cruise, ~60 min at max speed.
  private readonly baseDrainPerSec = 0.006;
  private readonly rechargePerSec = 0.8; // ~2 min to full charge when grounded

  drain(currentBatteryPct: number, speed: number, climbRate: number, dtSeconds: number): number {
    const motionDrain = speed * 0.0008;
    const climbDrain = Math.max(0, climbRate) * 0.0005;
    const delta = (this.baseDrainPerSec + motionDrain + climbDrain) * dtSeconds;
    return clamp(currentBatteryPct - delta, 0, 100);
  }

  recharge(currentBatteryPct: number, dtSeconds: number): number {
    return clamp(currentBatteryPct + this.rechargePerSec * dtSeconds, 0, 100);
  }
}
