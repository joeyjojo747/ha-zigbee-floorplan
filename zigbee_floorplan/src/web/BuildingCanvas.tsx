// Every level in one SVG. In 2D the units are building metres; in 3D each level is
// flattened and lifted by its elevation. Pan by dragging the background, zoom with the
// wheel; markers and labels keep a constant on-screen size.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { floorImageUrl, type Floor, type NetworkDevice, type NetworkLink, type Placement, type Wall } from './api';
import {
  buildingToImage, clampFraction, elevations, floorRect, floorTransform, imageToBuilding, isSized, metresPerPx, placementPoint, project,
  rectTransform, resizeFromCorner, shownLevels, type Corner, type Point, type Rect, type SizedFloor, type ViewMode,
} from './geometry';

export interface LinkFilters {
  parentChild: boolean;
  neighbours: boolean;
  unmeasured: boolean;
}

interface Props {
  /** All levels, top to bottom. */
  floors: Floor[];
  /** The level being edited; must have an image. */
  active: SizedFloor;
  mode: ViewMode;
  /** Ids of the levels turned off (the active level is drawn regardless). */
  hidden: string[];
  devices: Map<string, NetworkDevice>;
  links: NetworkLink[];
  placements: Record<string, Placement>;
  filters: LinkFilters;
  selected: string | null;
  onSelect: (ieee: string | null) => void;
  /** Device waiting to be placed with the next click, if any. */
  placing: string | null;
  /** Position as fractions of the level's image. */
  onPlace: (ieee: string, floorId: string, x: number, y: number) => void;
  /** Points (image pixels of the active level) picked so far with the scale tool, or null when it's off. */
  scalePoints: Point[] | null;
  onScalePoint: (p: Point) => void;
  /** Draft position of the active level (building metres) while aligning, else null. */
  align: Rect | null;
  onAlign: (rect: Rect) => void;
  /** Wall mode: the active level's walls are shown and edited instead of devices and links. */
  wallEdit?: boolean;
  onWalls?: (floorId: string, walls: Wall[]) => void;
}

type View = { x: number; y: number; w: number; h: number };
type Gesture =
  | { kind: 'pan'; start: Point; view: View; moved: boolean; ieee: string | null }
  | { kind: 'drag'; ieee: string; start: Point; moved: boolean }
  | { kind: 'align-move'; start: Point; rect: Rect; moved: boolean }
  | { kind: 'align-resize'; corner: Corner; start: Point; rect: Rect; moved: boolean }
  | { kind: 'wall'; start: Point; moved: boolean; from: Point };

const RADIUS = { Coordinator: 11, Router: 9, EndDevice: 7 } as const;
const NICE_METRES = [0.5, 1, 2, 5, 10, 20, 50, 100];
const CORNERS: Corner[] = ['nw', 'ne', 'sw', 'se'];

export function BuildingCanvas(props: Props) {
  const { floors, active, mode, hidden, devices, links, placements, filters, selected, placing, scalePoints, align } = props;
  const wallEdit = !!props.wallEdit && mode === '2d';
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const z = elevations(floors);
  // While aligning, every level is shown so there's something to align to.
  const shown = shownLevels(floors, active, align ? [] : hidden);
  const edit = mode === '2d';

  const fit = (): View => {
    const points = shown.flatMap((f) => {
      const r = floorRect(f);
      const corners = [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]];
      return corners.map(([x, y]) => project({ x, y }, z.get(f.id)!, mode));
    });
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const pad = Math.max(x1 - x0, y1 - y0) * 0.03;
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
  };
  const [view, setView] = useState<View>(fit);
  const [fitWidth, setFitWidth] = useState(() => fit().w);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [drag, setDrag] = useState<Point | null>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const [selectedWall, setSelectedWall] = useState<number | null>(null);
  /** Far end (image pixels) of the wall being drawn. */
  const [wallEnd, setWallEnd] = useState<Point | null>(null);

  // A new set of walls (detected, cleared, or another level) makes the old index meaningless.
  const selectAfterSave = useRef<number | null>(null);
  useEffect(() => {
    setSelectedWall(selectAfterSave.current);
    selectAfterSave.current = null;
  }, [active.id, wallEdit, active.walls]);

  const deleteWall = () => {
    if (selectedWall === null) return;
    props.onWalls?.(active.id, active.walls.filter((_, i) => i !== selectedWall));
    setSelectedWall(null);
  };

  useEffect(() => {
    if (!wallEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement || t.isContentEditable;
      if ((e.key === 'Delete' || e.key === 'Backspace') && !typing) deleteWall();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Refit when the levels shown, the view mode or an image change. Not when only the active level
  // changes while every level is shown (selecting a device elsewhere), nor when a level moves
  // (finishing an alignment), so the view doesn't jump.
  const shownKey = shown.map((f) => `${f.id}:${f.imageVersion}`).join();
  useLayoutEffect(() => {
    const v = fit();
    setView(v);
    setFitWidth(v.w);
  }, [shownKey, mode]);

  useEffect(() => {
    const el = containerRef.current!;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** View units per screen pixel, matching preserveAspectRatio="meet". */
  const k = 1 / Math.min(size.w / view.w, size.h / view.h);

  const toView = (clientX: number, clientY: number): Point => {
    const ctm = svgRef.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm);
    return { x: p.x, y: p.y };
  };

  const zoomAt = (p: Point, factor: number) =>
    setView((v) => {
      const w = Math.min(Math.max(v.w * factor, 2), fitWidth * 4);
      const f = w / v.w;
      return { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w, h: v.h * f };
    });

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(toView(e.clientX, e.clientY), Math.pow(1.0015, e.deltaY));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    // In wall mode the left button draws, so the right or middle button pans.
    const panButton = wallEdit && e.button !== 0;
    if (e.button !== 0 && !panButton) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    const target = e.target as Element;
    const corner = target.closest('[data-corner]')?.getAttribute('data-corner') as Corner | undefined;
    const marker = target.closest('[data-ieee]')?.getAttribute('data-ieee') ?? null;
    const wall = target.closest('[data-wall]')?.getAttribute('data-wall');
    if (wallEdit && !panButton) {
      if (wall !== undefined && wall !== null) {
        setSelectedWall(Number(wall));
      } else {
        setSelectedWall(null);
        setGesture({ kind: 'wall', start, moved: false, from: buildingToImage(active, toView(e.clientX, e.clientY)) });
      }
    } else if (panButton) {
      setGesture({ kind: 'pan', start, view, moved: false, ieee: null });
    } else if (align && corner) {
      setGesture({ kind: 'align-resize', corner, start, rect: align, moved: false });
    } else if (align && target.closest('.align-frame')) {
      setGesture({ kind: 'align-move', start, rect: align, moved: false });
    } else if (marker && edit && !align && !placing && !scalePoints && placements[marker]?.floorId === active.id) {
      setGesture({ kind: 'drag', ieee: marker, start, moved: false });
    } else {
      setGesture({ kind: 'pan', start, view, moved: false, ieee: align ? null : marker });
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (placing || scalePoints) setHover(toView(e.clientX, e.clientY));
    if (!gesture) return;
    const dx = e.clientX - gesture.start.x;
    const dy = e.clientY - gesture.start.y;
    const moved = gesture.moved || Math.hypot(dx, dy) > 4;
    if (moved !== gesture.moved) setGesture({ ...gesture, moved });
    if (!moved) return;
    if (gesture.kind === 'pan') {
      setView({ ...gesture.view, x: gesture.view.x - dx * k, y: gesture.view.y - dy * k });
    } else if (gesture.kind === 'drag') {
      setDrag(clampFraction(active, toView(e.clientX, e.clientY)));
    } else if (gesture.kind === 'wall') {
      setWallEnd(snapWall(gesture.from, buildingToImage(active, toView(e.clientX, e.clientY)), e.shiftKey));
    } else if (gesture.kind === 'align-move') {
      props.onAlign({ ...gesture.rect, x: gesture.rect.x + dx * k, y: gesture.rect.y + dy * k });
    } else {
      props.onAlign(resizeFromCorner(gesture.rect, gesture.corner, toView(e.clientX, e.clientY)));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!gesture) return;
    const p = toView(e.clientX, e.clientY);
    if (gesture.kind === 'wall') {
      // At least a few screen pixels long, so a stray click doesn't add a dot.
      if (gesture.moved && wallEnd && Math.hypot(wallEnd.x - gesture.from.x, wallEnd.y - gesture.from.y) * metresPerPx(active) > 4 * k) {
        const walls = [...active.walls, { x1: gesture.from.x, y1: gesture.from.y, x2: wallEnd.x, y2: wallEnd.y, t: newWallThickness(active) }];
        props.onWalls?.(active.id, walls);
        selectAfterSave.current = walls.length - 1;
      }
      setWallEnd(null);
    } else if (gesture.kind === 'drag') {
      if (gesture.moved && drag) props.onPlace(gesture.ieee, active.id, drag.x, drag.y);
      else props.onSelect(gesture.ieee);
    } else if (gesture.kind === 'pan' && !gesture.moved) {
      if (placing && edit) {
        const f = clampFraction(active, p);
        props.onPlace(placing, active.id, f.x, f.y);
      } else if (scalePoints && edit) {
        props.onScalePoint(buildingToImage(active, p));
      } else if (!align) {
        props.onSelect(gesture.ieee);
      }
    }
    setGesture(null);
    setDrag(null);
  };

  // Levels drawn bottom first; in 2D the active level goes on top.
  const drawOrder = [...shown].reverse();
  if (edit) drawOrder.sort((a, b) => Number(a.id === active.id) - Number(b.id === active.id));

  // Device positions in view units (the dragged one follows the pointer).
  const positions = new Map<string, Point>();
  const levelOf = new Map<string, Floor>();
  for (const floor of drawOrder) {
    for (const [ieee, placement] of Object.entries(placements)) {
      if (placement.floorId !== floor.id) continue;
      const fraction = gesture?.kind === 'drag' && gesture.ieee === ieee && drag ? drag : placement;
      const point = placementPoint(floor, { ...placement, ...fraction });
      positions.set(ieee, project(point, z.get(floor.id)!, mode));
      levelOf.set(ieee, floor);
    }
  }

  const visibleLinks = links.filter((l) => positions.has(l.a) && positions.has(l.b) && linkShown(l, filters));
  // Neighbours placed on levels that aren't drawn, per drawn device; shown as badges.
  const otherLevel = new Map<string, number>();
  for (const l of links) {
    for (const [here, there] of [[l.a, l.b], [l.b, l.a]]) {
      if (positions.has(here) && placements[there] && !positions.has(there)) otherLevel.set(here, (otherLevel.get(here) ?? 0) + 1);
    }
  }

  const name = (ieee: string) => devices.get(ieee)?.name ?? ieee;
  const involvesSelected = (l: NetworkLink) => selected !== null && (l.a === selected || l.b === selected);
  const cursor = ((placing || scalePoints) && edit) || (wallEdit && gesture?.kind !== 'pan') ? 'crosshair' : gesture?.kind === 'pan' && gesture.moved ? 'grabbing' : 'grab';

  return (
    <div className="canvas" ref={containerRef}>
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { setGesture(null); setDrag(null); }}
        onPointerLeave={() => setHover(null)}
        onContextMenu={(e) => wallEdit && e.preventDefault()}
      >
        {drawOrder.map((floor) => {
          const aligning = align && floor.id === active.id;
          const faint = !align && floor.id !== active.id;
          const transform = aligning ? rectTransform(floor, align, z.get(floor.id)!, mode) : floorTransform(floor, z.get(floor.id)!, mode);
          return (
            <g key={floor.id} transform={transform}>
              <image href={floorImageUrl(floor)} width={floor.width} height={floor.height} className={`plan${faint ? ' faint' : ''}${aligning ? ' aligning' : ''}`} />
            </g>
          );
        })}

        {align && (
          <g className="align">
            <rect className="align-frame" x={align.x} y={align.y} width={align.w} height={align.h} strokeWidth={2 * k} strokeDasharray={`${6 * k} ${4 * k}`} />
            {CORNERS.map((c) => (
              <rect
                key={c}
                data-corner={c}
                className={`align-handle ${c}`}
                x={align.x + (c.endsWith('e') ? align.w : 0) - 6 * k}
                y={align.y + (c.startsWith('s') ? align.h : 0) - 6 * k}
                width={12 * k}
                height={12 * k}
                strokeWidth={2 * k}
              />
            ))}
          </g>
        )}

        {!align && !wallEdit && (
          <g className="links">
            {visibleLinks.map((l) => {
              const a = positions.get(l.a)!;
              const b = positions.get(l.b)!;
              const focus = involvesSelected(l);
              const dimmed = selected !== null && !focus;
              const directions = l.reports.map((r) => `${name(r.reporter)} hears ${r.lqi ?? 'not measured'}`).join('\n');
              return (
                <g key={l.id} className={`link ${l.quality}${dimmed ? ' dimmed' : ''}`}>
                  <line
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    strokeWidth={(l.parent ? 3 : 2) * (focus ? 1.5 : 1) * k}
                    strokeDasharray={l.quality === 'unknown' ? `${3 * k} ${5 * k}` : undefined}
                  >
                    <title>{`${name(l.a)} ↔ ${name(l.b)}\n${directions}`}</title>
                  </line>
                  {focus && (
                    <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2} fontSize={12 * k} strokeWidth={3 * k} className="halo" textAnchor="middle" dominantBaseline="middle">
                      {l.lqi ?? '?'}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {scalePoints && scalePoints.length > 0 && edit && (
          <g className="measure">
            {(() => {
              const start = imageToBuilding(active, scalePoints[0]);
              const end = scalePoints[1] ? imageToBuilding(active, scalePoints[1]) : hover;
              return end && <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} strokeWidth={2 * k} strokeDasharray={`${6 * k} ${4 * k}`} />;
            })()}
            {scalePoints.map((p, i) => {
              const b = imageToBuilding(active, p);
              return <circle key={i} cx={b.x} cy={b.y} r={4 * k} />;
            })}
          </g>
        )}

        {!align && !wallEdit && (
          <g className="markers">
            {[...positions].map(([ieee, p]) => {
              const device = devices.get(ieee);
              const r = RADIUS[device?.type ?? 'EndDevice'] * k;
              const cross = otherLevel.get(ieee);
              const other = edit && levelOf.get(ieee)?.id !== active.id;
              return (
                <g
                  key={ieee}
                  data-ieee={ieee}
                  className={`marker ${device?.type ?? 'unknown'} ${device?.status ?? 'missing'}${selected === ieee ? ' selected' : ''}${other ? ' other-level' : ''}`}
                  transform={`translate(${p.x} ${p.y})`}
                >
                  {selected === ieee && <circle className="selection" r={r + 5 * k} strokeWidth={2.5 * k} />}
                  {device?.type === 'Coordinator'
                    ? <rect className="dot" x={-r} y={-r} width={r * 2} height={r * 2} rx={3 * k} strokeWidth={2 * k} />
                    : <circle className="dot" r={r} strokeWidth={2 * k} />}
                  <text y={r + 13 * k} fontSize={12 * k} strokeWidth={3 * k} className="halo" textAnchor="middle">{name(ieee)}</text>
                  {cross && (
                    <text x={r + 3 * k} y={-r} fontSize={11 * k} strokeWidth={3 * k} className="halo cross">
                      ⇅{cross}
                      <title>{`${cross} link${cross > 1 ? 's' : ''} to devices on hidden levels`}</title>
                    </text>
                  )}
                  <title>{`${device ? `${device.name} (${device.type}, ${device.status})` : `${ieee} — not in the last scan`}${other ? ` · ${levelOf.get(ieee)!.name}` : ''}`}</title>
                </g>
              );
            })}
          </g>
        )}

        {wallEdit && (
          <g className="walls" transform={floorTransform(active, z.get(active.id)!, '2d')}>
            {active.walls.map((w, i) => (
              <line
                key={i}
                data-wall={i}
                className={`wall${i === selectedWall ? ' selected' : ''}`}
                x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2}
                // At least 6 screen pixels wide so thin walls can still be clicked.
                strokeWidth={Math.max(w.t, (6 * k) / metresPerPx(active))}
              />
            ))}
            {gesture?.kind === 'wall' && wallEnd && (
              <line className="wall drawing" x1={gesture.from.x} y1={gesture.from.y} x2={wallEnd.x} y2={wallEnd.y} strokeWidth={newWallThickness(active)} />
            )}
          </g>
        )}

        {placing && hover && edit && (
          <circle className="ghost" cx={hover.x} cy={hover.y} r={RADIUS[devices.get(placing)?.type ?? 'EndDevice'] * k} strokeWidth={2 * k} />
        )}
      </svg>

      <div className="zoom">
        <button title="Zoom in" onClick={() => zoomAt({ x: view.x + view.w / 2, y: view.y + view.h / 2 }, 1 / 1.4)}>+</button>
        <button title="Zoom out" onClick={() => zoomAt({ x: view.x + view.w / 2, y: view.y + view.h / 2 }, 1.4)}>−</button>
        <button title="Fit to screen" onClick={() => setView(fit())}>⤢</button>
      </div>

      {edit && active.pxPerMetre && <ScaleBar metresPerScreenPx={k} />}
      {wallEdit && selectedWall !== null && selectedWall < active.walls.length && (
        <button className="wall-delete danger" onClick={deleteWall}>Delete wall</button>
      )}
    </div>
  );
}

function ScaleBar({ metresPerScreenPx }: { metresPerScreenPx: number }) {
  const screenPerMetre = 1 / metresPerScreenPx;
  const metres = NICE_METRES.find((m) => m * screenPerMetre >= 60) ?? NICE_METRES[NICE_METRES.length - 1];
  return (
    <div className="scalebar">
      <div style={{ width: metres * screenPerMetre }} />
      <span>{metres} m</span>
    </div>
  );
}

/** Keeps a new wall horizontal or vertical, unless Shift is held. */
function snapWall(from: Point, to: Point, free: boolean): Point {
  if (free) return to;
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

/** Thickness for a hand-drawn wall: the level's typical wall, or a thin default. */
function newWallThickness(floor: SizedFloor): number {
  const ts = floor.walls.map((w) => w.t).sort((a, b) => a - b);
  return ts.length ? ts[Math.floor(ts.length / 2)] : Math.max(3, floor.width / 150);
}

/** Whether the legend's filters let this link be drawn. */
export function linkShown(l: NetworkLink, filters: LinkFilters): boolean {
  return (l.parent ? filters.parentChild : filters.neighbours) && (filters.unmeasured || l.quality !== 'unknown');
}
