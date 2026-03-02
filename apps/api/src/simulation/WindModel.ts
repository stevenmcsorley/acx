import type { WindVector } from "@sgcx/shared-types";

export class WindModel {
  sample(nowMs: number, droneId: string): WindVector {
    const t = nowMs / 1000;
    const hash = this.hash(droneId);
    const baseX = Math.sin(t * 0.12 + hash * 0.1) * 1.8;
    const baseY = Math.cos(t * 0.1 + hash * 0.07) * 1.6;
    const gust = Math.sin(t * 0.7 + hash) * 0.6;
    const x = baseX + gust * 0.5;
    const y = baseY + gust * 0.5;
    const z = Math.sin(t * 0.2 + hash * 0.2) * 0.2;
    const speed = Math.sqrt(x * x + y * y + z * z);

    return { x, y, z, speed };
  }

  private hash(input: string): number {
    let value = 0;
    for (let i = 0; i < input.length; i += 1) {
      value = (value * 31 + input.charCodeAt(i)) % 997;
    }
    return value / 997;
  }
}
