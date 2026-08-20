import { useEffect } from 'react'
import { BadgeCheck, Flag, Layers, Radio } from 'lucide-react'
import { CircleMarker, MapContainer, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet.heat'
import 'leaflet/dist/leaflet.css'
import type { CommunityTest, MapBounds } from '../lib/supabase'

export type SpeedPoint = {
  id?: string; name: string; region: string; coords: [number, number]; speed: number; type: string
  lastTest?: string; sampleCount?: number; isVerified?: boolean; flagCount?: number; contributorAlias?: string | null
}

type Props = {
  points: SpeedPoint[]; focus: [number, number] | null; showHeatmap: boolean; setShowHeatmap: (value: boolean) => void
  setBounds: (bounds: MapBounds) => void; flaggedTests: Set<string>; onFlag: (id: string) => void
  t: (key: string) => string; tests: CommunityTest[]; loading: boolean; showPanel: boolean; closePanel: () => void
  regionalStats: { count: number; avgDown: number; topIsp: string | null } | null; searchQuery: string
  averageSpeed: number; chartTests: CommunityTest[]; chartMax: number; lastTest: CommunityTest | null; fastestTest: CommunityTest | null
}

function colorFor(speed: number) { return speed >= 90 ? '#33a566' : speed >= 50 ? '#f2a541' : '#ef6a5b' }

function MapFocus({ coords }: { coords: [number, number] }) {
  const map = useMap()
  useEffect(() => { map.flyTo(coords, 12, { duration: 1.2 }) }, [coords, map])
  return null
}

function MapViewport({ onChange }: { onChange: (bounds: MapBounds) => void }) {
  const map = useMap()
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const report = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        const bounds = map.getBounds()
        onChange({ north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest() })
      }, 250)
    }
    report(); map.on('moveend zoomend', report)
    return () => { clearTimeout(timer); map.off('moveend zoomend', report) }
  }, [map, onChange])
  return null
}

function HeatmapLayer({ points }: { points: SpeedPoint[] }) {
  const map = useMap()
  useEffect(() => {
    if (!points.length) return
    const data = points.map((point) => [point.coords[0], point.coords[1], Math.min(point.speed / 150, 1)] as [number, number, number])
    const layer = (L as typeof L & { heatLayer: (data: [number, number, number][], options: Record<string, unknown>) => L.Layer }).heatLayer(data, {
      radius: 25, blur: 15, maxZoom: 17, max: 1,
      gradient: { 0.3: '#ef6a5b', 0.6: '#f2a541', 0.85: '#33a566', 1: '#1a7a45' },
    }).addTo(map)
    return () => { map.removeLayer(layer) }
  }, [map, points])
  return null
}

export default function CommunityMap(props: Props) {
  return <div className="map-frame">
    <MapContainer center={[0, 20]} zoom={3} scrollWheelZoom className="map" zoomControl>
      <MapViewport onChange={props.setBounds} />
      <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      {props.focus && <MapFocus coords={props.focus} />}
      {props.showHeatmap ? <HeatmapLayer points={props.points} /> : props.points.map((point, index) =>
        <CircleMarker key={`${point.name}-${point.coords.join('-')}-${index}`} center={point.coords} radius={point.name === 'Your result' ? 12 : 9} pathOptions={{ color: '#fffdf7', weight: 3, fillColor: colorFor(point.speed), fillOpacity: 1 }}>
          <Popup><div className="map-popup">
            <b>{point.name}{point.isVerified && <span className="verified-badge"><BadgeCheck size={12} /> {props.t('verified')}</span>}</b>
            <span>{point.region}</span>{point.contributorAlias && <small className="alias-tag">by {point.contributorAlias}</small>}
            <strong>{point.speed.toFixed(1)} Mbps</strong><small>{point.type}</small>
            {point.lastTest && <time>Last tested {new Date(point.lastTest).toLocaleString()}</time>}
            {point.sampleCount && point.sampleCount > 1 && <em>{point.sampleCount} tests averaged</em>}
            {point.id && point.name !== 'Your result' && <button className="flag-btn" onClick={(event) => { event.stopPropagation(); props.onFlag(point.id!) }} disabled={props.flaggedTests.has(point.id)}><Flag size={11} /> {props.flaggedTests.has(point.id) ? props.t('flagged') : props.t('flag')} {point.flagCount ? `(${point.flagCount})` : ''}</button>}
          </div></Popup>
        </CircleMarker>)}
    </MapContainer>
    <div className="legend"><span><i className="fast" /> 90+ Mbps</span><span><i className="medium" /> 50–89</span><span><i className="slow" /> Under 50</span><button className="layer-toggle" onClick={() => props.setShowHeatmap(!props.showHeatmap)}><Layers size={13} /> {props.showHeatmap ? props.t('map.dots') : props.t('map.heatmap')}</button></div>
    {!props.tests.length && !props.loading && <div className="empty-map-state"><Radio size={24} /><strong>{props.t('map.emptyTitle')}</strong><span>{props.t('map.emptySubtitle')}</span></div>}
    {props.showPanel && props.tests.length > 0 && <aside className="map-panel">
      <button className="panel-close" onClick={props.closePanel} aria-label="Close map summary">×</button>
      <span className="mini-label">{props.regionalStats ? props.t('panel.regional') : props.t('panel.eyebrow')}</span>
      <h3>{props.regionalStats ? props.searchQuery : props.t('panel.title')}</h3>
      <div className="average"><strong>{(props.regionalStats?.avgDown ?? props.averageSpeed).toFixed(1)}</strong><span>{props.t('panel.avgLabel')}</span></div>
      {props.regionalStats ? <div className="regional-info"><span>{props.regionalStats.count} tests in this area</span>{props.regionalStats.topIsp && <span>Top ISP: {props.regionalStats.topIsp}</span>}</div> : <div className="bar-chart">{props.chartTests.map((test) => <i key={test.id} style={{ height: `${Math.max(8, Number(test.download_mbps) / props.chartMax * 100)}%` }} />)}</div>}
      <div className="panel-footer"><span><b>{props.regionalStats ? 'Tests' : props.t('panel.lastTest')}</b>{props.regionalStats ? `${props.regionalStats.count} total` : props.lastTest ? new Date(props.lastTest.updated_at).toLocaleString() : ''}</span><strong>{props.regionalStats ? `${props.regionalStats.avgDown.toFixed(1)} ${props.t('panel.avgLabel')}` : props.fastestTest ? `${Number(props.fastestTest.download_mbps).toFixed(1)} ${props.t('panel.best')}` : '—'}</strong></div>
    </aside>}
  </div>
}
