import { MapContainer, Marker, Polygon, Popup, TileLayer } from "react-leaflet";
import type { H3Cell } from "../lib/h3";

const ACCENT = "#2F80ED";
const HIGHLIGHT = "#facc15";

type AddressMapPreviewProps = {
  center: [number, number];
  grid: H3Cell[];
  addressLabel?: string;
  /** Extra classes for the outer wrapper (height, rounding, etc.). */
  className?: string;
};

/**
 * Compact, read-only map preview of the owner's home address with the H3 hex
 * grid overlaid. Re-centers whenever `center` changes (the `key` forces Leaflet
 * to re-mount at the new coordinates).
 */
export default function AddressMapPreview({
  center,
  grid,
  addressLabel,
  className = "",
}: AddressMapPreviewProps) {
  const selectedId = grid[Math.floor(grid.length / 2)]?.id ?? grid[0]?.id ?? "";

  return (
    <div
      className={`relative isolate overflow-hidden rounded-xl border border-[#DCE6F2] bg-[#EDF3FB] ${className}`}
    >
      <MapContainer
        key={`${center[0].toFixed(4)}-${center[1].toFixed(4)}`}
        center={center}
        zoom={14}
        scrollWheelZoom={false}
        className="h-full w-full"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        <Marker position={center}>
          {addressLabel ? (
            <Popup>
              <div className="space-y-1 text-sm text-slate-900">
                <p className="font-semibold">Your address</p>
                <p>{addressLabel}</p>
              </div>
            </Popup>
          ) : null}
        </Marker>
        {grid.map((hex: H3Cell) => {
          const positions = hex.polygon.map(
            ([lng, lat]: [number, number]) => [lat, lng] as [number, number],
          );
          const isSelected = hex.id === selectedId;
          return (
            <Polygon
              key={hex.id}
              positions={positions}
              pathOptions={
                isSelected
                  ? {
                      color: HIGHLIGHT,
                      weight: 2,
                      dashArray: "8 6",
                      fillColor: ACCENT,
                      fillOpacity: 0.18,
                    }
                  : {
                      color: ACCENT,
                      weight: 1,
                      fillColor: ACCENT,
                      fillOpacity: 0.14,
                    }
              }
            />
          );
        })}
      </MapContainer>

      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-md border border-[#DCE6F2] bg-white/85 px-2.5 py-2 text-[11px] text-[#566784] backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: ACCENT }}
          />
          <span>H3 hexagonal cells</span>
        </div>
      </div>
    </div>
  );
}
