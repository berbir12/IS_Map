export function numericMedian(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function practicalCapacity(downloadMbps: number, uploadMbps: number, pingMs: number) {
  return {
    streams4k: Math.max(0, Math.floor(downloadMbps / 25)),
    calls: Math.max(0, Math.floor(Math.min(downloadMbps / 4, uploadMbps / 3))),
    gaming: pingMs <= 35 ? 'Excellent for online gaming' : pingMs <= 70 ? 'Playable for online gaming' : 'Latency may affect online gaming',
  }
}
