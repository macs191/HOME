import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import type { GeoPoint } from '../lib/geo'

type SearchResult = { display_name: string; lat: string; lon: string; address?: { city?: string; town?: string; village?: string; suburb?: string; neighbourhood?: string } }
type Props = { value?: GeoPoint; onChange: (value: { point: GeoPoint; address: string; district?: string; city?: string }) => void }

const defaultPoint: GeoPoint = { latitude: 24.7136, longitude: 46.6753 }
let googleLoader: Promise<any> | null = null

function loadGooglePlaces(key: string) {
  if (googleLoader) return googleLoader
  googleLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-google-places]') as HTMLScriptElement | null
    if (existing) { existing.addEventListener('load', () => resolve((window as any).google)); existing.addEventListener('error', reject); return }
    const script = document.createElement('script')
    script.dataset.googlePlaces = 'true'
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=places&language=ar&region=SA`
    script.async = true; script.defer = true; script.onload = () => resolve((window as any).google); script.onerror = reject
    document.head.appendChild(script)
  })
  return googleLoader
}

export function MapPicker({ value, onChange }: Props) {
  const mapNode = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const markerRef = useRef<L.Marker | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [satellite, setSatellite] = useState(true)
  const googleKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return
    const initial = value ?? defaultPoint
    const map = L.map(mapNode.current, { zoomControl: true }).setView([initial.latitude, initial.longitude], value ? 15 : 11)
    const gibsDate = new Date().toISOString().slice(0, 10)
    const satelliteLayer = L.tileLayer(`https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${gibsDate}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`, { maxNativeZoom: 9, maxZoom: 19, attribution: 'NASA GIBS — imagery provided by NASA' })
    const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' })
    satelliteLayer.addTo(map)
    const marker = L.marker([initial.latitude, initial.longitude], { draggable: true, icon: L.divIcon({ className: 'map-marker', html: '<span></span>', iconSize: [24, 24], iconAnchor: [12, 12] }) }).addTo(map)
    marker.on('dragend', () => { const point = marker.getLatLng(); onChange({ point: { latitude: point.lat, longitude: point.lng }, address: 'نقطة حددها المستخدم على الخريطة' }) })
    map.on('click', (event: L.LeafletMouseEvent) => { marker.setLatLng(event.latlng); onChange({ point: { latitude: event.latlng.lat, longitude: event.latlng.lng }, address: 'نقطة حددها المستخدم على الخريطة' }) })
    mapRef.current = map; markerRef.current = marker
    ;(map as any).__satellite = satelliteLayer; (map as any).__street = streetLayer
    return () => { map.remove(); mapRef.current = null; markerRef.current = null }
  }, [])

  useEffect(() => { if (!mapRef.current || !value || !markerRef.current) return; const point: L.LatLngExpression = [value.latitude, value.longitude]; markerRef.current.setLatLng(point); mapRef.current.setView(point, Math.max(mapRef.current.getZoom(), 14)) }, [value])

  const selectResult = (result: SearchResult) => {
    const point = { latitude: Number(result.lat), longitude: Number(result.lon) }
    setQuery(result.display_name); setResults([]); mapRef.current?.setView([point.latitude, point.longitude], 16); markerRef.current?.setLatLng([point.latitude, point.longitude])
    onChange({ point, address: result.display_name, district: result.address?.suburb ?? result.address?.neighbourhood, city: result.address?.city ?? result.address?.town ?? result.address?.village })
  }

  const search = async () => {
    const term = query.trim(); if (!term) return
    setSearching(true)
    try {
      if (googleKey) {
        const google = await loadGooglePlaces(googleKey)
        const service = new google.maps.places.AutocompleteService()
        const predictions = await new Promise<any[]>((resolve) => service.getPlacePredictions({ input: term, componentRestrictions: { country: 'sa' }, language: 'ar' }, (items: any[]) => resolve(items ?? [])))
        setResults(predictions.map((item) => ({ display_name: item.description, lat: '0', lon: '0', google_place_id: item.place_id } as SearchResult & { google_place_id: string })))
      } else {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ar&q=${encodeURIComponent(term)}`)
        setResults(await response.json())
      }
    } catch { setResults([]) } finally { setSearching(false) }
  }

  const chooseGoogle = async (result: SearchResult & { google_place_id?: string }) => {
    if (!result.google_place_id || !googleKey) return selectResult(result)
    try {
      const google = await loadGooglePlaces(googleKey)
      const service = new google.maps.places.PlacesService(document.createElement('div'))
      service.getDetails({ placeId: result.google_place_id, fields: ['geometry', 'formatted_address', 'address_components'], language: 'ar' }, (place: any, status: string) => {
        if (status !== 'OK' || !place?.geometry?.location) return
        const point = { latitude: place.geometry.location.lat(), longitude: place.geometry.location.lng() }
        setQuery(place.formatted_address ?? result.display_name); setResults([]); mapRef.current?.setView([point.latitude, point.longitude], 16); markerRef.current?.setLatLng([point.latitude, point.longitude]); onChange({ point, address: place.formatted_address ?? result.display_name })
      })
    } catch { selectResult(result) }
  }

  const toggleLayer = () => {
    const map = mapRef.current as (L.Map & { __satellite?: L.TileLayer; __street?: L.TileLayer }) | null
    if (!map) return
    if (satellite) { map.removeLayer(map.__satellite!); map.__street!.addTo(map) } else { map.removeLayer(map.__street!); map.__satellite!.addTo(map) }
    setSatellite((current) => !current)
  }

  return <div className="map-picker"><div className="map-search"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void search() } }} placeholder={googleKey ? 'ابحث في Google عن العنوان أو الحي' : 'ابحث عن العنوان (بحث مجاني)'} /><button type="button" onClick={() => void search()} disabled={searching}>{searching ? '...' : 'بحث'}</button>{results.length > 0 && <div className="map-results">{results.map((result, index) => <button type="button" key={`${result.display_name}-${index}`} onClick={() => googleKey ? void chooseGoogle(result as SearchResult & { google_place_id?: string }) : selectResult(result)}>{result.display_name}<small>{googleKey ? 'Google Places' : 'OpenStreetMap'}</small></button>)}</div>}</div><div className="map-toolbar"><button type="button" className="filter-chip selected" onClick={toggleLayer}>{satellite ? 'عرض الطرق' : 'عرض القمر الصناعي'}</button><span>{googleKey ? 'بحث Google مفعل' : 'بحث مجاني عبر OpenStreetMap'}</span></div><div className="map-canvas" ref={mapNode} /><small className="map-attribution">صور الأقمار: NASA GIBS (دقة عامة) · الطرق: © OpenStreetMap contributors · البحث عبر OpenStreetMap Nominatim</small></div>
}
