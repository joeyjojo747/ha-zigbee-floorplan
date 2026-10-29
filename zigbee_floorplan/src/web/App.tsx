// Top level: header with levels and scan control, the floorplan (or list view) and the sidebar.
import { useCallback, useEffect, useState } from 'react';
import { api, type Layout, type NetworkResponse, type Status } from './api';
import { BuildingCanvas, type LinkFilters, type OtherLevels } from './BuildingCanvas';
import { alignPatch, floorRect, isSized, rescaleAboutCentre, type Point, type Rect, type ViewMode } from './geometry';
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

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [network, setNetwork] = useState<NetworkResponse | null>(null);
  const [layout, setLayout] = useState<Layout>({ floors: [], placements: {} });
  const [error, setError] = useState<string | null>(null);
  // 0.3.0 remembered 'all' for its side-by-side view, which the plan view now replaces.
  const [view, setView] = useState<'plan' | 'list'>(() => (remembered<string>('view', 'plan') === 'list' ? 'list' : 'plan'));
  const [mode, setMode] = useState<ViewMode>(() => remembered('mode', '2d'));
  const [others, setOthers] = useState<OtherLevels>(() => remembered('others', 'faint'));
  const [align, setAlign] = useState<Rect | null>(null);
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
  useEffect(() => remember('mode', mode), [mode]);
  useEffect(() => remember('others', others), [others]);

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
    setAlign(null);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (placing || scalePoints || align) cancelModes();
      else setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing, scalePoints, align]);

  const changeLevel = (id: string) => {
    if (id !== floor?.id) setAlign(null);
    setFloorId(id);
  };

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
    if (placement && placement.floorId !== floor?.id) changeLevel(placement.floorId);
  };

  const place = async (ieee: string, floorId: string, x: number, y: number) => {
    const placement = { floorId, x, y };
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
    if (!isSized(floor) || !scalePoints || scalePoints.length < 2 || !(metres > 0)) return;
    const [a, b] = scalePoints;
    const pxPerMetre = Math.hypot(a.x - b.x, a.y - b.y) / metres;
    try {
      // Keep the level centred where it was aligned, so a new scale doesn't shift it.
      await api.updateFloor(floor.id, { pxPerMetre, ...rescaleAboutCentre(floor, pxPerMetre) });
      await reloadLayout();
    } catch (err) {
      report(err);
    }
    cancelModes();
  };

  const saveAlign = async () => {
    if (!isSized(floor) || !align) return;
    try {
      await api.updateFloor(floor.id, alignPatch(floor, align));
      await reloadLayout();
    } catch (err) {
      report(err);
    }
    setAlign(null);
  };

  const devices = new Map(network?.devices.map((d) => [d.ieee, d]));
  const placingName = placing ? devices.get(placing)?.name ?? placing : null;
  const canPlace = isSized(floor);
  const otherSized = layout.floors.filter((f) => f.id !== floor?.id && isSized(f)).length > 0;

  return (
    <div className="app">
      <header>
        <h1>Zigbee Floorplan</h1>
        <nav className="levels-tabs" aria-label="Levels">
          {layout.floors.map((f) => (
            <button key={f.id} className={f.id === floor?.id && view === 'plan' ? 'tab active' : 'tab'} onClick={() => { changeLevel(f.id); setView('plan'); }}>
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
            {canPlace && (
              <div className="plan-toolbar">
                {align ? (
                  <span>
                    Drag <strong>{floor?.name}</strong> to line it up with the other levels; drag a corner to resize it.{' '}
                    <button onClick={() => void saveAlign()}>Done</button> <button className="secondary" onClick={cancelModes}>Cancel</button>
                  </span>
                ) : placing ? (
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
                    <div className="view-controls">
                      <span className="segmented" role="group" aria-label="View">
                        {(['2d', '3d'] as const).map((m) => (
                          <button key={m} className={mode === m ? 'active' : ''} onClick={() => { cancelModes(); setMode(m); }}>{m.toUpperCase()}</button>
                        ))}
                      </span>
                      {layout.floors.length > 1 && (
                        <label>
                          Other levels{' '}
                          <select value={others} onChange={(e) => setOthers(e.target.value as OtherLevels)}>
                            <option value="faint">Faint</option>
                            <option value="hidden">Hidden</option>
                          </select>
                        </label>
                      )}
                      {mode === '2d' && isSized(floor) && (
                        <>
                          <button className="secondary" onClick={() => { setSelected(null); setScalePoints([]); }}>
                            {floor.pxPerMetre ? 'Reset scale' : 'Set scale'}
                          </button>
                          <button
                            className="secondary"
                            disabled={!otherSized}
                            title={otherSized ? 'Line this level up with the others' : 'Add another level with an image to align to'}
                            onClick={() => { cancelModes(); setSelected(null); setAlign(floorRect(floor)); }}
                          >
                            Align
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {isSized(floor) ? (
              <BuildingCanvas
                floors={layout.floors}
                active={floor}
                mode={mode}
                others={others}
                align={align}
                onAlign={setAlign}
                devices={devices}
                links={network?.links ?? []}
                placements={layout.placements}
                filters={filters}
                selected={selected}
                onSelect={select}
                placing={placing}
                onPlace={(ieee, floorId, x, y) => void place(ieee, floorId, x, y)}
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
                onMove={(ieee) => { cancelModes(); setMode('2d'); setPlacing(ieee); }}
                onRemove={(ieee) => void unplace(ieee)}
                onClose={() => setSelected(null)}
              />
            ) : (
              <DeviceTray
                devices={network?.devices ?? []}
                placements={layout.placements}
                floor={isSized(floor) ? floor : null}
                canPlace={canPlace}
                placing={placing}
                onStartPlacing={(ieee) => { cancelModes(); setMode('2d'); setPlacing(placing === ieee ? null : ieee); }}
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
