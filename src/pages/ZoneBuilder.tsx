import { useMemo, useState } from 'react';
import { ArrowDownRight, Download, Square, Upload, Zap } from 'lucide-react';
import ZoneBuilderMap from '../components/ZoneBuilderMap';
import { buildZonePayload, polygonAreaKm2, serializeCellCsv } from '../lib/h3';
import { createZone } from '../lib/api';

const zoneTypes = ['geofence', 'emergency', 'custom_1', 'custom_2'];
const CLOSE_DISTANCE_METERS = 35;

function toRad(value: number) {
  return (value * Math.PI) / 180;
}

function distanceMeters(a: [number, number], b: [number, number]) {
  const earthRadius = 6371000;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const lat1 = toRad(a[0]);
  const lat2 = toRad(b[0]);
  const hav =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);

  return 2 * earthRadius * Math.atan2(Math.sqrt(hav), Math.sqrt(1 - hav));
}

function pointsEqual(a: [number, number], b: [number, number]) {
  return Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7;
}

function isClosedPolygon(points: [number, number][]) {
  if (points.length < 4) return false;
  return pointsEqual(points[0], points[points.length - 1]);
}

export default function ZoneBuilder() {
  const [resolution, setResolution] = useState(13);
  const [mode, setMode] = useState<'hex' | 'polygon'>('hex');
  const [selectedColor, setSelectedColor] = useState('#20c997');
  const [selectedCells, setSelectedCells] = useState<string[]>([]);
  const [polygonPoints, setPolygonPoints] = useState<[number, number][]>([]);
  const [zoneName, setZoneName] = useState('Downtown Grid');
  const [description, setDescription] = useState('Core geofence coverage around the operational area.');
  const [zoneType, setZoneType] = useState('geofence');
  const [status, setStatus] = useState('');

  const areaKm2 = useMemo(() => polygonAreaKm2(polygonPoints), [polygonPoints]);
  const canSave = selectedCells.length > 0 || polygonPoints.length > 0;

  const handleCellToggle = (cell: string) => {
    setSelectedCells((current) => (current.includes(cell) ? current.filter((item) => item !== cell) : [...current, cell]));
  };

  const handlePolygonAddPoint = (point: [number, number]) => {
    setPolygonPoints((current) => {
      if (current.length === 0) return [point];
      if (isClosedPolygon(current)) return current;

      const first = current[0];
      const isNearStart = current.length >= 3 && distanceMeters(point, first) <= CLOSE_DISTANCE_METERS;

      if (isNearStart) {
        return [...current, first];
      }

      return [...current, point];
    });
  };

  const handlePolygonReset = () => {
    setPolygonPoints([]);
  };

  const handleExportJson = () => {
    const payload = {
      name: zoneName,
      description,
      zone_type: zoneType,
      h3_cells: selectedCells,
      polygon: polygonPoints
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'zone-export.json';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const handleExportCsv = () => {
    const csv = serializeCellCsv(selectedCells);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zone-cells.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSave = async () => {
    if (!zoneName.trim() || !canSave) {
      setStatus('Add cells or draw a polygon before saving a zone.');
      return;
    }
    setStatus('Saving zone…');
    try {
      await createZone(buildZonePayload(zoneName, description, zoneType, selectedCells, polygonPoints));
      setStatus('Zone saved successfully!');
    } catch (error) {
      setStatus('Failed to save zone. Ensure you are logged in and try again.');
    }
  };

  return (
    <div className="grid gap-8 xl:grid-cols-[1.2fr_0.8fr]">
      <div className="space-y-6">
        <section className="layer-card">
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-[#2F80ED]">Zone Builder</p>
              <h1 className="text-3xl font-semibold text-[#0F2C5C]">Interactive H3 and geofence design.</h1>
            </div>
            <div className="rounded-3xl bg-[#EDF3FB] px-4 py-3 text-sm text-[#566784]">Live map-driven workflow</div>
          </div>
          <p className="text-[#8694AC]">Click cells to build hex-based zones or draw a geo-fence polygon for custom coverage.</p>
        </section>

        <div className="grid gap-6">
          <div className="layer-card">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] p-5">
                <p className="text-sm uppercase tracking-[0.3em] text-[#8694AC]">Selected cells</p>
                <p className="mt-4 text-3xl font-semibold text-[#0F2C5C]">{selectedCells.length}</p>
              </div>
              <div className="rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] p-5">
                <p className="text-sm uppercase tracking-[0.3em] text-[#8694AC]">Polygon area</p>
                <p className="mt-4 text-3xl font-semibold text-[#0F2C5C]">{areaKm2.toFixed(2)} km²</p>
              </div>
              <div className="rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] p-5">
                <p className="text-sm uppercase tracking-[0.3em] text-[#8694AC]">Definition</p>
                <p className="mt-4 text-2xl font-semibold text-[#2F80ED] uppercase tracking-[0.15em]">{mode === 'hex' ? 'H3 Hex' : 'Geo-fence'}</p>
              </div>
            </div>
          </div>
          <ZoneBuilderMap
            resolution={resolution}
            selectedCells={selectedCells}
            selectedColor={selectedColor}
            mode={mode}
            polygonPoints={polygonPoints}
            onCellToggle={handleCellToggle}
            onPolygonAddPoint={handlePolygonAddPoint}
            onPolygonReset={handlePolygonReset}
          />
        </div>
      </div>

      <aside className="layer-card space-y-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-[#2F80ED]">Controls</p>
              <h2 className="text-xl font-semibold text-[#0F2C5C]">Builder settings</h2>
            </div>
            <div className="rounded-full bg-[#F7FAFE] px-3 py-2 text-sm text-[#566784]">Mode: {mode === 'hex' ? 'H3' : 'Geo-fence'}</div>
          </div>
          <div className="space-y-4">
            <label className="block text-sm text-[#566784]">Definition mode</label>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMode('hex')}
                className={`rounded-3xl px-4 py-3 text-left text-sm transition ${
                  mode === 'hex' ? 'bg-[#EDF3FB] text-[#2F80ED]' : 'bg-[#EDF3FB] text-[#566784] hover:bg-[#E4ECF7]'
                }`}
              >
                <Square className="mb-2 h-5 w-5" /> H3 Hex
              </button>
              <button
                type="button"
                onClick={() => setMode('polygon')}
                className={`rounded-3xl px-4 py-3 text-left text-sm transition ${
                  mode === 'polygon' ? 'bg-[#EDF3FB] text-[#2F80ED]' : 'bg-[#EDF3FB] text-[#566784] hover:bg-[#E4ECF7]'
                }`}
              >
                <ArrowDownRight className="mb-2 h-5 w-5" /> Geo-fence
              </button>
            </div>
            <label className="block text-sm text-[#566784]">
              Resolution: {resolution}
              <input
                type="range"
                min={8}
                max={15}
                value={resolution}
                onChange={(event) => setResolution(Number(event.target.value))}
                className="mt-3 w-full accent-[#2F80ED]"
              />
            </label>
            <label className="block text-sm text-[#566784]">
              Zone color
              <input
                type="color"
                value={selectedColor}
                onChange={(event) => setSelectedColor(event.target.value)}
                className="mt-3 h-12 w-full cursor-pointer rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] p-2"
              />
            </label>
          </div>
        </div>
        <div className="space-y-4 rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] p-5">
          <p className="text-sm uppercase tracking-[0.3em] text-[#2F80ED]">Zone payload</p>
          <label className="block text-sm text-[#566784]">
            Name
            <input
              value={zoneName}
              onChange={(event) => setZoneName(event.target.value)}
              className="mt-2 w-full rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3 text-[#0F2C5C]"
            />
          </label>
          <label className="block text-sm text-[#566784]">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="mt-2 w-full rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3 text-[#0F2C5C]"
            />
          </label>
          <label className="block text-sm text-[#566784]">
            Zone type
            <select
              value={zoneType}
              onChange={(event) => setZoneType(event.target.value)}
              className="mt-2 w-full rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] px-4 py-3 text-[#0F2C5C]"
            >
              {zoneTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="space-y-4 rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] p-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm uppercase tracking-[0.3em] text-[#2F80ED]">Exports</p>
            <span className="rounded-full bg-[#EDF3FB] px-3 py-1 text-xs text-[#566784]">{selectedCells.length} cells</span>
          </div>
          <div className="grid gap-3">
            <button
              type="button"
              onClick={handleExportJson}
              className="flex items-center justify-center gap-2 rounded-3xl bg-[#EDF3FB] px-4 py-3 text-sm text-[#566784] transition hover:bg-[#E4ECF7]"
            >
              <Upload size={16} /> Export JSON
            </button>
            <button
              type="button"
              onClick={handleExportCsv}
              className="flex items-center justify-center gap-2 rounded-3xl bg-[#EDF3FB] px-4 py-3 text-sm text-[#566784] transition hover:bg-[#E4ECF7]"
            >
              <Download size={16} /> Export CSV
            </button>
          </div>
        </div>
        <div className="rounded-3xl border border-[#DCE6F2] bg-[#F7FAFE] p-5">
          <div className="mb-4 flex items-center gap-3 text-sm text-[#566784]">
            <Zap size={16} /> <span>Actions</span>
          </div>
          <button
            type="button"
            onClick={handleSave}
            className="w-full rounded-3xl bg-[#2F80ED] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#2567D9]"
          >
            Save zone
          </button>
          {status && <p className="mt-4 text-sm text-[#566784]">{status}</p>}
        </div>
      </aside>
    </div>
  );
}
