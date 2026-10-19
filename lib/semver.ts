// Compare dotted numeric versions (e.g. 0.0.60 vs 0.0.9). Pre-release/build suffixes are ignored —
// only the x.y.z core is compared. Returns -1 / 0 / 1. Browser-safe (no node: imports).
export const compareSemver = (a: string, b: string): number => {
  const core = (v: string) =>
    v
      .split('+')[0]!
      .split('-')[0]!
      .split('.')
      .map((n) => parseInt(n, 10) || 0)
  const pa = core(a)
  const pb = core(b)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d < 0 ? -1 : 1
  }
  return 0
}

export const isAtLeast = (version: string, minVersion: string | undefined): boolean =>
  !minVersion || compareSemver(version, minVersion) >= 0
