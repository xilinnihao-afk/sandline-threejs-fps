/** Low-latency, displacement-preserving aim. Even subpixel corrections count. */
export class TouchAim {
  private pendingX = 0; private pendingY = 0;
  private released = false;
  begin(): void { this.released = false; }
  move(dx: number, dy: number, sensitivity: number): void {
    this.pendingX -= dx * sensitivity; this.pendingY -= dy * sensitivity;
  }
  consume(dt: number): { x: number; y: number } {
    const alpha = this.released ? 1 : 1 - Math.exp(-Math.max(0, Math.min(dt, .1)) / .012);
    const x = this.pendingX * alpha, y = this.pendingY * alpha;
    this.pendingX -= x; this.pendingY -= y;
    return { x, y };
  }
  /** Deliver the remaining angle once, with no drifting after finger release. */
  end(): void { this.released = true; }
  clear(): void { this.begin(); this.pendingX = this.pendingY = 0; }
}
