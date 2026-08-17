import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import { Activity, ChevronDown, Clock3, Download, History, LocateFixed, MapPin, Radio, Search, Share2, ShieldCheck, SlidersHorizontal, Upload, Wifi, X } from 'lucide-react'
import { Analytics } from '@vercel/analytics/react'
import { isSupabaseConfigured, loadCommunityTests, saveCommunityTest, supabase, type CommunityTest } from './lib/supabase'
import 'leaflet/dist/leaflet.css'
import './App.css'

type Stage = 'idle' | 'locating' | 'testing' | 'complete' | 'error'
type TestResult = { download: number; upload: number; ping: number }
type HistoryItem = TestResult & { id: string; testedAt: string; location: string; isp: string }
type SpeedFilter = 'all' | 'fast' | 'medium' | 'slow'

type SpeedPoint = {
  name: string
  region: string
  coords: [number, number]
  speed: number
  type: string
  lastTest?: string
  sampleCount?: number
}

function MapFocus({ coords }: { coords: [number, number] }) {
  const map = useMap()
  useEffect(() => { map.flyTo(coords, 12, { duration: 1.2 }) }, [coords, map])
  return null
}

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

async function measurePing() {
  const samples: number[] = []
  for (let i = 0; i < 3; i += 1) {
    const started = performance.now()
    const response = await fetch(`https://speed.cloudflare.com/__down?bytes=1&t=${Date.now()}-${i}`, { cache: 'no-store' })
    if (!response.ok) throw new Error('Ping test failed')
    await response.arrayBuffer()
    samples.push(performance.now() - started)
  }
  return Math.round(Math.min(...samples))
}

async function measureDownload() {
  const bytes = 5_000_000
  const started = performance.now()
  const response = await fetch(`https://speed.cloudflare.com/__down?bytes=${bytes}&t=${Date.now()}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Download test failed')
  const payload = await response.arrayBuffer()
  const seconds = (performance.now() - started) / 1000
  return (payload.byteLength * 8) / seconds / 1_000_000
}

async function measureUpload() {
  const payload = new Uint8Array(1_000_000)
  crypto.getRandomValues(payload.subarray(0, 65_536))
  const started = performance.now()
  const response = await fetch(`https://speed.cloudflare.com/__up?t=${Date.now()}`, { method: 'POST', body: payload, cache: 'no-store' })
  if (!response.ok) throw new Error('Upload test failed')
  const seconds = (performance.now() - started) / 1000
  return (payload.byteLength * 8) / seconds / 1_000_000
}

function App() {
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState(0)
  const [location, setLocation] = useState<[number, number] | null>(null)
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null)
  const [locationName, setLocationName] = useState('Detect location')
  const [showPanel, setShowPanel] = useState(true)
  const [result, setResult] = useState<TestResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [communityTests, setCommunityTests] = useState<CommunityTest[]>([])
  const [syncState, setSyncState] = useState<'offline' | 'loading' | 'live' | 'error'>(isSupabaseConfigured ? 'loading' : 'offline')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [isp, setIsp] = useState('Unknown provider')
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

  const points = useMemo(() => {
    const sharedPoints: SpeedPoint[] = communityTests.map((test) => ({
      name: 'Community test',
      region: test.city || test.country || 'Shared location',
      coords: [test.latitude, test.longitude],
      speed: Number(test.download_mbps),
      type: test.connection_type || 'Internet',
      lastTest: test.updated_at,
      sampleCount: test.sample_count,
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
    const matchingTest = communityTests.find((test) => test.latitude === point.coords[0] && test.longitude === point.coords[1] && Number(test.download_mbps) === point.speed)
    const speedMatches = speedFilter === 'all' || (speedFilter === 'fast' && point.speed >= 90) || (speedFilter === 'medium' && point.speed >= 50 && point.speed < 90) || (speedFilter === 'slow' && point.speed < 50)
    const providerMatches = providerFilter === 'all' || matchingTest?.isp === providerFilter
    const dateMatches = !matchingTest || new Date(matchingTest.updated_at).getTime() >= Date.now() - daysFilter * 86_400_000
    return speedMatches && providerMatches && dateMatches
  })

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
        const changed = payload.new as CommunityTest
        setCommunityTests((current) => [changed, ...current.filter((test) => test.id !== changed.id)].slice(0, 1000))
      })
      .subscribe()

    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [])

  const requestLocation = () => new Promise<[number, number] | null>((resolve) => {
    setStage('locating')
    if (!navigator.geolocation) {
      setLocationName('Location unavailable')
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
        setLocationName('Location unavailable')
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

  const shareResult = async () => {
    if (!result) return
    const text = `My IS Map result: ${result.download.toFixed(1)} Mbps down, ${result.upload.toFixed(1)} Mbps up, ${result.ping} ms ping.`
    if (navigator.share) await navigator.share({ title: 'My IS Map result', text }).catch(() => undefined)
    else await navigator.clipboard.writeText(text)
  }

  const beginTest = async () => {
    setResult(null)
    setErrorMessage('')
    setProgress(0)
    setSaveState('idle')
    const testLocation = await requestLocation()
    if (!testLocation) {
      setErrorMessage('A precise location is required before this test can be added to the map.')
      setStage('error')
      return
    }
    setStage('testing')
    try {
      const ping = await measurePing()
      setProgress(25)
      const download = await measureDownload()
      setProgress(70)
      const upload = await measureUpload()
      setProgress(100)
      const nextResult = { download: Number(download.toFixed(1)), upload: Number(upload.toFixed(1)), ping }
      setResult(nextResult)
      setStage('complete')
      const historyItem: HistoryItem = { ...nextResult, id: crypto.randomUUID(), testedAt: new Date().toISOString(), location: locationName, isp }
      setHistory((current) => {
        const updated = [historyItem, ...current].slice(0, 20)
        localStorage.setItem('is-map-history', JSON.stringify(updated))
        return updated
      })
      if (supabase && testLocation && locationName !== 'Location unavailable' && locationName !== 'Detect location') {
        setSaveState('saving')
        try {
          const saved = await saveCommunityTest({
            latitude: testLocation[0],
            longitude: testLocation[1],
            download_mbps: nextResult.download,
            upload_mbps: nextResult.upload,
            ping_ms: nextResult.ping,
            connection_type: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? null,
            isp,
            city: locationName,
            country: null,
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
      setErrorMessage('The test server could not be reached. Check your connection and try again.')
      setStage('error')
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="IS Map home">
          <img src="/logo.png" alt="IS Map Logo" className="brand-logo-img" />
          <span>IS Map</span>
        </button>
        <nav aria-label="Primary navigation">
          <a className="active" href="#test">Speed test</a>
          <a href="#map">Coverage map</a>
          <a href="#about">How it works</a>
        </nav>
        <button className="location-pill" onClick={detectLocation} disabled={stage === 'locating'}>
          <MapPin size={15} /> {locationName} <ChevronDown size={14} />
        </button>
      </header>

      <section className="hero-section" id="test">
        <div className="hero-copy">
          <span className="eyebrow"><span className="live-dot" /> LIVE NETWORK MAP</span>
          <h1>How fast is the internet <em>around you?</em></h1>
          <p className="lede">Test your connection in seconds and add your result to a living, community-powered map of internet speeds.</p>
          <div className="trust-row">
            <span><ShieldCheck size={17} /> Privacy first</span>
            <span><Activity size={17} /> Real-world data</span>
            <span><MapPin size={17} /> Location based</span>
          </div>
        </div>

        <div className={`test-card stage-${stage}`}>
          <div className="card-header">
            <div><span className="mini-label">YOUR CONNECTION</span><h2>{stage === 'complete' ? 'Test complete' : stage === 'testing' ? 'Testing your speed' : stage === 'locating' ? 'Finding your location' : stage === 'error' ? 'Test interrupted' : 'Ready when you are'}</h2></div>
            <Wifi size={22} />
          </div>

          <div className="speed-gauge" style={{ '--progress': `${stage === 'complete' ? 100 : progress}%` } as React.CSSProperties}>
            <div className="gauge-inner">
              {stage === 'complete' && result ? <><strong>{result.download.toFixed(1)}</strong><span>Mbps</span></> : stage === 'testing' ? <><strong>{progress}</strong><span>% complete</span></> : <LocateFixed size={34} />}
            </div>
          </div>

          {stage === 'complete' && result ? (
            <>
              <div className="results-row">
                <div><Download size={18} /><span>Download</span><strong>{result.download.toFixed(1)} <small>Mbps</small></strong></div>
                <div><Upload size={18} /><span>Upload</span><strong>{result.upload.toFixed(1)} <small>Mbps</small></strong></div>
                <div><Clock3 size={18} /><span>Ping</span><strong>{result.ping} <small>ms</small></strong></div>
              </div>
              <div className="quality-line"><span><b>{qualityFor(result).label}</b>{qualityFor(result).detail}</span><div><button onClick={shareResult} aria-label="Share result"><Share2 size={15} /></button><button onClick={() => setShowHistory(true)} aria-label="View test history"><History size={15} /></button></div></div>
            </>
          ) : <p className={`test-note ${stage === 'error' ? 'error-note' : ''}`}>{stage === 'error' ? errorMessage : stage === 'idle' ? 'We’ll ask for your location, then run a quick test.' : stage === 'locating' ? 'Allow location access in your browser to place your result.' : 'Measuring download, upload, and response time…'}</p>}

          <button className="primary-button" onClick={beginTest} disabled={stage === 'locating' || stage === 'testing'}>
            {stage === 'idle' ? 'Start speed test' : stage === 'complete' || stage === 'error' ? 'Test again' : stage === 'locating' ? 'Locating…' : `Testing… ${progress}%`}
          </button>
          <p className={`fine-print save-${saveState}`}>{stage === 'complete' ? (saveState === 'saving' ? 'Saving result to the shared map…' : saveState === 'saved' ? 'Saved permanently · Visible on the shared map' : saveState === 'error' ? 'Result not saved · Check location and database setup' : 'Browser-provided coordinates are shared with the result') : 'No signup required · Browser-provided coordinates are shared with the result'}</p>
        </div>
      </section>

      <section className="map-section" id="map">
        <div className="section-heading">
          <div><span className="eyebrow">COMMUNITY COVERAGE</span><h2>Explore speeds near you</h2><p>Each dot is a real-world connection test shared by the community.</p></div>
          <div className="map-stat">
            <strong>{communityTests.length.toLocaleString()}</strong>
            <span>shared tests loaded</span>
            {lastCommunityTest && <time>Last test {new Date(lastCommunityTest.updated_at).toLocaleString()}</time>}
            <small className={`sync-badge sync-${syncState}`}><i />{syncState === 'live' ? 'Live database' : syncState === 'loading' ? 'Connecting' : syncState === 'error' ? 'Sync unavailable' : 'Database not configured'}</small>
          </div>
        </div>

        <div className="map-toolbar">
          <form onSubmit={searchLocation}><Search size={16} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search a city or area" aria-label="Search map" /><button disabled={searching}>{searching ? 'Finding…' : 'Go'}</button></form>
          <button className={showFilters ? 'selected' : ''} onClick={() => setShowFilters((value) => !value)}><SlidersHorizontal size={16} /> Filters{speedFilter !== 'all' || providerFilter !== 'all' || daysFilter !== 30 ? ' •' : ''}</button>
          {history.length > 0 && <button onClick={() => setShowHistory(true)}><History size={16} /> History</button>}
          {showFilters && <div className="filter-popover">
            <label>Speed<select value={speedFilter} onChange={(event) => setSpeedFilter(event.target.value as SpeedFilter)}><option value="all">All speeds</option><option value="fast">90+ Mbps</option><option value="medium">50–89 Mbps</option><option value="slow">Under 50 Mbps</option></select></label>
            <label>Provider<select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="all">All providers</option>{providers.map((provider) => <option key={provider}>{provider}</option>)}</select></label>
            <label>Period<select value={daysFilter} onChange={(event) => setDaysFilter(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={3650}>All time</option></select></label>
          </div>}
        </div>

        <div className="map-frame">
          <MapContainer center={[0, 20]} zoom={3} scrollWheelZoom className="map" zoomControl>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {(mapCenter || location) && <MapFocus coords={(mapCenter || location)!} />}
            {filteredPoints.map((point, index) => <CircleMarker key={`${point.name}-${point.coords.join('-')}-${index}`} center={point.coords} radius={point.name === 'Your result' ? 12 : 9} pathOptions={{ color: '#fffdf7', weight: 3, fillColor: colorFor(point.speed), fillOpacity: 1 }}>
              <Popup><div className="map-popup"><b>{point.name}</b><span>{point.region}</span><strong>{point.speed.toFixed(1)} Mbps</strong><small>{point.type}</small>{point.lastTest && <time>Last tested {new Date(point.lastTest).toLocaleString()}</time>}{point.sampleCount && point.sampleCount > 1 && <em>{point.sampleCount} tests averaged</em>}</div></Popup>
            </CircleMarker>)}
          </MapContainer>

          <div className="legend"><span><i className="fast" /> 90+ Mbps</span><span><i className="medium" /> 50–89</span><span><i className="slow" /> Under 50</span></div>
          {!communityTests.length && syncState !== 'loading' && (
            <div className="empty-map-state"><Radio size={24} /><strong>No speed tests logged yet</strong><span>Run the first test to start the community map.</span></div>
          )}

          {showPanel && communityTests.length > 0 && (
            <aside className="map-panel">
              <button className="panel-close" onClick={() => setShowPanel(false)} aria-label="Close map summary">×</button>
              <span className="mini-label">REAL COMMUNITY DATA</span>
              <h3>Connection snapshot</h3>
              <div className="average"><strong>{averageSpeed.toFixed(1)}</strong><span>Mbps average</span></div>
              <div className="bar-chart" aria-label="Connection speed distribution">
                {chartTests.map((test) => <i key={test.id} style={{ height: `${Math.max(8, Number(test.download_mbps) / chartMax * 100)}%` }} />)}
              </div>
              <div className="panel-footer"><span><b>Last speed test</b>{lastCommunityTest ? new Date(lastCommunityTest.updated_at).toLocaleString() : ''}</span><strong>{fastestTest ? `${Number(fastestTest.download_mbps).toFixed(1)} Mbps best` : '—'}</strong></div>
            </aside>
          )}
        </div>
      </section>

      <section className="how-section" id="about">
        <span className="eyebrow">BUILT FOR BETTER CONNECTIONS</span>
        <h2>One test makes the map smarter.</h2>
        <div className="steps">
          <div><b>01</b><LocateFixed /><h3>Share your location</h3><p>Your browser provides the coordinates used to place the measurement accurately on the map.</p></div>
          <div><b>02</b><Activity /><h3>Run a quick test</h3><p>We estimate download speed, upload speed, and latency in under a minute.</p></div>
          <div><b>03</b><MapPin /><h3>Help your community</h3><p>Your anonymized result joins the map, helping everyone choose better connectivity.</p></div>
        </div>
      </section>

      {showHistory && <div className="modal-backdrop" onClick={() => setShowHistory(false)}><aside className="history-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-heading"><div><span className="eyebrow">ON THIS DEVICE</span><h2>Your test history</h2></div><button onClick={() => setShowHistory(false)} aria-label="Close history"><X /></button></div>
        {history.length ? <div className="history-list">{history.map((item) => <article key={item.id}><div><strong>{item.download.toFixed(1)} <small>Mbps</small></strong><span>{item.location} · {item.isp}</span></div><div><b>{item.upload.toFixed(1)} up</b><b>{item.ping} ms</b><time>{new Date(item.testedAt).toLocaleDateString()}</time></div></article>)}</div> : <p className="empty-history">Your completed tests will appear here.</p>}
        {history.length > 0 && <button className="clear-history" onClick={() => { localStorage.removeItem('is-map-history'); setHistory([]) }}>Clear local history</button>}
      </aside></div>}

      <footer><div className="brand"><img src="/logo.png" alt="IS Map Logo" className="brand-logo-img" /><span>IS Map</span></div><p>Community-powered connectivity insights.</p><span>© 2026 IS Map</span></footer>
      <Analytics />
    </main>
  )
}

export default App
