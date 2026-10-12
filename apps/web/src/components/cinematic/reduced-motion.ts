/** True when the visitor asked for motion to stop. Call from the browser only. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
