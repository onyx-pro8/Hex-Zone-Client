import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
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

export type MapInteractionMode = "h3" | "polygon" | "measure" | "place" | "none";

export type MapFitBoundsRequest = { key: number } & FitBoundsCorners;
export type ZoneMapTooltip = {
  name: string;
  typeLabel: string;
  creatorLabel: string;
};

export type SavedZoneCellLayer = {
  key: string;
  cells: string[];
  color: string;
  fillOpacity: number;
  weight: number;
  tooltip?: ZoneMapTooltip;
};
export type SavedZonePolygonLayer = {
  key: string;
  polygons: GeoPolygonShape[];
  color: string;
  fillOpacity: number;
  weight: number;
  tooltip?: ZoneMapTooltip;
};

function ZoneMapTooltipContent({ tooltip }: { tooltip: ZoneMapTooltip }) {
  return (
    <div style={{ fontSize: 12, lineHeight: 1.45, color: "#0F2C5C" }}>
      <div style={{ fontWeight: 700, marginBottom: 2 }}>{tooltip.name}</div>
      <div>Type: {tooltip.typeLabel}</div>
      <div>Creator: {tooltip.creatorLabel}</div>
    </div>
  );
}

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
    tooltip?: ZoneMapTooltip;
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
  selectedPolygonId?: string | null;
  onVertexMove?: (
    polygonId: string,
    vertexIndex: number,
    lat: number,
    lng: number,
  ) => void;
  onVertexDelete?: (polygonId: string, vertexIndex: number) => void;
  onEdgeVertexAdd?: (
    polygonId: string,
    segmentIndex: number,
    lat: number,
    lng: number,
  ) => void;
  onPolygonDelete?: (polygonId: string) => void;
  circleDraft?: { center: LatLng; radiusMeters: number } | null;
  onMapClick: (lat: number, lng: number) => void;
  onMapMouseMove: (lat: number, lng: number) => void;
  onContextMenu: (lat: number, lng: number, clientX: number, clientY: number) => void;
  onCursorCoords?: (lat: number, lng: number) => void;
  interactive: boolean;
  /** When true, saved layers do not capture clicks (pin / place source on map). */
  passMapClicks?: boolean;
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
  suppressMapClickRef,
}: Pick<
  HexMapperMapProps,
  | "interactionMode"
  | "drawingActive"
  | "onMapClick"
  | "onMapMouseMove"
  | "onContextMenu"
  | "interactive"
> & {
  suppressMapClickRef: MutableRefObject<boolean>;
}) {
  useMapEvent("click", (e) => {
    if (!interactive) return;
    if (interactionMode === "none") return;
    // "place" forwards map clicks for proximity / object source picking.
    if (suppressMapClickRef.current) {
      suppressMapClickRef.current = false;
      return;
    }
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

const VERTEX_HANDLE_RADIUS = 9;
const LONG_PRESS_MS = 650;
const DRAG_THRESHOLD_PX = 6;
const EDGE_HIT_WEIGHT = 14;

function createPointerHandler({
  map,
  suppressMapClickRef,
  draggable,
  onLongPress,
  onDragMove,
  onDragEnd,
}: {
  map: L.Map;
  suppressMapClickRef: MutableRefObject<boolean>;
  draggable: boolean;
  onLongPress: () => void;
  onDragMove: (lat: number, lng: number) => void;
  onDragEnd: () => void;
}) {
  const latLngFromClientPoint = (clientX: number, clientY: number) => {
    const rect = map.getContainer().getBoundingClientRect();
    return map.containerPointToLatLng(
      L.point(clientX - rect.left, clientY - rect.top),
    );
  };

  return (e: L.LeafletMouseEvent) => {
    L.DomEvent.stop(e);
    const startX =
      "clientX" in e.originalEvent ? e.originalEvent.clientX : 0;
    const startY =
      "clientY" in e.originalEvent ? e.originalEvent.clientY : 0;
    let dragging = false;
    let longPressTimer: number | null = window.setTimeout(() => {
      if (!dragging) {
        onLongPress();
        suppressMapClickRef.current = true;
      }
      longPressTimer = null;
    }, LONG_PRESS_MS);

    const clearLongPress = () => {
      if (longPressTimer != null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    const onMove = (ev: MouseEvent | TouchEvent) => {
      const point =
        "touches" in ev ? ev.touches[0] : (ev as MouseEvent);
      if (!point) return;

      const dx = point.clientX - startX;
      const dy = point.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) >= DRAG_THRESHOLD_PX) {
        if (!draggable) {
          clearLongPress();
          onEnd();
          return;
        }
        dragging = true;
        clearLongPress();
        map.dragging.disable();
        map.getContainer().style.cursor = "grabbing";
      }
      if (!dragging) return;

      if ("touches" in ev) {
        ev.preventDefault();
      }
      const ll = latLngFromClientPoint(point.clientX, point.clientY);
      onDragMove(ll.lat, ll.lng);
    };

    const onEnd = () => {
      clearLongPress();
      if (dragging) {
        map.dragging.enable();
        map.getContainer().style.removeProperty("cursor");
        onDragEnd();
        suppressMapClickRef.current = true;
      }
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onEnd);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
  };
}

function PolygonVertexHandle({
  polygonId,
  vertexIndex,
  position,
  onMove,
  onDelete,
  suppressMapClickRef,
}: {
  polygonId: string;
  vertexIndex: number;
  position: LatLng;
  onMove: (polygonId: string, vertexIndex: number, lat: number, lng: number) => void;
  onDelete: (polygonId: string, vertexIndex: number) => void;
  suppressMapClickRef: MutableRefObject<boolean>;
}) {
  const map = useMap();
  const posRef = useRef<LatLng>(position);
  const [markerPos, setMarkerPos] = useState<LatLng>(position);

  useEffect(() => {
    posRef.current = markerPos;
  }, [markerPos]);

  useEffect(() => {
    setMarkerPos(position);
    posRef.current = position;
  }, [position[0], position[1]]);

  const onPointerDown = createPointerHandler({
    map,
    suppressMapClickRef,
    draggable: true,
    onLongPress: () => onDelete(polygonId, vertexIndex),
    onDragMove: (lat, lng) => {
      const next: LatLng = [lat, lng];
      setMarkerPos(next);
      posRef.current = next;
      onMove(polygonId, vertexIndex, lat, lng);
    },
    onDragEnd: () => {
      const [lat, lng] = posRef.current;
      onMove(polygonId, vertexIndex, lat, lng);
    },
  });

  return (
    <CircleMarker
      center={markerPos}
      radius={VERTEX_HANDLE_RADIUS}
      bubblingMouseEvents={false}
      pathOptions={{
        color: "#0B0E11",
        weight: 2,
        fillColor: "#2F80ED",
        fillOpacity: 1,
      }}
      eventHandlers={
        {
          mousedown: onPointerDown,
          touchstart: onPointerDown,
          click: (e) => L.DomEvent.stop(e),
        } as L.LeafletEventHandlerFnMap
      }
    />
  );
}

function SelectedPolygonEditLayer({
  polygon,
  polygonColor,
  polygonFillOpacity,
  onEdgeVertexAdd,
  onPolygonDelete,
  onVertexMove,
  onVertexDelete,
  suppressMapClickRef,
}: {
  polygon: GeoPolygonShape;
  polygonColor: string;
  polygonFillOpacity: number;
  onEdgeVertexAdd: (
    polygonId: string,
    segmentIndex: number,
    lat: number,
    lng: number,
  ) => void;
  onPolygonDelete: (polygonId: string) => void;
  onVertexMove: (
    polygonId: string,
    vertexIndex: number,
    lat: number,
    lng: number,
  ) => void;
  onVertexDelete: (polygonId: string, vertexIndex: number) => void;
  suppressMapClickRef: MutableRefObject<boolean>;
}) {
  const map = useMap();
  const { outer } = polygon;
  const rings = [outer, ...polygon.holes].filter((r) => r.length >= 3);
  const positionRings = rings.map((ring) =>
    ring.map(([lat, lng]) => [lat, lng] as [number, number]),
  );

  const onBodyPointerDown = createPointerHandler({
    map,
    suppressMapClickRef,
    draggable: false,
    onLongPress: () => onPolygonDelete(polygon.id),
    onDragMove: () => {},
    onDragEnd: () => {},
  });

  return (
    <>
      <Polygon
        positions={positionRings as LatLngExpression[][]}
        interactive
        bubblingMouseEvents={false}
        pathOptions={{
          color: "#FBBF24",
          weight: 3,
          fillColor: polygonColor,
          fillOpacity: Math.min(polygonFillOpacity + 0.08, 0.5),
        }}
        eventHandlers={
          {
            mousedown: onBodyPointerDown,
            touchstart: onBodyPointerDown,
            click: (e) => L.DomEvent.stop(e),
          } as L.LeafletEventHandlerFnMap
        }
      />

      {outer.map((pt, segmentIndex) => {
        const next = outer[(segmentIndex + 1) % outer.length];
        return (
          <Polyline
            key={`${polygon.id}-edge-${segmentIndex}`}
            positions={[
              [pt[0], pt[1]],
              [next[0], next[1]],
            ]}
            bubblingMouseEvents={false}
            pathOptions={{
              color: "#FBBF24",
              weight: EDGE_HIT_WEIGHT,
              opacity: 0.45,
              lineCap: "round",
              lineJoin: "round",
            }}
            eventHandlers={{
              click: (e) => {
                L.DomEvent.stop(e);
                const { lat, lng } = e.latlng;
                onEdgeVertexAdd(polygon.id, segmentIndex, lat, lng);
                suppressMapClickRef.current = true;
              },
            }}
          />
        );
      })}

      {outer.map((pt, vertexIndex) => (
        <PolygonVertexHandle
          key={`${polygon.id}-v-${vertexIndex}`}
          polygonId={polygon.id}
          vertexIndex={vertexIndex}
          position={pt}
          onMove={onVertexMove}
          onDelete={onVertexDelete}
          suppressMapClickRef={suppressMapClickRef}
        />
      ))}
    </>
  );
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
  selectedPolygonId = null,
  onVertexMove,
  onVertexDelete,
  onEdgeVertexAdd,
  onPolygonDelete,
  circleDraft = null,
  onMapClick,
  onMapMouseMove,
  onContextMenu,
  onCursorCoords,
  interactive,
  passMapClicks = false,
}: HexMapperMapProps) {
  const suppressMapClickRef = useRef(false);
  const layerInteractive = !passMapClicks;
  const [useFallbackTiles, setUseFallbackTiles] = useState(false);

  useEffect(() => {
    // Reset fallback when base style changes.
    setUseFallbackTiles(false);
  }, [grayscale]);

  const primaryTileUrl = grayscale
    ? "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
    : "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

  const fallbackTileUrl = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const tileUrl = useFallbackTiles ? fallbackTileUrl : primaryTileUrl;

  const attribution = useFallbackTiles
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    : grayscale
    ? "Tiles &copy; Esri"
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

  return (
    <div className="h-full min-h-[320px] w-full overflow-hidden [&_.leaflet-container]:bg-[#EDF3FB]">
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
                interactive={layerInteractive}
                positions={positions}
                pathOptions={{
                  color: layer.color,
                  weight: layer.weight,
                  fillColor: layer.color,
                  fillOpacity: layer.fillOpacity,
                }}
              >
                {layer.tooltip ? (
                  <Tooltip sticky opacity={0.96}>
                    <ZoneMapTooltipContent tooltip={layer.tooltip} />
                  </Tooltip>
                ) : null}
              </Polygon>
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
              interactive={layerInteractive}
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
                interactive={layerInteractive}
                positions={positionRings as LatLngExpression[][]}
                pathOptions={{
                  color: layer.color,
                  weight: layer.weight,
                  fillColor: layer.color,
                  fillOpacity: layer.fillOpacity,
                }}
              >
                {layer.tooltip ? (
                  <Tooltip sticky opacity={0.96}>
                    <ZoneMapTooltipContent tooltip={layer.tooltip} />
                  </Tooltip>
                ) : null}
              </Polygon>
            );
          }),
        )}

        {helperCircles.map((circle) => (
          <Circle
            key={circle.key}
            interactive={layerInteractive}
            center={circle.center}
            radius={circle.radiusMeters}
            pathOptions={{
              color: circle.color,
              weight: 2,
              fillColor: circle.color,
              fillOpacity: circle.fillOpacity ?? 0.12,
              dashArray: circle.dashArray,
            }}
          >
            {circle.tooltip ? (
              <Tooltip sticky opacity={0.96}>
                <ZoneMapTooltipContent tooltip={circle.tooltip} />
              </Tooltip>
            ) : null}
          </Circle>
        ))}

        {polygons.map((p) => {
          const isSelected =
            selectedPolygonId === p.id &&
            !drawingActive &&
            onEdgeVertexAdd &&
            onPolygonDelete;
          if (isSelected) return null;
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

        {circleDraft &&
          circleDraft.radiusMeters > 0 &&
          Number.isFinite(circleDraft.center[0]) && (
            <Circle
              center={circleDraft.center}
              radius={circleDraft.radiusMeters}
              pathOptions={{
                color: draftLineColor,
                weight: 2,
                dashArray: "6 8",
                fillColor: draftLineColor,
                fillOpacity: 0.12,
              }}
            />
          )}

        {selectedPolygonId &&
          !drawingActive &&
          onVertexMove &&
          onVertexDelete &&
          onEdgeVertexAdd &&
          onPolygonDelete &&
          polygons
            .filter((p) => p.id === selectedPolygonId && p.outer.length >= 3)
            .map((p) => (
              <SelectedPolygonEditLayer
                key={`edit-${p.id}`}
                polygon={p}
                polygonColor={polygonColor}
                polygonFillOpacity={polygonFillOpacity}
                onEdgeVertexAdd={onEdgeVertexAdd}
                onPolygonDelete={onPolygonDelete}
                onVertexMove={onVertexMove}
                onVertexDelete={onVertexDelete}
                suppressMapClickRef={suppressMapClickRef}
              />
            ))}

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
          suppressMapClickRef={suppressMapClickRef}
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
