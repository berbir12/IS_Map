import { useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import { Activity, ChevronDown, Clock3, Download, LocateFixed, MapPin, MoreHorizontal, Radio, ShieldCheck, Upload, Wifi } from 'lucide-react'
import { isSupabaseConfigured, loadCommunityTests, saveCommunityTest, supabase, type CommunityTest } from './lib/supabase'
import 'leaflet/dist/leaflet.css'
import './App.css'

type Stage = 'idle' | 'locating' | 'testing' | 'complete' | 'error'
type TestResult = { download: number; upload: number; ping: number }

type SpeedPoint = {
  name: string
  region: string
  coords: [number, number]
  speed: number
  type: string
}

const seedPoints: SpeedPoint[] = [
  { name: 'Westlands', region: 'Nairobi', coords: [-1.2674, 36.8108], speed: 118, type: 'Fiber' },
  { name: 'Kilimani', region: 'Nairobi', coords: [-1.2921, 36.7839], speed: 84, type: '5G' },
  { name: 'Lavington', region: 'Nairobi', coords: [-1.2824, 36.7696], speed: 96, type: 'Fiber' },
  { name: 'Kasarani', region: 'Nairobi', coords: [-1.2184, 36.8966], speed: 42, type: '4G' },
  { name: 'Ruaka', region: 'Kiambu', coords: [-1.2064, 36.7773], speed: 63, type: '5G' },
  { name: 'Embakasi', region: 'Nairobi', coords: [-1.3158, 36.8971], speed: 29, type: '4G' },
  { name: 'Karen', region: 'Nairobi', coords: [-1.3197, 36.7073], speed: 72, type: 'Fiber' },
  { name: 'Ruiru', region: 'Kiambu', coords: [-1.1482, 36.9608], speed: 37, type: '4G' },
]

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
  const [location, setLocation] = useState<[number, number]>([-1.2864, 36.8172])
  const [locationName, setLocationName] = useState('Detect location')
  const [showPanel, setShowPanel] = useState(true)
  const [result, setResult] = useState<TestResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [communityTests, setCommunityTests] = useState<CommunityTest[]>([])
  const [syncState, setSyncState] = useState<'offline' | 'loading' | 'live' | 'error'>(isSupabaseConfigured ? 'loading' : 'offline')

  const points = useMemo(() => {
    const sharedPoints: SpeedPoint[] = communityTests.map((test) => ({
      name: 'Community test',
      region: new Date(test.created_at).toLocaleDateString(),
      coords: [test.latitude, test.longitude],
      speed: Number(test.download_mbps),
      type: test.connection_type || 'Internet',
    }))
    const basePoints = sharedPoints.length ? sharedPoints : seedPoints
    return stage === 'complete'
      ? [{ name: 'Your result', region: locationName, coords: location, speed: result?.download ?? 0, type: 'Current test' }, ...basePoints]
      : basePoints
  }, [stage, location, locationName, result, communityTests])

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
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'speed_tests' }, (payload) => {
        setCommunityTests((current) => [payload.new as CommunityTest, ...current].slice(0, 1000))
      })
      .subscribe()

    return () => {
      active = false
      void client.removeChannel(channel)
    }
  }, [])

  const requestLocation = () => new Promise<void>((resolve) => {
    setStage('locating')
    if (!navigator.geolocation) {
      setLocationName('Location unavailable')
      setStage('idle')
      resolve()
      return
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation([coords.latitude, coords.longitude])
        setLocationName(`${coords.latitude.toFixed(3)}, ${coords.longitude.toFixed(3)}`)
        setStage('idle')
        resolve()
      },
      () => {
        setLocationName('Location unavailable')
        setStage('idle')
        resolve()
      },
      { enableHighAccuracy: false, timeout: 5000 },
    )
  })

  const detectLocation = async () => {
    await requestLocation()
    setShowPanel(true)
  }

  const beginTest = async () => {
    setResult(null)
    setErrorMessage('')
    setProgress(0)
    if (locationName === 'Detect location' || locationName === 'Location unavailable') await requestLocation()
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
      if (supabase && locationName !== 'Location unavailable' && locationName !== 'Detect location') {
        try {
          const saved = await saveCommunityTest({
            latitude: Number(location[0].toFixed(2)),
            longitude: Number(location[1].toFixed(2)),
            download_mbps: nextResult.download,
            upload_mbps: nextResult.upload,
            ping_ms: nextResult.ping,
            connection_type: (navigator as Navigator & { connection?: { effectiveType?: string } }).connection?.effectiveType ?? null,
          })
          if (saved) setCommunityTests((current) => current.some((item) => item.id === saved.id) ? current : [saved, ...current])
          setSyncState('live')
        } catch {
          setSyncState('error')
        }
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
          <span className="brand-mark"><Radio size={21} /></span>
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
            <div className="results-row">
              <div><Download size={18} /><span>Download</span><strong>{result.download.toFixed(1)} <small>Mbps</small></strong></div>
              <div><Upload size={18} /><span>Upload</span><strong>{result.upload.toFixed(1)} <small>Mbps</small></strong></div>
              <div><Clock3 size={18} /><span>Ping</span><strong>{result.ping} <small>ms</small></strong></div>
            </div>
          ) : <p className={`test-note ${stage === 'error' ? 'error-note' : ''}`}>{stage === 'error' ? errorMessage : stage === 'idle' ? 'We’ll ask for your location, then run a quick test.' : stage === 'locating' ? 'Allow location access in your browser to place your result.' : 'Measuring download, upload, and response time…'}</p>}

          <button className="primary-button" onClick={beginTest} disabled={stage === 'locating' || stage === 'testing'}>
            {stage === 'idle' ? 'Start speed test' : stage === 'complete' || stage === 'error' ? 'Test again' : stage === 'locating' ? 'Locating…' : `Testing… ${progress}%`}
          </button>
          <p className="fine-print">No signup required · Location is rounded before it is shared</p>
        </div>
      </section>

      <section className="map-section" id="map">
        <div className="section-heading">
          <div><span className="eyebrow">COMMUNITY COVERAGE</span><h2>Explore speeds near you</h2><p>Each dot is a real-world connection test shared by the community.</p></div>
          <div className="map-stat">
            <strong>{communityTests.length ? communityTests.length.toLocaleString() : 'Sample'}</strong>
            <span>{communityTests.length ? 'shared tests loaded' : 'coverage data'}</span>
            <small className={`sync-badge sync-${syncState}`}><i />{syncState === 'live' ? 'Live database' : syncState === 'loading' ? 'Connecting' : syncState === 'error' ? 'Sync unavailable' : 'Demo mode'}</small>
          </div>
        </div>

        <div className="map-frame">
          <MapContainer center={location} zoom={11} scrollWheelZoom className="map" zoomControl>
            <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <MapFocus coords={location} />
            {points.map((point, index) => (
              <CircleMarker key={`${point.name}-${index}`} center={point.coords} radius={point.name === 'Your result' ? 13 : 9} pathOptions={{ color: '#fffdf7', weight: 3, fillColor: colorFor(point.speed), fillOpacity: 1 }}>
                <Popup><div className="map-popup"><b>{point.name}</b><span>{point.region}</span><strong>{point.speed} Mbps</strong><small>{point.type}</small></div></Popup>
              </CircleMarker>
            ))}
          </MapContainer>

          <div className="legend"><span><i className="fast" /> 90+ Mbps</span><span><i className="medium" /> 50–89</span><span><i className="slow" /> Under 50</span></div>
          <button className="map-menu" aria-label="Map options"><MoreHorizontal size={20} /></button>

          {showPanel && (
            <aside className="map-panel">
              <button className="panel-close" onClick={() => setShowPanel(false)} aria-label="Close map summary">×</button>
              <span className="mini-label">{locationName === 'Detect location' ? 'SAMPLE COVERAGE: NAIROBI' : `NEAR ${locationName.toUpperCase()}`}</span>
              <h3>Connection snapshot</h3>
              <div className="average"><strong>71.2</strong><span>Mbps average</span></div>
              <div className="bar-chart" aria-label="Connection speed distribution">
                {[34, 56, 48, 72, 63, 84, 51, 76, 91, 69, 88, 58].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
              </div>
              <div className="panel-footer"><span><b>Fastest area</b> Westlands</span><strong>118 Mbps</strong></div>
            </aside>
          )}
        </div>
      </section>

      <section className="how-section" id="about">
        <span className="eyebrow">BUILT FOR BETTER CONNECTIONS</span>
        <h2>One test makes the map smarter.</h2>
        <div className="steps">
          <div><b>01</b><LocateFixed /><h3>Share your area</h3><p>Your browser finds your approximate location. We never store your exact address.</p></div>
          <div><b>02</b><Activity /><h3>Run a quick test</h3><p>We estimate download speed, upload speed, and latency in under a minute.</p></div>
          <div><b>03</b><MapPin /><h3>Help your community</h3><p>Your anonymized result joins the map, helping everyone choose better connectivity.</p></div>
        </div>
      </section>

      <footer><div className="brand"><span className="brand-mark"><Radio size={18} /></span><span>IS Map</span></div><p>Community-powered connectivity insights.</p><span>© 2026 IS Map</span></footer>
    </main>
  )
}

export default App
