/** Search-only key. Always retain the original model for display and routes. */
export function normalizeModel(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\s\-‐‑‒–—―−﹘﹣－]/gu, '');
}
