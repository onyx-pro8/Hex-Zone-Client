import { useEffect, useLayoutEffect, useRef, useState } from "react";
import L from "leaflet";
import type { LatLngExpression } from "leaflet";
import {
  Circle,
  CircleMarker,
  MapContainer,
  Polygon,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvent,
} from "react-leaflet";
import { latLngToCell } from "h3-js";
import { h3ToPolygon } from "../lib/h3";
import type { GeoPolygonShape, LatLng } from "../lib/geoPoly";
import type { FitBoundsCorners } from "../lib/mapBounds";

export type MapInteractionMode = "h3" | "polygon" | "measure" | "none";

export type MapFitBoundsRequest = { key: number } & FitBoundsCorners;
export type SavedZoneCellLayer = {
  key: string;
  cells: string[];
  color: string;
  fillOpacity: number;
  weight: number;
};
export type SavedZonePolygonLayer = {
  key: string;
  polygons: GeoPolygonShape[];
  color: string;
  fillOpacity: number;
  weight: number;
};

type HexMapperMapProps = {
  center: [number, number];
  /** When key changes, map animates to fit these corners (from sidebar list focus). */
  mapFitBounds: MapFitBoundsRequest | null;
  /** H3 */
  resolution: number;
  selectedCells: string[];
  savedZoneCellLayers: SavedZoneCellLayer[];
  savedZonePolygonLayers: SavedZonePolygonLayer[];
  helperCircles?: Array<{
    key: string;
    center: [number, number];
    radiusMeters: number;
    color: string;
    fillOpacity?: number;
    dashArray?: string;
  }>;
  h3Color: string;
  h3FillOpacity: number;
  /** Polygons */
  polygons: GeoPolygonShape[];
  polygonColor: string;
  polygonFillOpacity: number;
  draftRing: LatLng[];
  draftLineColor: string;
  /** Measurement */
  measureA: LatLng | null;
  measureB: LatLng | null;
  measurePreview: LatLng | null;
  measureColor: string;
  /** Basemap */
  grayscale: boolean;
  /** Interaction */
  interactionMode: MapInteractionMode;
  drawingActive: boolean;
  onMapClick: (lat: number, lng: number) => void;
  onMapMouseMove: (lat: number, lng: number) => void;
  onContextMenu: (lat: number, lng: number, clientX: number, clientY: number) => void;
  onCursorCoords?: (lat: number, lng: number) => void;
  interactive: boolean;
};

function MapRecenter({ center }: { center: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize({ animate: false });
    map.setView(center, Math.max(map.getZoom(), 11), { animate: true });
  }, [center[0], center[1], map]);
  return null;
}

/**
 * Leaflet caches pixel size; flex sidebars / late layout leave the wrong size until invalidateSize.
 * Observe container + parent so fitBounds / setView use the real viewport.
 */
function MapInvalidateOnResize() {
  const map = useMap();
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => {
      mapRef.current.invalidateSize({ animate: false });
    });
    ro.observe(el);
    const parent = el.parentElement;
    if (parent) ro.observe(parent);
    return () => ro.disconnect();
  }, [map]);

  return null;
}

function MapFitBounds({ request }: { request: MapFitBoundsRequest | null }) {
  const map = useMap();

  useLayoutEffect(() => {
    if (!request) return;
    const { southWest, northEast } = request;

    const apply = () => {
      map.invalidateSize({ animate: false });
      const b = L.latLngBounds(southWest, northEast);
      if (!b.isValid()) return;
      map.fitBounds(b, { padding: [24, 24], maxZoom: 19, animate: true });
    };

    apply();
    let id2 = 0;
    const id1 = requestAnimationFrame(() => {
      id2 = requestAnimationFrame(apply);
    });
    return () => {
      cancelAnimationFrame(id1);
      cancelAnimationFrame(id2);
    };
  }, [request, map]);
  return null;
}

function MapInteractionBridge({
  interactionMode,
  drawingActive,
  onMapClick,
  onMapMouseMove,
  onContextMenu,
  interactive,
}: Pick<
  HexMapperMapProps,
  | "interactionMode"
  | "drawingActive"
  | "onMapClick"
  | "onMapMouseMove"
  | "onContextMenu"
  | "interactive"
>) {
  useMapEvent("click", (e) => {
    if (!interactive) return;
    if (interactionMode === "none") return;
    const { lat, lng } = e.latlng;
    onMapClick(lat, lng);
  });

  useMapEvent("mousemove", (e) => {
    const { lat, lng } = e.latlng;
    onMapMouseMove(lat, lng);
  });

  useMapEvent("contextmenu", (e) => {
    if (!interactive) return;
    e.originalEvent.preventDefault();
    const { lat, lng } = e.latlng;
    const { clientX, clientY } = e.originalEvent;
    onContextMenu(lat, lng, clientX, clientY);
  });

  return null;
}

export default function HexMapperMap({
  center,
  mapFitBounds,
  resolution,
  selectedCells,
  savedZoneCellLayers,
  savedZonePolygonLayers,
  helperCircles = [],
  h3Color,
  h3FillOpacity,
  polygons,
  polygonColor,
  polygonFillOpacity,
  draftRing,
  draftLineColor,
  measureA,
  measureB,
  measurePreview,
  measureColor,
  grayscale,
  interactionMode,
  drawingActive,
  onMapClick,
  onMapMouseMove,
  onContextMenu,
  onCursorCoords,
  interactive,
}: HexMapperMapProps) {
  const [useFallbackTiles, setUseFallbackTiles] = useState(false);

  useEffect(() => {
    // Reset fallback when base style changes.
    setUseFallbackTiles(false);
  }, [grayscale]);

  const primaryTileUrl = grayscale
    ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
    : "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

  const fallbackTileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileUrl = useFallbackTiles ? fallbackTileUrl : primaryTileUrl;

  const attribution = useFallbackTiles
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    : grayscale
    ? "Tiles &copy; Esri"
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

  return (
    <div className="h-full min-h-[320px] w-full overflow-hidden [&_.leaflet-container]:bg-[#1a1a1a]">
      <MapContainer
        center={center}
        zoom={12}
        scrollWheelZoom
        className="h-full w-full"
      >
        <MapInvalidateOnResize />
        <MapRecenter center={center} />
        <MapFitBounds request={mapFitBounds} />
        <TileLayer
          attribution={attribution}
          url={tileUrl}
          eventHandlers={{
            tileerror: () => {
              setUseFallbackTiles(true);
            },
          }}
        />
        {savedZoneCellLayers.flatMap((layer) =>
          layer.cells.map((cellId) => {
            let ring: [number, number][];
            try {
              ring = h3ToPolygon(cellId);
            } catch {
              return null;
            }
            const positions = ring.map(
              ([lng, lat]) => [lat, lng] as [number, number],
            );
            return (
              <Polygon
                key={`${layer.key}:${cellId}`}
                positions={positions}
                pathOptions={{
                  color: layer.color,
                  weight: layer.weight,
                  fillColor: layer.color,
                  fillOpacity: layer.fillOpacity,
                }}
              />
            );
          }),
        )}
        {selectedCells.map((cellId) => {
          let ring: [number, number][];
          try {
            ring = h3ToPolygon(cellId);
          } catch {
            return null;
          }
          const positions = ring.map(
            ([lng, lat]) => [lat, lng] as [number, number],
          );
          return (
            <Polygon
              key={cellId}
              positions={positions}
              pathOptions={{
                color: h3Color,
                weight: 2,
                fillColor: h3Color,
                fillOpacity: h3FillOpacity,
              }}
            />
          );
        })}

        {savedZonePolygonLayers.flatMap((layer) =>
          layer.polygons.map((p) => {
            const rings = [p.outer, ...p.holes].filter((r) => r.length >= 3);
            if (rings.length === 0) return null;
            const positionRings = rings.map((ring) =>
              ring.map(([lat, lng]) => [lat, lng] as [number, number]),
            );
            return (
              <Polygon
                key={`${layer.key}:${p.id}`}
                positions={positionRings as LatLngExpression[][]}
                pathOptions={{
                  color: layer.color,
                  weight: layer.weight,
                  fillColor: layer.color,
                  fillOpacity: layer.fillOpacity,
                }}
              />
            );
          }),
        )}

        {helperCircles.map((circle) => (
          <Circle
            key={circle.key}
            center={circle.center}
            radius={circle.radiusMeters}
            pathOptions={{
              color: circle.color,
              weight: 2,
              fillColor: circle.color,
              fillOpacity: circle.fillOpacity ?? 0.12,
              dashArray: circle.dashArray,
            }}
          />
        ))}

        {polygons.map((p) => {
          const rings = [p.outer, ...p.holes].filter((r) => r.length >= 3);
          if (rings.length === 0) return null;
          const positionRings = rings.map((ring) =>
            ring.map(([lat, lng]) => [lat, lng] as [number, number]),
          );
          return (
            <Polygon
              key={p.id}
              positions={positionRings as LatLngExpression[][]}
              pathOptions={{
                color: polygonColor,
                weight: 2,
                fillColor: polygonColor,
                fillOpacity: polygonFillOpacity,
              }}
            />
          );
        })}

        {draftRing.length > 0 && (
          <>
            <Polyline
              positions={draftRing.map(([lat, lng]) => [lat, lng] as [number, number])}
              pathOptions={{
                color: draftLineColor,
                weight: 2,
                dashArray: "6 8",
              }}
            />
            {draftRing.map(([lat, lng], i) => (
              <CircleMarker
                key={`d-${i}-${lat}-${lng}`}
                center={[lat, lng]}
                radius={i === 0 ? 8 : 5}
                pathOptions={{ color: draftLineColor, fillColor: "#0B0E11", weight: 2 }}
              />
            ))}
            {drawingActive && interactionMode === "polygon" && draftRing.length >= 3 && (
              <CircleMarker
                center={[draftRing[0][0], draftRing[0][1]]}
                radius={14}
                bubblingMouseEvents={false}
                pathOptions={{
                  color: draftLineColor,
                  fillColor: draftLineColor,
                  fillOpacity: 0.32,
                  weight: 2,
                }}
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e.originalEvent);
                    e.originalEvent.stopImmediatePropagation?.();
                    e.originalEvent.preventDefault();
                    e.originalEvent.stopPropagation();
                    const [lat, lng] = draftRing[0];
                    onMapClick(lat, lng);
                  },
                }}
              >
                <Tooltip direction="top" offset={[0, -8]} opacity={1}>
                  Click to close polygon
                </Tooltip>
              </CircleMarker>
            )}
          </>
        )}

        {measureA && (
          <CircleMarker
            center={[measureA[0], measureA[1]]}
            radius={6}
            pathOptions={{ color: measureColor, fillColor: measureColor }}
          />
        )}
        {measureB && (
          <CircleMarker
            center={[measureB[0], measureB[1]]}
            radius={6}
            pathOptions={{ color: measureColor, fillColor: measureColor }}
          />
        )}
        {measureA && measurePreview && !measureB && (
          <Polyline
            positions={[
              [measureA[0], measureA[1]],
              [measurePreview[0], measurePreview[1]],
            ]}
            pathOptions={{
              color: measureColor,
              weight: 2,
              dashArray: "8 6",
            }}
          />
        )}
        {measureA && measureB && (
          <Polyline
            positions={[
              [measureA[0], measureA[1]],
              [measureB[0], measureB[1]],
            ]}
            pathOptions={{
              color: measureColor,
              weight: 3,
              dashArray: "10 6",
            }}
          >
          </Polyline>
        )}

        <MapInteractionBridge
          interactionMode={interactionMode}
          drawingActive={drawingActive}
          onMapClick={onMapClick}
          onMapMouseMove={(lat, lng) => {
            onMapMouseMove(lat, lng);
            onCursorCoords?.(lat, lng);
          }}
          onContextMenu={onContextMenu}
          interactive={interactive}
        />
      </MapContainer>
    </div>
  );
}

/** H3 cell ids at point for resolutions 0–15 (for context menu) */
export function h3CellsAtPoint(lat: number, lng: number): { res: number; id: string }[] {
  const out: { res: number; id: string }[] = [];
  for (let r = 0; r <= 15; r += 1) {
    try {
      const id = latLngToCell(lat, lng, r) as string;
      out.push({ res: r, id });
    } catch {
      /* skip invalid */
    }
  }
  return out;
}
