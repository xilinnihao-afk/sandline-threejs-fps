/** Optical zoom uses perspective magnification, independent of screen aspect. */
export const SNIPER_MAGNIFICATION = 3;
export function sniperScopeFov(baseFovDegrees: number): number {
  return 2 * Math.atan(Math.tan(baseFovDegrees * Math.PI / 360) / SNIPER_MAGNIFICATION) * 180 / Math.PI;
}
