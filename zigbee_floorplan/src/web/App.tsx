// Top level: header with levels and scan control, the floorplan (or list view) and the sidebar.
import { useCallback, useEffect, useState } from 'react';
import { api, type Floor, type Layout, type NetworkResponse, type Status } from './api';
import { FloorCanvas, type LinkFilters, type Point } from './FloorCanvas';
import { LevelsDialog } from './LevelsDialog';
import { DeviceDetails, DeviceTray } from './Sidebar';
import { Tables } from './Tables';

const formatTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'never');

// Per-viewer conveniences only; the page works the same if storage is unavailable.
function remembered<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`zigbee-floorplan:${key}`);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(`zigbee-floorplan:${key}`, JSON.stringify(value));
  } catch {
    // ignore
  }
}

const hasImage = (floor: Floor | null): floor is Floor & { width: number; height: number } =>
  !!floor?.image && !!floor.width && !!floor.height;

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [network, setNetwork] = useState<NetworkResponse | null>(null);
  const [layout, setLayout] = useState<Layout>({ floors: [], placements: {} });
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'plan' | 'list'>(() => remembered('view', 'plan'));
  const [floorId, setFloorId] = useState<string | null>(() => remembered('floor', null));
  const [filters, setFilters] = useState<LinkFilters>(() => remembered('filters', { parentChild: true, neighbours: true, unmeasured: true }));
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [scalePoints, setScalePoints] = useState<Point[] | null>(null);
  const [scaleMetres, setScaleMetres] = useState('');
  const [showLevels, setShowLevels] = useState(false);

  useEffect(() => remember('view', view), [view]);
  useEffect(() => remember('floor', floorId), [floorId]);
  useEffect(() => remember('filters', filters), [filters]);

  const report = (err: unknown) => setError((err as Error).message);

  const refresh = useCallback(async () => {
    try {
      const s = await api.status();
      setStatus(s);
      if (!s.scanning) setNetwork(await api.network());
    } catch (err) {
      report(err);
    }
  }, []);

  const reloadLayout = useCallback(async () => {
    try {
      setLayout(await api.layout());
    } catch (err) {
      report(err);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void reloadLayout();
  }, [refresh, reloadLayout]);

  // Poll while a scan runs.
  useEffect(() => {
    if (!status?.scanning) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [status?.scanning, refresh]);

  // Keep the chosen level valid as levels come and go.
  const floor = layout.floors.find((f) => f.id === floorId) ?? layout.floors[0] ?? null;
  useEffect(() => {
    if (floor && floor.id !== floorId) setFloorId(floor.id);
  }, [floor, floorId]);

  const cancelModes = () => {
    setPlacing(null);
    setScalePoints(null);
    setScaleMetres('');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (placing || scalePoints) cancelModes();
      else setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing, scalePoints]);

  const startScan = async () => {
    try {
      await api.scan();
    } catch (err) {
      report(err);
    }
    await refresh();
  };

  const select = (ieee: string | null) => {
    setSelected(ieee);
    const placement = ieee ? layout.placements[ieee] : undefined;
    if (placement && placement.floorId !== floor?.id) setFloorId(placement.floorId);
  };

  const place = async (ieee: string, x: number, y: number) => {
    if (!floor) return;
    const placement = { floorId: floor.id, x, y };
    setLayout((l) => ({ ...l, placements: { ...l.placements, [ieee]: placement } }));
    setPlacing(null);
    setSelected(ieee);
    try {
      await api.place(ieee, placement);
    } catch (err) {
      report(err);
      await reloadLayout();
    }
  };

  const unplace = async (ieee: string) => {
    setLayout((l) => {
      const { [ieee]: _removed, ...placements } = l.placements;
      return { ...l, placements };
    });
    try {
      await api.unplace(ieee);
    } catch (err) {
      report(err);
      await reloadLayout();
    }
  };

  const saveScale = async () => {
    const metres = Number(scaleMetres);
    if (!floor || !scalePoints || scalePoints.length < 2 || !(metres > 0)) return;
    const [a, b] = scalePoints;
    try {
      await api.updateFloor(floor.id, { pxPerMetre: Math.hypot(a.x - b.x, a.y - b.y) / metres });
      await reloadLayout();
    } catch (err) {
      report(err);
    }
    cancelModes();
  };

  const devices = new Map(network?.devices.map((d) => [d.ieee, d]));
  const placingName = placing ? devices.get(placing)?.name ?? placing : null;

  return (
    <div className="app">
      <header>
        <h1>Zigbee Floorplan</h1>
        <nav className="levels-tabs" aria-label="Levels">
          {layout.floors.map((f) => (
            <button key={f.id} className={f.id === floor?.id && view === 'plan' ? 'tab active' : 'tab'} onClick={() => { setFloorId(f.id); setView('plan'); }}>
              {f.name}
            </button>
          ))}
          <button className="tab" onClick={() => setShowLevels(true)}>{layout.floors.length ? 'Levels…' : '+ Add level'}</button>
          <button className={view === 'list' ? 'tab active' : 'tab'} onClick={() => setView(view === 'list' ? 'plan' : 'list')}>List</button>
        </nav>
        <div className="toolbar">
          <span className={`pill ${status?.connected ? 'ok' : 'bad'}`}>
            {status?.mode === 'fixture' ? 'Offline (captured data)' : status?.connected ? 'MQTT connected' : 'MQTT disconnected'}
          </span>
          <span className="muted small">Last scan: {formatTime(network?.takenAt ?? null)}</span>
          <button onClick={startScan} disabled={!status?.connected || status.scanning}>
            {status?.scanning ? 'Scanning…' : 'Scan now'}
          </button>
        </div>
      </header>

      {(error || status?.lastError) && (
        <p className="error banner">
          {error ?? status?.lastError}
          {error && <button className="icon" title="Dismiss" onClick={() => setError(null)}>✕</button>}
        </p>
      )}
      {!network && !status?.scanning && <p className="muted banner">No scan yet. Click Scan now; it takes a minute or two and queries every router.</p>}

      {view === 'list' && network ? (
        <Tables network={network} onSelect={(ieee) => { select(ieee); setView('plan'); }} />
      ) : (
        <div className="workspace">
          <div className="plan-area">
            {floor && hasImage(floor) && (
              <div className="plan-toolbar">
                {placing ? (
                  <span>Click the plan to place <strong>{placingName}</strong> <button className="secondary" onClick={cancelModes}>Cancel</button></span>
                ) : scalePoints ? (
                  scalePoints.length < 2 ? (
                    <span>Click two points a known distance apart, e.g. both ends of a wall. <button className="secondary" onClick={cancelModes}>Cancel</button></span>
                  ) : (
                    <form className="inline" onSubmit={(e) => { e.preventDefault(); void saveScale(); }}>
                      Distance between the points
                      <input autoFocus type="number" min="0.1" step="0.01" value={scaleMetres} onChange={(e) => setScaleMetres(e.target.value)} /> m
                      <button type="submit" disabled={!(Number(scaleMetres) > 0)}>Save scale</button>
                      <button type="button" className="secondary" onClick={cancelModes}>Cancel</button>
                    </form>
                  )
                ) : (
                  <>
                    <Legend filters={filters} onChange={setFilters} />
                    <button className="secondary" onClick={() => { setSelected(null); setScalePoints([]); }}>
                      {floor.pxPerMetre ? 'Reset scale' : 'Set scale'}
                    </button>
                  </>
                )}
              </div>
            )}

            {floor && hasImage(floor) ? (
              <FloorCanvas
                floor={floor}
                devices={devices}
                links={network?.links ?? []}
                placements={layout.placements}
                filters={filters}
                selected={selected}
                onSelect={select}
                placing={placing}
                onPlace={(ieee, x, y) => void place(ieee, x, y)}
                scalePoints={scalePoints}
                onScalePoint={(p) => setScalePoints((pts) => (pts && pts.length < 2 ? [...pts, p] : pts))}
              />
            ) : (
              <div className="empty">
                <p>{floor ? `${floor.name} has no image yet.` : 'Add a level with a floorplan image to start placing devices.'}</p>
                <button onClick={() => setShowLevels(true)}>{floor ? 'Upload image' : 'Add a level'}</button>
              </div>
            )}
          </div>

          <aside className="sidebar">
            {selected ? (
              <DeviceDetails
                ieee={selected}
                devices={devices}
                links={network?.links ?? []}
                placements={layout.placements}
                floors={layout.floors}
                onSelect={select}
                onMove={(ieee) => { setScalePoints(null); setPlacing(ieee); }}
                onRemove={(ieee) => void unplace(ieee)}
                onClose={() => setSelected(null)}
              />
            ) : (
              <DeviceTray
                devices={network?.devices ?? []}
                placements={layout.placements}
                floor={hasImage(floor) ? floor : null}
                placing={placing}
                onStartPlacing={(ieee) => { setScalePoints(null); setPlacing(placing === ieee ? null : ieee); }}
                onSelect={select}
              />
            )}
          </aside>
        </div>
      )}

      {showLevels && <LevelsDialog layout={layout} onChanged={reloadLayout} onClose={() => setShowLevels(false)} />}
    </div>
  );
}

function Legend({ filters, onChange }: { filters: LinkFilters; onChange: (f: LinkFilters) => void }) {
  const toggle = (key: keyof LinkFilters) => onChange({ ...filters, [key]: !filters[key] });
  return (
    <div className="legend">
      <span className="key good">good ≥100</span>
      <span className="key fair">fair 50–99</span>
      <span className="key poor">poor &lt;50</span>
      <span className="key unknown">unmeasured</span>
      <label><input type="checkbox" checked={filters.parentChild} onChange={() => toggle('parentChild')} /> Parent–child</label>
      <label><input type="checkbox" checked={filters.neighbours} onChange={() => toggle('neighbours')} /> Router neighbours</label>
      <label><input type="checkbox" checked={filters.unmeasured} onChange={() => toggle('unmeasured')} /> Unmeasured</label>
    </div>
  );
}
