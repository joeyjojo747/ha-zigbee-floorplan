// Top level: header with levels and scan control, the floorplan (or list view) and the sidebar.
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api, floorImageUrl, type Layout, type NetworkResponse, type Status, type Wall } from './api';
import { BuildingCanvas, type LinkFilters } from './BuildingCanvas';
import { alignPatch, floorRect, isSized, rescaleAboutCentre, type Point, type Rect, type ViewMode } from './geometry';
import { LevelsDialog } from './LevelsDialog';
import { detectWalls } from './walls';
import { DeviceDetails, DeviceTray } from './Sidebar';
import { Tables } from './Tables';
import { parseThemeChoice, resolveTheme, THEME_CHOICES, THEME_KEY, type ThemeChoice } from './theme';

// three.js is large, so the 3D view loads the first time it's opened.
const ThreeView = lazy(() => import('./ThreeView').then((m) => ({ default: m.ThreeView })));

/** Longest side, in pixels, a plan is scaled to before detecting walls. */
const DETECT_MAX_SIDE = 2500;

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
  // Ids of the levels turned off. 0.5.0 and earlier had one Faint/Hidden setting for every
  // other level; 'hidden' becomes every level off once the levels have loaded.
  const [hidden, setHidden] = useState<string[]>(() => remembered<string[] | null>('hidden', null) ?? []);
  const hideAllOnLoad = useRef(remembered<string[] | null>('hidden', null) === null && remembered<string>('others', 'faint') === 'hidden');
  // While aligning: the draft position of each level moved so far, so the level tabs can
  // switch which level is being aligned. Done saves them all; Cancel drops them.
  const [drafts, setDrafts] = useState<Record<string, Rect> | null>(null);
  const [walling, setWalling] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [floorId, setFloorId] = useState<string | null>(() => remembered('floor', null));
  const [filters, setFilters] = useState<LinkFilters>(() => remembered('filters', { parentChild: true, neighbours: true, unmeasured: true }));
  const [selected, setSelected] = useState<string | null>(null);
  const [placing, setPlacing] = useState<string | null>(null);
  const [scalePoints, setScalePoints] = useState<Point[] | null>(null);
  const [scaleMetres, setScaleMetres] = useState('');
  const [showLevels, setShowLevels] = useState(false);

  const theme = useTheme();

  useEffect(() => remember('view', view), [view]);
  useEffect(() => remember('floor', floorId), [floorId]);
  useEffect(() => remember('filters', filters), [filters]);
  useEffect(() => remember('mode', mode), [mode]);
  useEffect(() => remember('hidden', hidden), [hidden]);
  useEffect(() => {
    if (!hideAllOnLoad.current || !layout.floors.length) return;
    hideAllOnLoad.current = false;
    setHidden(layout.floors.map((f) => f.id));
  }, [layout.floors]);

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

  /** The active level's draft position while aligning, else null. */
  const align = drafts && isSized(floor) ? drafts[floor.id] ?? floorRect(floor) : null;

  const cancelModes = () => {
    setPlacing(null);
    setScalePoints(null);
    setScaleMetres('');
    setDrafts(null);
    setWalling(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (placing || scalePoints || drafts || walling) cancelModes();
      else setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [placing, scalePoints, drafts, walling]);

  const changeLevel = (id: string) => setFloorId(id);

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
    if (!drafts) return;
    try {
      for (const [id, rect] of Object.entries(drafts)) {
        const level = layout.floors.find((f) => f.id === id);
        if (isSized(level)) await api.updateFloor(id, alignPatch(level, rect));
      }
    } catch (err) {
      report(err);
    }
    await reloadLayout();
    setDrafts(null);
  };

  const saveWalls = async (id: string, walls: Wall[]) => {
    setLayout((l) => ({ ...l, floors: l.floors.map((f) => (f.id === id ? { ...f, walls } : f)) }));
    try {
      await api.setWalls(id, walls);
    } catch (err) {
      report(err);
      await reloadLayout();
    }
  };

  /** Finds the walls in the active level's image (in the browser) and saves them. */
  const detect = async () => {
    if (!isSized(floor)) return;
    if (floor.walls.length && !confirm(`Replace the ${floor.walls.length} walls on ${floor.name} with detected ones?`)) return;
    setDetecting(true);
    // Let "Detecting…" paint before the work blocks the page.
    await new Promise((r) => setTimeout(r, 50));
    try {
      const bitmap = await createImageBitmap(await (await fetch(floorImageUrl(floor))).blob());
      // Large scans are scaled down first: phone browsers cap canvas size, and the detail
      // isn't needed (detection's thresholds are relative to the image size).
      const scale = Math.min(1, DETECT_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const walls = detectWalls(ctx.getImageData(0, 0, canvas.width, canvas.height));
      // Walls are stored in pixels of the size recorded on upload.
      const f = floor.width / canvas.width;
      await saveWalls(floor.id, walls.map((w) => ({ x1: w.x1 * f, y1: w.y1 * f, x2: w.x2 * f, y2: w.y2 * f, t: w.t * f })));
    } catch (err) {
      report(err);
    } finally {
      setDetecting(false);
    }
  };

  const devices = new Map(network?.devices.map((d) => [d.ieee, d]));
  const placingName = placing ? devices.get(placing)?.name ?? placing : null;
  const canPlace = isSized(floor);
  const sizedLevels = layout.floors.filter(isSized);
  const otherSized = sizedLevels.some((f) => f.id !== floor?.id);

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
          <ThemeMenu choice={theme.choice} onChange={theme.setChoice} />
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
                {drafts ? (
                  <span>
                    Drag <strong>{floor?.name}</strong> to line it up with the other levels; drag a corner to resize it. Pick another level above to align it too.{' '}
                    <button onClick={() => void saveAlign()}>Done</button> <button className="secondary" onClick={cancelModes}>Cancel</button>
                  </span>
                ) : walling ? (
                  <span>
                    Walls on <strong>{floor?.name}</strong> ({isSized(floor) ? floor.walls.length : 0}): drag to draw one (Shift for any angle),
                    click one to delete it, right-drag to pan.{' '}
                    <button disabled={detecting} onClick={() => void detect()}>{detecting ? 'Detecting…' : 'Detect walls'}</button>{' '}
                    <button className="secondary" disabled={!isSized(floor) || !floor.walls.length}
                      onClick={() => isSized(floor) && confirm(`Remove all ${floor.walls.length} walls on ${floor.name}?`) && void saveWalls(floor.id, [])}>Clear</button>{' '}
                    <button className="secondary" onClick={cancelModes}>Done</button>
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
                      {sizedLevels.length > 1 && (
                        <span className="level-toggles" role="group" aria-label="Show levels">
                          Show
                          {sizedLevels.map((f) => {
                            const on = f.id === floor?.id || !hidden.includes(f.id);
                            return (
                              <button
                                key={f.id}
                                className={`chip${on ? ' on' : ''}`}
                                aria-pressed={on}
                                disabled={f.id === floor?.id}
                                title={f.id === floor?.id ? 'The level you are working on is always shown' : on ? `Hide ${f.name}` : `Show ${f.name}`}
                                onClick={() => setHidden((h) => (on ? [...h, f.id] : h.filter((id) => id !== f.id)))}
                              >
                                {on ? '✓ ' : ''}{f.name}
                              </button>
                            );
                          })}
                        </span>
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
                            onClick={() => { cancelModes(); setSelected(null); setDrafts({}); }}
                          >
                            Align
                          </button>
                          <button className="secondary" title="Find or draw the walls on this level" onClick={() => { cancelModes(); setSelected(null); setWalling(true); }}>
                            Walls
                          </button>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {isSized(floor) && mode === '3d' ? (
              <Suspense fallback={<div className="empty">Loading 3D…</div>}>
              <ThreeView
                floors={layout.floors}
                active={floor}
                hidden={hidden}
                theme={theme.resolved}
                devices={devices}
                links={network?.links ?? []}
                placements={layout.placements}
                filters={filters}
                selected={selected}
                onSelect={select}
              />
              </Suspense>
            ) : isSized(floor) ? (
              <BuildingCanvas
                floors={layout.floors}
                active={floor}
                mode={mode}
                hidden={hidden}
                theme={theme.resolved}
                align={align}
                onAlign={(rect) => floor && setDrafts((d) => ({ ...d, [floor.id]: rect }))}
                wallEdit={walling}
                onWalls={(id, walls) => void saveWalls(id, walls)}
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

/** The viewer's theme choice, remembered per browser, and the theme it resolves to (Auto follows the system). */
function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    try {
      return parseThemeChoice(localStorage.getItem(THEME_KEY));
    } catch {
      return 'auto';
    }
  });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  const resolved = resolveTheme(choice, systemDark);
  // A layout effect runs before any child's ordinary effect, so the 3D view reads the new theme's colours.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);
  useEffect(() => remember('theme', choice), [choice]);
  return { choice, setChoice, resolved };
}

function ThemeMenu({ choice, onChange }: { choice: ThemeChoice; onChange: (c: ThemeChoice) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);
  return (
    <div className="theme-menu" ref={ref}>
      <button className={`icon theme-button${open ? ' open' : ''}`} title="Theme" aria-label="Theme" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="theme-glyph" aria-hidden="true" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-title">Theme</div>
          {THEME_CHOICES.map((c) => (
            <button key={c.value} role="menuitemradio" aria-checked={choice === c.value} className={choice === c.value ? 'checked' : ''}
              onClick={() => { onChange(c.value); setOpen(false); }}>
              {c.label}{choice === c.value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      )}
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
