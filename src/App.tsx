import { useCallback, useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import {
  Activity, BadgeCheck, ChevronDown, Clock3, Download, Flag, History,
  Image as ImageIcon, Laptop, Layers, LocateFixed, MapPin, Moon, Radio,
  Search, Share2, ShieldCheck, SlidersHorizontal, Smartphone, Sun, Timer,
  Trophy, Upload, Wifi, X, Zap,
} from 'lucide-react'
import { Analytics } from '@vercel/analytics/react'
import {
  isSupabaseConfigured, loadCommunityTests, saveCommunityTest,
  flagCommunityTest, supabase, type CommunityTest,
} from './lib/supabase'
import { useTheme } from './context/ThemeContext'
import { useI18n } from './context/I18nContext'
import { useRecurringTest } from './hooks/useRecurringTest'
import { measureConnection } from './lib/measurement'
import { numericMedian, practicalCapacity, privacySafeCoordinates } from './lib/statistics'
import 'leaflet/dist/leaflet.css'
import './App.css'

/* ═══════════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════════ */

type Stage = 'idle' | 'locating' | 'testing' | 'complete' | 'error'
type TestResult = { download: number; upload: number; ping: number; jitter: number }
type HistoryItem = TestResult & {
  id: string; testedAt: string; location: string; isp: string
  deviceLabel?: string; netType?: string
}
type SpeedFilter = 'all' | 'fast' | 'medium' | 'slow'

type SpeedPoint = {
  id?: string
  name: string
  region: string
  coords: [number, number]
  speed: number
  type: string
  lastTest?: string
  sampleCount?: number
  isVerified?: boolean
  flagCount?: number
  contributorAlias?: string | null
}

/* ═══════════════════════════════════════════════════════════
   Client metadata detection
   ═══════════════════════════════════════════════════════════ */

function detectClientMetadata(measuredDownloadMbps?: number) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  let deviceType = 'Desktop'
  if (/iPad|tablet|PlayBook|Nexus 7|Nexus 10|SM-T/i.test(ua)) {
    deviceType = 'Tablet'
  } else if (/Mobi|Android|iPhone|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    deviceType = 'Mobile'
  }

  let os = 'Unknown OS'
  if (ua.includes('Win')) os = 'Windows'
  else if (ua.includes('Mac')) os = 'macOS'
  else if (ua.includes('Android')) os = 'Android'
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS'
  else if (ua.includes('Linux')) os = 'Linux'
  else if (ua.includes('CrOS')) os = 'ChromeOS'

  let browser = 'Unknown Browser'
  if (ua.includes('Firefox')) browser = 'Firefox'
  else if (ua.includes('Edg')) browser = 'Edge'
  else if (ua.includes('Chrome')) browser = 'Chrome'
  else if (ua.includes('Safari')) browser = 'Safari'

  const conn = (navigator as Navigator & {
    connection?: {
      effectiveType?: string; downlink?: number; rtt?: number
      saveData?: boolean; type?: string
    }
  }).connection

  const rawEffective = conn?.effectiveType ? conn.effectiveType.toLowerCase() : ''
  const isMobileDevice = deviceType === 'Mobile' || deviceType === 'Tablet'

  let netType = 'Wi-Fi / Broadband'

  if (measuredDownloadMbps !== undefined) {
    if (measuredDownloadMbps >= 100) {
      netType = isMobileDevice ? '5G / Ultra Mobile' : 'Fiber / High-Speed Wi-Fi'
    } else if (measuredDownloadMbps >= 15) {
      netType = isMobileDevice ? '4G LTE Cellular' : 'Broadband / Wi-Fi'
    } else if (measuredDownloadMbps >= 3) {
      netType = isMobileDevice ? '3G / 4G Cellular' : 'Wi-Fi'
    } else if (rawEffective.includes('2g') && measuredDownloadMbps < 0.5) {
      netType = '2G Cellular / Slow'
    } else {
      netType = isMobileDevice ? '4G LTE Cellular' : 'Wi-Fi / Broadband'
    }
  } else {
    if (rawEffective === '4g') {
      netType = isMobileDevice ? '4G LTE Cellular' : 'Broadband / Wi-Fi'
    } else if (rawEffective === '3g') {
      netType = isMobileDevice ? '3G Cellular' : 'Wi-Fi'
    } else if (isMobileDevice) {
      netType = '4G LTE Cellular'
    } else {
      netType = 'Wi-Fi / Broadband'
    }
  }

  const deviceLabel = `${deviceType} (${os} · ${browser})`

  return { deviceType, os, browser, deviceLabel, netType }
}

/* ═══════════════════════════════════════════════════════════
   Map helper components
   ═══════════════════════════════════════════════════════════ */

function MapFocus({ coords }: { coords: [number, number] }) {
  const map = useMap()
  useEffect(() => { map.flyTo(coords, 12, { duration: 1.2 }) }, [coords, map])
  return null
}

function HeatmapLayer({ points }: { points: SpeedPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return undefined
    const data = points.map((p) => [
      p.coords[0], p.coords[1], Math.min(p.speed / 150, 1),
    ] as [number, number, number])
    const layer = (L as typeof L & { heatLayer: (data: [number, number, number][], opts: Record<string, unknown>) => L.Layer }).heatLayer(data, {
      radius: 25, blur: 15, maxZoom: 17, max: 1.0,
      gradient: { 0.3: '#ef6a5b', 0.6: '#f2a541', 0.85: '#33a566', 1.0: '#1a7a45' },
    }).addTo(map)
    return () => { map.removeLayer(layer) }
  }, [map, points])
  return null
}

/* ═══════════════════════════════════════════════════════════
   Trend chart (SVG sparkline for history)
   ═══════════════════════════════════════════════════════════ */

function TrendChart({ data }: { data: HistoryItem[] }) {
  if (data.length < 2) return null
  const W = 380, H = 90, PAD = 16
  const maxSpeed = Math.max(...data.map((d) => d.download), 1)
  const pts = data.map((d, i) => ({
    x: PAD + (i / (data.length - 1)) * (W - 2 * PAD),
    y: PAD + (1 - d.download / maxSpeed) * (H - 2 * PAD),
  }))
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const fill = `${line} L${pts[pts.length - 1].x.toFixed(1)},${H - PAD} L${pts[0].x.toFixed(1)},${H - PAD} Z`

  return (
    <svg className="trend-chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <defs>
        <linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--coral)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--coral)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fill} fill="url(#trendFill)" />
      <path d={line} fill="none" stroke="var(--coral)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r="2.5" fill="var(--coral)" />
      ))}
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════
   Speed helpers
   ═══════════════════════════════════════════════════════════ */

function colorFor(speed: number) {
  if (speed >= 90) return '#33a566'
  if (speed >= 50) return '#f2a541'
  return '#ef6a5b'
}

function qualityFor(result: TestResult) {
  if (result.download >= 100 && result.ping <= 30) return { label: 'Excellent', detail: 'Great for gaming, 4K streaming, and large downloads.' }
  if (result.download >= 50 && result.ping <= 60) return { label: 'Very good', detail: 'Comfortable for streaming, calls, and remote work.' }
  if (result.download >= 15) return { label: 'Good', detail: 'Suitable for HD streaming and everyday browsing.' }
  if (result.download >= 5) return { label: 'Fair', detail: 'Fine for browsing, but calls may occasionally struggle.' }
  return { label: 'Limited', detail: 'Basic browsing only; streaming and calls may be unreliable.' }
}

/* ── Measurement functions ─────────────────────────────── */

/* ═══════════════════════════════════════════════════════════
   App
   ═══════════════════════════════════════════════════════════ */

function App() {
  const { theme, toggleTheme } = useTheme()
  const { t } = useI18n()

  /* ── Core state ──────────────────────────────────────── */
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [liveSpeed, setLiveSpeed] = useState<number | null>(null)
  const [location, setLocation] = useState<[number, number] | null>(null)
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null)
  const [locationName, setLocationName] = useState(t('location.detect'))
  const [showPanel, setShowPanel] = useState(true)
  const [result, setResult] = useState<TestResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [communityTests, setCommunityTests] = useState<CommunityTest[]>([])
  const [syncState, setSyncState] = useState<'offline' | 'loading' | 'live' | 'error'>(isSupabaseConfigured ? 'loading' : 'offline')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isp, setIsp] = useState(t('unknownProvider'))
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try { return JSON.parse(localStorage.getItem('is-map-history') ?? '[]') as HistoryItem[] } catch { return [] }
  })
  const [showHistory, setShowHistory] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [speedFilter, setSpeedFilter] = useState<SpeedFilter>('all')
  const [providerFilter, setProviderFilter] = useState('all')
  const [daysFilter, setDaysFilter] = useState(30)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)

  /* ── New feature state ───────────────────────────────── */
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [showLeaderboard, setShowLeaderboard] = useState(false)
  const [showRecurring, setShowRecurring] = useState(false)
  const [contributorAlias, setContributorAlias] = useState(
    () => localStorage.getItem('is-map-alias') || '',
  )
  const [shareCommunity, setShareCommunity] = useState(true)
  const [accessMethod, setAccessMethod] = useState('Unknown')
  const [flaggedTests, setFlaggedTests] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('is-map-flagged') ?? '[]')) } catch { return new Set() }
  })

  /* ── Derived data ────────────────────────────────────── */

  const points = useMemo(() => {
    const sharedPoints: SpeedPoint[] = communityTests.map((test) => ({
      id: test.id,
      name: 'Community test',
      region: test.city || test.country || 'Shared location',
      coords: [test.latitude, test.longitude],
      speed: Number(test.download_mbps),
      type: test.connection_type || 'Internet',
      lastTest: test.updated_at,
      sampleCount: test.sample_count,
      isVerified: test.is_verified || test.sample_count >= 3,
      flagCount: test.flag_count,
      contributorAlias: test.contributor_alias,
    }))
    return stage === 'complete' && location
      ? [{ name: 'Your result', region: locationName, coords: location, speed: result?.download ?? 0, type: 'Current test' }, ...sharedPoints]
      : sharedPoints
  }, [stage, location, locationName, result, communityTests])

  const averageSpeed = communityTests.length
    ? communityTests.reduce((total, test) => total + Number(test.download_mbps), 0) / communityTests.length
    : 0
  const fastestTest = communityTests.reduce<CommunityTest | null>((fastest, test) =>
    !fastest || Number(test.download_mbps) > Number(fastest.download_mbps) ? test : fastest, null)
  const lastCommunityTest = communityTests.reduce<CommunityTest | null>((latest, test) =>
    !latest || new Date(test.updated_at).getTime() > new Date(latest.updated_at).getTime() ? test : latest, null)
  const chartTests = communityTests.slice().sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 12).reverse()
  const chartMax = Math.max(...chartTests.map((test) => Number(test.download_mbps)), 1)
  const providers = [...new Set(communityTests.map((test) => test.isp).filter(Boolean))] as string[]

  const filteredPoints = points.filter((point) => {
    if ((point.flagCount || 0) >= 3) return false
    const matchingTest = communityTests.find((test) => test.latitude === point.coords[0] && test.longitude === point.coords[1] && Number(test.download_mbps) === point.speed)
    const speedMatches = speedFilter === 'all' || (speedFilter === 'fast' && point.speed >= 90) || (speedFilter === 'medium' && point.speed >= 50 && point.speed < 90) || (speedFilter === 'slow' && point.speed < 50)
    const providerMatches = providerFilter === 'all' || matchingTest?.isp === providerFilter
    const dateMatches = !matchingTest || new Date(matchingTest.updated_at).getTime() >= Date.now() - daysFilter * 86_400_000
    return speedMatches && providerMatches && dateMatches
  })

  /* ── Area average (speed comparison) ─────────────────── */
  const areaAverage = useMemo(() => {
    if (!location || !communityTests.length) return null
    const RADIUS_DEG = 0.045 // ~5 km
    const nearby = communityTests.filter((t) =>
      Math.abs(t.latitude - location[0]) <= RADIUS_DEG && Math.abs(t.longitude - location[1]) <= RADIUS_DEG,
    )
    if (nearby.length < 2) return null
    return nearby.reduce((s, t) => s + Number(t.download_mbps), 0) / nearby.length
  }, [location, communityTests])

  /* ── Regional stats (for map panel) ──────────────────── */
  const regionalStats = useMemo(() => {
    if (!mapCenter || !searchQuery.trim() || !communityTests.length) return null
    const RADIUS = 0.1 // ~11 km
    const nearby = communityTests.filter((t) =>
      Math.abs(t.latitude - mapCenter[0]) <= RADIUS && Math.abs(t.longitude - mapCenter[1]) <= RADIUS,
    )
    if (nearby.length < 1) return null
    const avgDown = nearby.reduce((s, t) => s + Number(t.download_mbps), 0) / nearby.length
    const ispCounts = new Map<string, number>()
    nearby.forEach((t) => { if (t.isp) ispCounts.set(t.isp, (ispCounts.get(t.isp) || 0) + 1) })
    const topIsp = [...ispCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null
    return { count: nearby.length, avgDown, topIsp }
  }, [mapCenter, searchQuery, communityTests])

  /* ── ISP leaderboard ─────────────────────────────────── */
  const ispLeaderboard = useMemo(() => {
    const ispMap = new Map<string, { down: number[]; up: number[]; ping: number[]; count: number }>()
    communityTests.forEach((t) => {
      if (!t.isp) return
      const entry = ispMap.get(t.isp) || { down: [], up: [], ping: [], count: 0 }
      entry.down.push(Number(t.download_mbps))
      entry.up.push(Number(t.upload_mbps))
      entry.ping.push(Number(t.ping_ms))
      entry.count += Math.max(1, t.sample_count || 1)
      ispMap.set(t.isp, entry)
    })
    return [...ispMap.entries()]
      .map(([name, data]) => ({
        name,
        avgDown: numericMedian(data.down),
        avgUp: numericMedian(data.up),
        avgPing: numericMedian(data.ping),
        count: data.count,
      }))
      .filter((entry) => entry.count >= 3)
      .sort((a, b) => b.avgDown - a.avgDown)
      .slice(0, 10)
  }, [communityTests])

  /* ── Supabase realtime ───────────────────────────────── */

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let active = true
    loadCommunityTests()
      .then((tests) => {
        if (!active) return
        setCommunityTests(tests)
        setSyncState('live')
      })
      .catch(() => active && setSyncState('error'))

    const channel = client
      .channel('public-speed-tests')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'speed_tests' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const removed = payload.old as Pick<CommunityTest, 'id'>
          setCommunityTests((current) => current.filter((test) => test.id !== removed.id))
          return
        }
        const changed = payload.new as CommunityTest
        setCommunityTests((current) => [changed, ...current.filter((test) => test.id !== changed.id)].slice(0, 1000))
      })
      .subscribe()

    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [])

  /* ── Location ────────────────────────────────────────── */

  const requestLocation = () => new Promise<[number, number] | null>((resolve) => {
    setStage('locating')
    if (!navigator.geolocation) {
      setLocationName(t('location.unavailable'))
      setStage('idle')
      resolve(null)
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        const detected: [number, number] = [coords.latitude, coords.longitude]
        setLocation(detected)
        setMapCenter(detected)
        setLocationName(`${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`)
        setStage('idle')
        resolve(detected)
        void Promise.allSettled([
          fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${coords.latitude}&lon=${coords.longitude}`)
            .then((response) => response.json())
            .then((data) => setLocationName(data.address?.city || data.address?.town || data.address?.county || `${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`)),
          fetch('https://ipwho.is/')
            .then((response) => response.json())
            .then((data) => data.connection?.isp && setIsp(data.connection.isp)),
        ])
      },
      () => {
        setLocationName(t('location.unavailable'))
        setStage('idle')
        resolve(null)
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    )
  })

  const detectLocation = async () => {
    await requestLocation()
    setShowPanel(true)
  }

  const searchLocation = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!searchQuery.trim()) return
    setSearching(true)
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(searchQuery)}`)
      const [place] = await response.json()
      if (place) {
        setMapCenter([Number(place.lat), Number(place.lon)])
      }
    } finally { setSearching(false) }
  }

  /* ── Share ───────────────────────────────────────────── */

  const shareResult = async () => {
    if (!result) return
    const text = `My ismap result: ${result.download.toFixed(1)} Mbps down, ${result.upload.toFixed(1)} Mbps up, ${result.ping} ms ping, ${result.jitter} ms jitter.`
    if (navigator.share) await navigator.share({ title: t('share.title'), text }).catch(() => undefined)
    else await navigator.clipboard.writeText(text)
  }

  const shareAsImage = async () => {
    if (!result) return
    const dpr = window.devicePixelRatio || 1
    const W = 600, H = 340
    const canvas = document.createElement('canvas')
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const isDark = theme === 'dark'
    const bg = isDark ? '#151f23' : '#fffdf7'
    const fg = isDark ? '#e1e8e3' : '#172a2f'
    const muted = isDark ? '#8a9c9f' : '#66777a'

    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = 'rgba(238,101,77,0.06)'; ctx.beginPath(); ctx.arc(520, 90, 140, 0, Math.PI * 2); ctx.fill()

    ctx.fillStyle = '#ee654d'; ctx.font = 'bold 18px Manrope, sans-serif'; ctx.fillText('ismap', 32, 42)
    ctx.fillStyle = muted; ctx.font = '10px DM Mono, monospace'; ctx.fillText('SPEED TEST RESULT', 110, 42)

    ctx.strokeStyle = isDark ? '#253238' : '#d8d6cd'; ctx.beginPath(); ctx.moveTo(32, 56); ctx.lineTo(W - 32, 56); ctx.stroke()

    ctx.fillStyle = fg; ctx.font = '500 72px DM Mono, monospace'; ctx.fillText(result.download.toFixed(1), 32, 135)
    ctx.fillStyle = muted; ctx.font = '500 14px Manrope, sans-serif'; ctx.fillText('Mbps download', 32, 158)

    const my = 200
    ctx.font = '500 20px DM Mono, monospace'; ctx.fillStyle = fg
    ctx.fillText(`↑ ${result.upload.toFixed(1)}`, 32, my)
    ctx.fillStyle = muted; ctx.font = '12px Manrope, sans-serif'; ctx.fillText('Mbps up', 32, my + 18)

    ctx.font = '500 20px DM Mono, monospace'; ctx.fillStyle = fg; ctx.fillText(`${result.ping}`, 180, my)
    ctx.fillStyle = muted; ctx.font = '12px Manrope, sans-serif'; ctx.fillText('ms ping', 180, my + 18)

    ctx.font = '500 20px DM Mono, monospace'; ctx.fillStyle = fg; ctx.fillText(`${result.jitter}`, 290, my)
    ctx.fillStyle = muted; ctx.font = '12px Manrope, sans-serif'; ctx.fillText('ms jitter', 290, my + 18)

    const q = qualityFor(result)
    ctx.fillStyle = 'rgba(45,148,97,0.1)'; ctx.fillRect(32, 252, W - 64, 32)
    ctx.fillStyle = '#2d9461'; ctx.font = 'bold 12px Manrope, sans-serif'; ctx.fillText(q.label, 44, 272)
    ctx.fillStyle = muted; ctx.font = '11px Manrope, sans-serif'
    ctx.fillText(`  ·  ${q.detail}`, 44 + ctx.measureText(q.label).width, 272)

    ctx.fillStyle = muted; ctx.font = '10px Manrope, sans-serif'
    ctx.fillText(`${locationName}  ·  ${isp}  ·  ${new Date().toLocaleDateString()}`, 32, H - 18)

    canvas.toBlob(async (blob) => {
      if (!blob) return
      const file = new File([blob], 'is-map-result.png', { type: 'image/png' })
      if (navigator.share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: t('share.title') }).catch(() => undefined)
      } else {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = 'is-map-result.png'
        document.body.appendChild(a); a.click(); document.body.removeChild(a)
        URL.revokeObjectURL(url)
      }
    }, 'image/png')
  }

  /* ── Export ───────────────────────────────────────────── */

  const exportData = () => {
    const currentMeta = detectClientMetadata()
    const dataToExport = communityTests.length > 0
      ? communityTests.map((item) => ({
          ID: item.id,
          Date: new Date(item.created_at || item.updated_at).toLocaleString(),
          Download_Mbps: item.download_mbps,
          Upload_Mbps: item.upload_mbps,
          Ping_ms: item.ping_ms,
          Jitter_ms: item.jitter_ms ?? '',
          Connection_Info: item.connection_type || `${currentMeta.netType} · ${currentMeta.deviceLabel}`,
          City: item.city || 'Unknown',
          ISP: item.isp || 'Unknown',
          Verified: item.is_verified ? 'Yes' : 'No',
          Contributor: item.contributor_alias || '',
        }))
      : history.map((item) => ({
          ID: item.id,
          Date: new Date(item.testedAt).toLocaleString(),
          Download_Mbps: item.download,
          Upload_Mbps: item.upload,
          Ping_ms: item.ping,
          Jitter_ms: item.jitter,
          Network_Type: item.netType || currentMeta.netType,
          Device_Info: item.deviceLabel || currentMeta.deviceLabel,
          City: item.location,
          ISP: item.isp,
        }))

    if (dataToExport.length === 0) return

    const headers = Object.keys(dataToExport[0]).join(',')
    const rows = dataToExport.map((row) =>
      Object.values(row)
        .map((val) => `"${String(val).replace(/"/g, '""')}"`)
        .join(','),
    )
    const csvContent = [headers, ...rows].join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `is-map-speed-data-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  /* ── Flag community test ─────────────────────────────── */

  const handleFlag = async (testId: string) => {
    if (flaggedTests.has(testId)) return
    try {
      await flagCommunityTest(testId)
      setFlaggedTests((prev) => {
        const next = new Set(prev)
        next.add(testId)
        localStorage.setItem('is-map-flagged', JSON.stringify([...next]))
        return next
      })
      setCommunityTests((prev) =>
        prev.map((t) => (t.id === testId ? { ...t, flag_count: (t.flag_count || 0) + 1 } : t)),
      )
    } catch { /* silently fail */ }
  }

  /* ── Speed test (multi-sample) ───────────────────────── */

  const beginTest = useCallback(async () => {
    setResult(null)
    setErrorMessage('')
    setProgress(0)
    setLiveSpeed(null)
    setSaveState('idle')
    const testLocation = await requestLocation()
    setStage('testing')
    try {
      const nextResult = await measureConnection((nextProgress, speed) => {
        setProgress(Math.min(99, nextProgress))
        setLiveSpeed(speed ?? null)
      })
      setLiveSpeed(null)
      setProgress(100)
      setResult(nextResult)
      setStage('complete')

      const clientMeta = detectClientMetadata(nextResult.download)
      const historyItem: HistoryItem = {
        ...nextResult,
        id: crypto.randomUUID(),
        testedAt: new Date().toISOString(),
        location: locationName,
        isp,
        deviceLabel: clientMeta.deviceLabel,
        netType: clientMeta.netType,
      }
      setHistory((current) => {
        const updated = [historyItem, ...current].slice(0, 20)
        localStorage.setItem('is-map-history', JSON.stringify(updated))
        return updated
      })

      if (shareCommunity && supabase && testLocation && locationName !== t('location.unavailable') && locationName !== t('location.detect')) {
        setSaveState('saving')
        try {
          const safeLocation = privacySafeCoordinates(testLocation[0], testLocation[1])
          const saved = await saveCommunityTest({
            latitude: safeLocation[0],
            longitude: safeLocation[1],
            download_mbps: nextResult.download,
            upload_mbps: nextResult.upload,
            ping_ms: nextResult.ping,
            connection_type: `${accessMethod} · ${clientMeta.deviceLabel}`,
            isp,
            city: locationName,
            country: null,
            jitter_ms: nextResult.jitter,
            contributor_alias: contributorAlias.trim() || null,
          })
          if (saved) setCommunityTests((current) => current.some((item) => item.id === saved.id) ? current : [saved, ...current])
          setSyncState('live')
          setSaveState('saved')
        } catch {
          setSyncState('error')
          setSaveState('error')
        }
      } else {
        setSaveState('error')
      }
    } catch {
      setErrorMessage(t('test.errorConnection'))
      setStage('error')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationName, isp, contributorAlias, shareCommunity, accessMethod, t])

  /* ── Recurring test ──────────────────────────────────── */
  const { isScheduled, intervalMinutes, start: startRecurring, stop: stopRecurring } = useRecurringTest(beginTest)
  const [pendingInterval, setPendingInterval] = useState(intervalMinutes)

  /* ═══════════════════════════════════════════════════════
     JSX
     ═══════════════════════════════════════════════════════ */

  return (
    <main className="app-shell">

      {/* ── Topbar ──────────────────────────────────────── */}
      <header className="topbar">
        <button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="ismap home">
          <img src="/logo.svg" alt="ismap Logo" className="brand-logo-img" />
          <span>ismap</span>
        </button>
        <nav aria-label="Primary navigation">
          <a className="active" href="#test">{t('nav.speedTest')}</a>
          <a href="#map">{t('nav.coverageMap')}</a>
          <a href="#about">{t('nav.howItWorks')}</a>
        </nav>
        <div className="topbar-actions">
          <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle dark mode" title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
            {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button className="location-pill" onClick={detectLocation} disabled={stage === 'locating'}>
            <MapPin size={15} /> {locationName} <ChevronDown size={14} />
          </button>
        </div>
      </header>

      {/* ── Hero section ────────────────────────────────── */}
      <section className="hero-section" id="test">
        <div className="hero-copy">
          <span className="eyebrow"><span className="live-dot" /> {t('hero.eyebrow')}</span>
          <h1>{t('hero.title')}<em>{t('hero.titleEm')}</em></h1>
          <p className="lede">{t('hero.lede')}</p>
          <div className="trust-row">
            <span><ShieldCheck size={17} />{t('trust.privacy')}</span>
            <span><Activity size={17} />{t('trust.realWorld')}</span>
            <span><MapPin size={17} />{t('trust.location')}</span>
          </div>
        </div>

        {/* ── Test card ─────────────────────────────────── */}
        <div className={`test-card stage-${stage}`}>
          <div className="card-header">
            <div>
              <span className="mini-label">{t('test.label')}</span>
              <h2>{stage === 'complete' ? t('test.complete') : stage === 'testing' ? t('test.testing') : stage === 'locating' ? t('test.locating') : stage === 'error' ? t('test.error') : t('test.idle')}</h2>
            </div>
            <Wifi size={22} />
          </div>

          <div className="speed-gauge" style={{ '--progress': `${stage === 'complete' ? 100 : progress}%` } as React.CSSProperties}>
            <div className="gauge-inner">
              {stage === 'complete' && result
                ? <><strong>{result.download.toFixed(1)}</strong><span>Mbps</span></>
                : stage === 'testing' && liveSpeed !== null
                ? <><strong>{liveSpeed.toFixed(1)}</strong><span>Mbps ↓</span></>
                : stage === 'testing'
                ? <><strong>{progress}</strong><span>% complete</span></>
                : <LocateFixed size={34} />
              }
            </div>
          </div>

          {stage === 'complete' && result ? (
            <>
              {/* Results row with 4 metrics */}
              <div className="results-row">
                <div><Download size={18} /><span>{t('test.download')}</span><strong>{result.download.toFixed(1)} <small>Mbps</small></strong></div>
                <div><Upload size={18} /><span>{t('test.upload')}</span><strong>{result.upload.toFixed(1)} <small>Mbps</small></strong></div>
                <div><Clock3 size={18} /><span>{t('test.ping')}</span><strong>{result.ping} <small>ms</small></strong></div>
                <div><Zap size={18} /><span>{t('test.jitter')}</span><strong>{result.jitter} <small>ms</small></strong></div>
              </div>

              {/* Quality assessment */}
              <div className="quality-line">
                <span><b>{qualityFor(result).label}</b>{qualityFor(result).detail}</span>
                <div>
                  <button onClick={shareAsImage} aria-label={t('share.image')} title={t('share.image')}><ImageIcon size={15} /></button>
                  <button onClick={shareResult} aria-label="Share result"><Share2 size={15} /></button>
                  <button onClick={() => setShowHistory(true)} aria-label="View test history"><History size={15} /></button>
                </div>
              </div>

              <div className="capacity-line" aria-label="What this connection can handle">
                <span><b>{practicalCapacity(result.download, result.upload, result.ping).streams4k}</b> simultaneous 4K streams</span>
                <span><b>{practicalCapacity(result.download, result.upload, result.ping).calls}</b> HD video calls</span>
                <span>{practicalCapacity(result.download, result.upload, result.ping).gaming}</span>
              </div>

              {/* Speed comparison vs area */}
              {areaAverage && (
                <div className="comparison-line">
                  {result.download > areaAverage * 1.02
                    ? <><strong className="comp-up">↑ {Math.round((result.download / areaAverage - 1) * 100)}%</strong> {t('comp.faster')}</>
                    : result.download < areaAverage * 0.98
                    ? <><strong className="comp-down">↓ {Math.round((1 - result.download / areaAverage) * 100)}%</strong> {t('comp.slower')}</>
                    : <strong>{t('comp.same')}</strong>
                  }
                </div>
              )}

              {/* Device & network badges */}
              <div className="meta-badge-row">
                <span>{detectClientMetadata(result.download).deviceType === 'Mobile' ? <Smartphone size={13} /> : <Laptop size={13} />} {detectClientMetadata(result.download).deviceLabel}</span>
                <span><Radio size={13} /> {detectClientMetadata(result.download).netType}</span>
                <span><Wifi size={13} /> {isp}</span>
              </div>
            </>
          ) : (
            <p className={`test-note ${stage === 'error' ? 'error-note' : ''}`}>
              {stage === 'error' ? errorMessage : stage === 'idle' ? t('test.noteIdle') : stage === 'locating' ? t('test.noteLocating') : t('test.noteTesting')}
            </p>
          )}

          <button className="primary-button" onClick={beginTest} disabled={stage === 'locating' || stage === 'testing'}>
            {stage === 'idle' ? t('test.start') : stage === 'complete' || stage === 'error' ? t('test.retry') : stage === 'locating' ? t('test.locatingBtn') : `Testing… ${progress}%`}
          </button>

          {/* Contributor alias */}
          <input
            className="alias-input"
            type="text"
            placeholder={t('alias.placeholder')}
            value={contributorAlias}
            onChange={(e) => { setContributorAlias(e.target.value); localStorage.setItem('is-map-alias', e.target.value) }}
            maxLength={20}
          />

          <div className="test-preferences">
            <label>
              Connection
              <select value={accessMethod} onChange={(event) => setAccessMethod(event.target.value)}>
                <option>Unknown</option><option>Wi-Fi</option><option>Ethernet</option>
                <option>4G</option><option>5G</option><option>Fixed wireless</option><option>Satellite</option>
              </select>
            </label>
            <label className="privacy-choice">
              <input type="checkbox" checked={shareCommunity} onChange={(event) => setShareCommunity(event.target.checked)} />
              Share on the map using an approximate location
            </label>
          </div>

          <p className="data-usage-note">Adaptive test · Uses up to approximately 51 MB of data · Avoid testing on a limited plan</p>

          <p className={`fine-print save-${saveState}`}>
            {stage === 'complete'
              ? (!shareCommunity ? 'Saved only in this browser · Not shared publicly' : saveState === 'saving' ? t('test.saving') : saveState === 'saved' ? t('test.saved') : saveState === 'error' ? t('test.saveError') : t('test.finePrint'))
              : 'Testing works without sharing. Map submissions use an approximate location.'}
          </p>

          {/* Recurring test */}
          <div className="recurring-row">
            {isScheduled ? (
              <>
                <span className="recurring-active"><span className="live-dot" /> {t('recurring.active')} {intervalMinutes} min</span>
                <button className="recurring-stop" onClick={stopRecurring}>{t('recurring.stop')}</button>
              </>
            ) : (
              <>
                <button className="recurring-toggle" onClick={() => setShowRecurring((v) => !v)}>
                  <Timer size={13} /> {t('recurring.schedule')}
                </button>
                {showRecurring && (
                  <div className="recurring-options">
                    <select value={pendingInterval} onChange={(e) => setPendingInterval(Number(e.target.value))}>
                      <option value={5}>5 min</option>
                      <option value={15}>15 min</option>
                      <option value={30}>30 min</option>
                      <option value={60}>1 hr</option>
                      <option value={180}>3 hr</option>
                      <option value={360}>6 hr</option>
                    </select>
                    <button onClick={() => { startRecurring(pendingInterval); setShowRecurring(false) }}>{t('recurring.start')}</button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Map section ─────────────────────────────────── */}
      <section className="map-section" id="map">
        <div className="section-heading">
          <div><span className="eyebrow">{t('map.eyebrow')}</span><h2>{t('map.title')}</h2><p>{t('map.subtitle')}</p></div>
          <div className="map-stat">
            <strong>{communityTests.length.toLocaleString()}</strong>
            <span>{t('map.sharedTests')}</span>
            {lastCommunityTest && <time>Last test {new Date(lastCommunityTest.updated_at).toLocaleString()}</time>}
            <small className={`sync-badge sync-${syncState}`}><i />{syncState === 'live' ? t('map.syncLive') : syncState === 'loading' ? t('map.syncLoading') : syncState === 'error' ? t('map.syncError') : t('map.syncOffline')}</small>
          </div>
        </div>

        {/* Toolbar */}
        <div className="map-toolbar">
          <form onSubmit={searchLocation}>
            <Search size={16} />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t('map.searchPlaceholder')} aria-label="Search map" />
            <button disabled={searching}>{searching ? t('map.finding') : t('map.go')}</button>
          </form>
          <button className={showFilters ? 'selected' : ''} onClick={() => setShowFilters((value) => !value)}><SlidersHorizontal size={16} /> {t('map.filters')}{speedFilter !== 'all' || providerFilter !== 'all' || daysFilter !== 30 ? ' •' : ''}</button>
          {history.length > 0 && <button onClick={() => setShowHistory(true)}><History size={16} /> {t('map.history')}</button>}
          <button className={showLeaderboard ? 'selected' : ''} onClick={() => setShowLeaderboard((v) => !v)}><Trophy size={16} /> {t('map.ispRanking')}</button>
          <button onClick={exportData} title="Export speed test dataset as CSV" aria-label="Export dataset"><Download size={16} /> {t('map.export')}</button>
          {showFilters && <div className="filter-popover">
            <label>{t('map.speed')}<select value={speedFilter} onChange={(event) => setSpeedFilter(event.target.value as SpeedFilter)}><option value="all">{t('map.allSpeeds')}</option><option value="fast">{t('map.fast')}</option><option value="medium">{t('map.medium')}</option><option value="slow">{t('map.slow')}</option></select></label>
            <label>{t('map.provider')}<select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="all">{t('map.allProviders')}</option>{providers.map((provider) => <option key={provider}>{provider}</option>)}</select></label>
            <label>{t('map.period')}<select value={daysFilter} onChange={(event) => setDaysFilter(Number(event.target.value))}><option value={7}>{t('map.7d')}</option><option value={30}>{t('map.30d')}</option><option value={90}>{t('map.90d')}</option><option value={3650}>{t('map.all')}</option></select></label>
          </div>}
        </div>

        {/* ISP Leaderboard */}
        {showLeaderboard && ispLeaderboard.length > 0 && (
          <div className="isp-leaderboard">
            <div className="lb-header">
              <h3><Trophy size={16} /> {t('leaderboard.title')}</h3>
              <small>Median results · Minimum 3 samples · Higher sample counts are more reliable</small>
            </div>
            <table>
              <thead>
                <tr><th>#</th><th>{t('leaderboard.provider')}</th><th>Median ↓</th><th>Median ↑</th><th>Median ping</th><th>{t('leaderboard.tests')}</th></tr>
              </thead>
              <tbody>
                {ispLeaderboard.map((entry, i) => (
                  <tr key={entry.name}>
                    <td>{i + 1}</td>
                    <td>{entry.name}</td>
                    <td><strong>{entry.avgDown.toFixed(1)}</strong></td>
                    <td>{entry.avgUp.toFixed(1)}</td>
                    <td>{Math.round(entry.avgPing)} ms</td>
                    <td>{entry.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Map frame */}
        <div className="map-frame">
          <MapContainer center={[0, 20]} zoom={3} scrollWheelZoom className="map" zoomControl>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {(mapCenter || location) && <MapFocus coords={(mapCenter || location)!} />}

            {showHeatmap
              ? <HeatmapLayer points={filteredPoints} />
              : filteredPoints.map((point, index) => (
                <CircleMarker key={`${point.name}-${point.coords.join('-')}-${index}`} center={point.coords} radius={point.name === 'Your result' ? 12 : 9} pathOptions={{ color: '#fffdf7', weight: 3, fillColor: colorFor(point.speed), fillOpacity: 1 }}>
                  <Popup>
                    <div className="map-popup">
                      <b>
                        {point.name}
                        {point.isVerified && <span className="verified-badge"><BadgeCheck size={12} /> {t('verified')}</span>}
                      </b>
                      <span>{point.region}</span>
                      {point.contributorAlias && <small className="alias-tag">by {point.contributorAlias}</small>}
                      <strong>{point.speed.toFixed(1)} Mbps</strong>
                      <small>{point.type}</small>
                      {point.lastTest && <time>Last tested {new Date(point.lastTest).toLocaleString()}</time>}
                      {point.sampleCount && point.sampleCount > 1 && <em>{point.sampleCount} tests averaged</em>}
                      {point.id && point.name !== 'Your result' && (
                        <button
                          className="flag-btn"
                          onClick={(e) => { e.stopPropagation(); handleFlag(point.id!) }}
                          disabled={flaggedTests.has(point.id)}
                        >
                          <Flag size={11} /> {flaggedTests.has(point.id) ? t('flagged') : t('flag')} {point.flagCount ? `(${point.flagCount})` : ''}
                        </button>
                      )}
                    </div>
                  </Popup>
                </CircleMarker>
              ))
            }
          </MapContainer>

          {/* Legend with layer toggle */}
          <div className="legend">
            <span><i className="fast" /> 90+ Mbps</span>
            <span><i className="medium" /> 50–89</span>
            <span><i className="slow" /> Under 50</span>
            <button className="layer-toggle" onClick={() => setShowHeatmap((v) => !v)} aria-label="Toggle map layer">
              <Layers size={13} /> {showHeatmap ? t('map.dots') : t('map.heatmap')}
            </button>
          </div>

          {/* Empty state */}
          {!communityTests.length && syncState !== 'loading' && (
            <div className="empty-map-state"><Radio size={24} /><strong>{t('map.emptyTitle')}</strong><span>{t('map.emptySubtitle')}</span></div>
          )}

          {/* Map panel (global or regional) */}
          {showPanel && communityTests.length > 0 && (
            <aside className="map-panel">
              <button className="panel-close" onClick={() => setShowPanel(false)} aria-label="Close map summary">×</button>
              <span className="mini-label">{regionalStats ? t('panel.regional') : t('panel.eyebrow')}</span>
              <h3>{regionalStats ? searchQuery : t('panel.title')}</h3>
              <div className="average">
                <strong>{(regionalStats?.avgDown ?? averageSpeed).toFixed(1)}</strong>
                <span>{t('panel.avgLabel')}</span>
              </div>
              {regionalStats ? (
                <div className="regional-info">
                  <span>{regionalStats.count} tests in this area</span>
                  {regionalStats.topIsp && <span>Top ISP: {regionalStats.topIsp}</span>}
                </div>
              ) : (
                <div className="bar-chart" aria-label="Connection speed distribution">
                  {chartTests.map((test) => <i key={test.id} style={{ height: `${Math.max(8, Number(test.download_mbps) / chartMax * 100)}%` }} />)}
                </div>
              )}
              <div className="panel-footer">
                <span>
                  <b>{regionalStats ? 'Tests' : t('panel.lastTest')}</b>
                  {regionalStats ? `${regionalStats.count} total` : lastCommunityTest ? new Date(lastCommunityTest.updated_at).toLocaleString() : ''}
                </span>
                <strong>{regionalStats ? `${regionalStats.avgDown.toFixed(1)} ${t('panel.avgLabel')}` : fastestTest ? `${Number(fastestTest.download_mbps).toFixed(1)} ${t('panel.best')}` : '—'}</strong>
              </div>
            </aside>
          )}
        </div>
      </section>

      {/* ── How it works ────────────────────────────────── */}
      <section className="how-section" id="about">
        <span className="eyebrow">{t('how.eyebrow')}</span>
        <h2>{t('how.title')}</h2>
        <div className="steps">
          <div><b>01</b><LocateFixed /><h3>{t('how.step1')}</h3><p>{t('how.step1Desc')}</p></div>
          <div><b>02</b><Activity /><h3>{t('how.step2')}</h3><p>{t('how.step2Desc')}</p></div>
          <div><b>03</b><MapPin /><h3>{t('how.step3')}</h3><p>{t('how.step3Desc')}</p></div>
        </div>
      </section>

      {/* ── History drawer ──────────────────────────────── */}
      {showHistory && <div className="modal-backdrop" onClick={() => setShowHistory(false)}><aside className="history-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-heading"><div><span className="eyebrow">{t('history.eyebrow')}</span><h2>{t('history.title')}</h2></div><button onClick={() => setShowHistory(false)} aria-label="Close history"><X /></button></div>
        {history.length >= 2 && <TrendChart data={[...history].reverse()} />}
        {history.length ? <div className="history-list">{history.map((item) => <article key={item.id}><div><strong>{item.download.toFixed(1)} <small>Mbps</small></strong><span>{item.location} · {item.isp}</span>{item.deviceLabel && <small className="history-meta">{item.netType || 'Network'} · {item.deviceLabel}</small>}</div><div><b>{item.upload.toFixed(1)} up</b><b>{item.ping} ms{item.jitter ? ` · ${item.jitter} ms jitter` : ''}</b><time>{new Date(item.testedAt).toLocaleDateString()}</time></div></article>)}</div> : <p className="empty-history">{t('history.empty')}</p>}
        {history.length > 0 && (
          <div className="drawer-footer-actions">
            <button className="export-history" onClick={exportData}><Download size={13} /> {t('history.exportCsv')}</button>
            <button className="clear-history" onClick={() => { localStorage.removeItem('is-map-history'); setHistory([]) }}>{t('history.clear')}</button>
          </div>
        )}
      </aside></div>}

      {/* ── Footer ──────────────────────────────────────── */}
      <footer>
        <div className="brand">
          <img src="/logo.svg" alt="ismap Logo" className="brand-logo-img" />
          <span>ismap</span>
        </div>
        <p className="footer-powered">
          Powered by <a href="https://bitlabsbuild.com" target="_blank" rel="noopener noreferrer" className="bitlabs-link">BitLabs Technology</a>
        </p>
        <p className="footer-tagline">{t('footer.tagline')}</p>
        <span>{t('footer.copyright')}</span>
      </footer>
      <Analytics />
    </main>
  )
}

export default App
