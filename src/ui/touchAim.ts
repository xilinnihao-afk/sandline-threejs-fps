/** Event-rate independent gesture slop and displacement-preserving smoothing. */
export class TouchAim {
  private x = 0; private y = 0; private active = false;
  private pendingX = 0; private pendingY = 0;
  begin(): void { this.x = this.y = 0; this.active = false; }
  move(dx: number, dy: number, sensitivity: number): void {
    if (!this.active) {
      this.x += dx; this.y += dy;
      const distance = Math.hypot(this.x, this.y);
      if (distance <= 5) return;
      const remainder = (distance - 5) / distance;
      dx = this.x * remainder; dy = this.y * remainder; this.active = true;
    }
    this.pendingX -= dx * sensitivity; this.pendingY -= dy * sensitivity;
  }
  consume(dt: number): { x: number; y: number } {
    const alpha = 1 - Math.exp(-Math.max(0, Math.min(dt, .1)) / .025);
    const x = this.pendingX * alpha, y = this.pendingY * alpha;
    this.pendingX -= x; this.pendingY -= y;
    return { x, y };
  }
  /** 抬手仅结束手势，保留剩余转角，避免快速短划被吞掉。 */
  end(): void { this.begin(); }
  clear(): void { this.begin(); this.pendingX = this.pendingY = 0; }
}
