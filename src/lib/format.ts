/**
 * Compact display counts: below 1000 exact; above, k/m with at most one
 * decimal — 1000 → "1k", 1500 → "1.5k", 12300 → "12.3k", 123456 → "123k".
 */

// >= 100 in a unit: a decimal adds noise, not information
const scale = (v: number) => (v >= 100 ? Math.round(v) : Math.round(v * 10) / 10)

export function compactCount(n: number): string {
  if (n < 1000) return String(n)
  // check the ROUNDED value so 999,950+ promotes to "1m", never "1000k"
  if (n < 1_000_000 && scale(n / 1000) < 1000) return `${scale(n / 1000)}k`
  return `${scale(n / 1_000_000)}m`
}
