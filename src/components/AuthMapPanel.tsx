import { MapContainer, TileLayer, Polygon, Marker, Popup } from "react-leaflet";
import type { H3Cell } from "../lib/h3";

const ACCENT = "#2F80ED";
const HIGHLIGHT = "#facc15";

type AuthMapPanelProps = {
  center: [number, number];
  grid: H3Cell[];
  addressLabel?: string;
  className?: string;
};

export default function AuthMapPanel({
  center,
  grid,
  addressLabel,
  className = "",
}: AuthMapPanelProps) {
  const selectedId =
    grid[Math.floor(grid.length / 2)]?.id ?? grid[0]?.id ?? "";

  return (
    <div
      className={`relative min-h-[280px] w-full overflow-hidden bg-[#EDF3FB] lg:min-h-0 ${className}`}
    >
      <div className="pointer-events-none absolute left-6 top-6 z-[1000]">
        <p className="text-xl font-extrabold tracking-tight text-[#0F2C5C]">
          Safe <span className="text-[#2FA24A]">Zone</span> Patrol
        </p>
        <p className="mt-1 text-sm text-[#566784]">
          Neighbourhood Safety Network
        </p>
      </div>

      <MapContainer
        key={`${center[0].toFixed(4)}-${center[1].toFixed(4)}`}
        center={center}
        zoom={12}
        scrollWheelZoom
        className="h-full min-h-[280px] w-full lg:absolute lg:inset-0 lg:min-h-0"
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
        />
        <Marker position={center}>
          <Popup>
            <div className="space-y-1 text-sm text-slate-900">
              <p className="font-semibold">Location</p>
              {addressLabel ? <p>{addressLabel}</p> : null}
            </div>
          </Popup>
        </Marker>
        {grid.map((hex: H3Cell) => {
          const positions = hex.polygon.map(
            ([lng, lat]: [number, number]) => [lat, lng] as [number, number],
          );
          const isSelected = hex.id === selectedId;
          if (isSelected) {
            return (
              <Polygon
                key={hex.id}
                positions={positions}
                pathOptions={{
                  color: HIGHLIGHT,
                  weight: 2,
                  dashArray: "8 6",
                  fillColor: ACCENT,
                  fillOpacity: 0.18,
                }}
              />
            );
          }
          return (
            <Polygon
              key={hex.id}
              positions={positions}
              pathOptions={{
                color: ACCENT,
                weight: 1,
                fillColor: ACCENT,
                fillOpacity: 0.14,
              }}
            />
          );
        })}
      </MapContainer>

      <div className="pointer-events-none absolute bottom-6 left-6 z-[1000] rounded-md border border-[#DCE6F2] bg-white/85 px-3 py-2.5 text-xs text-[#566784] backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-sm"
            style={{ backgroundColor: ACCENT }}
          />
          <span>H3 Hexagonal Cells</span>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span
            className="h-3 w-3 shrink-0 rounded-sm border-2 border-dashed"
            style={{ borderColor: HIGHLIGHT }}
          />
          <span>Geo-fence Polygons</span>
        </div>
      </div>
    </div>
  );
}
