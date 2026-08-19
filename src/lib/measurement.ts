export type NetworkMeasurement = { download: number; upload: number; ping: number; jitter: number }

const speedUrl = 'https://speed.cloudflare.com'

export function median(values: number[]) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

async function timedDownload(bytes: number) {
  const started = performance.now()
  const response = await fetch(`${speedUrl}/__down?bytes=${bytes}&t=${Date.now()}-${Math.random()}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Download test failed')
  const payload = await response.arrayBuffer()
  return (payload.byteLength * 8) / ((performance.now() - started) / 1000) / 1_000_000
}

function randomPayload(bytes: number) {
  const payload = new Uint8Array(bytes)
  for (let offset = 0; offset < bytes; offset += 65_536) {
    crypto.getRandomValues(payload.subarray(offset, Math.min(offset + 65_536, bytes)))
  }
  return payload
}

async function timedUpload(bytes: number) {
  const payload = randomPayload(bytes)
  const started = performance.now()
  const response = await fetch(`${speedUrl}/__up?t=${Date.now()}-${Math.random()}`, { method: 'POST', body: payload, cache: 'no-store' })
  if (!response.ok) throw new Error('Upload test failed')
  return (payload.byteLength * 8) / ((performance.now() - started) / 1000) / 1_000_000
}

export async function measureLatency() {
  const samples: number[] = []
  for (let i = 0; i < 7; i += 1) {
    const started = performance.now()
    const response = await fetch(`${speedUrl}/__down?bytes=1&t=${Date.now()}-${i}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Latency test failed')
    await response.arrayBuffer()
    samples.push(performance.now() - started)
  }
  const usable = samples.slice(1)
  const ping = median(usable)
  return { ping: Math.round(ping), jitter: Math.round(median(usable.map((sample) => Math.abs(sample - ping)))) }
}

export async function measureConnection(onProgress: (progress: number, liveSpeed?: number) => void): Promise<NetworkMeasurement> {
  const { ping, jitter } = await measureLatency()
  onProgress(12)
  const downloads: number[] = []
  for (const [index, bytes] of [1_000_000, 5_000_000, 10_000_000, 20_000_000].entries()) {
    const sample = await timedDownload(bytes)
    if (index > 0) downloads.push(sample)
    onProgress(12 + (index + 1) * 13, median(downloads.length ? downloads : [sample]))
  }
  const uploads: number[] = []
  for (const [index, bytes] of [500_000, 2_000_000, 5_000_000].entries()) {
    const sample = await timedUpload(bytes)
    if (index > 0) uploads.push(sample)
    onProgress(65 + (index + 1) * 11)
  }
  return { download: Number(median(downloads).toFixed(1)), upload: Number(median(uploads).toFixed(1)), ping, jitter }
}
