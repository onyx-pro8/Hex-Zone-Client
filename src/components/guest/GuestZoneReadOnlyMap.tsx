import { useEffect } from "react";
import L from "leaflet";
import { MapContainer, Polygon, TileLayer, useMap } from "react-leaflet";
import type { GuestDashboardMapView } from "../../lib/guestDashboardMap";

function FitToPolygons({ polygons }: Pick<GuestDashboardMapView, "polygons">) {
  const map = useMap();
  useEffect(() => {
    const flat = polygons.flat();
    if (flat.length === 0) return;
    const b = L.latLngBounds(flat);
    map.fitBounds(b.pad(0.12), { animate: false });
  }, [map, polygons]);
  return null;
}

/**
 * Minimal read-only leaflet view for guests (no zone editing controls).
 */
export default function GuestZoneReadOnlyMap({ center, polygons }: GuestDashboardMapView) {
  return (
    <div className="relative min-h-[360px] h-[min(360px,50vh)] w-full overflow-hidden rounded-xl border border-[#DCE6F2] bg-[#EDF3FB] lg:h-[min(calc(100dvh-12rem),720px)] lg:min-h-[min(calc(100dvh-12rem),720px)]">
      <MapContainer
        center={center}
        zoom={12}
        className="h-full w-full [&_.leaflet-control-attribution]:text-[10px]"
        dragging
        scrollWheelZoom
        doubleClickZoom
        attributionControl
      >
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; OSM &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />
        <FitToPolygons polygons={polygons} />
        {polygons.map((ring, idx) => (
          <Polygon
            key={`g-${idx}`}
            positions={ring}
            pathOptions={{
              color: "#2F80ED",
              weight: 2,
              fillColor: "#2F80ED",
              fillOpacity: 0.12,
              opacity: 0.92,
            }}
          />
        ))}
      </MapContainer>
    </div>
  );
}
