/* Leaflet is ~40 kB gzip; load it only when a map is actually on screen. */
import { lazy, Suspense } from 'react'
import type { MapViewProps } from './MapView'

const Inner = lazy(() => import('./MapView'))

export default function LazyMap(props: MapViewProps) {
  return (
    <Suspense fallback={<div className="map-wrap skel" style={props.height ? { height: props.height } : undefined} aria-busy="true" />}>
      <Inner {...props} />
    </Suspense>
  )
}
// MapFabs: import from './MapView' only inside lazily-loaded routes (it pulls in Leaflet).
