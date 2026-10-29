// The floorplan: image, links and device markers in one SVG whose units are image pixels.
// Pan by dragging the background, zoom with the wheel; markers keep a constant on-screen size.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { floorImageUrl, type Floor, type NetworkDevice, type NetworkLink, type Placement } from './api';

export interface LinkFilters {
  parentChild: boolean;
  neighbours: boolean;
  unmeasured: boolean;
}

export type Point = { x: number; y: number };

interface Props {
  floor: Floor & { width: number; height: number };
  devices: Map<string, NetworkDevice>;
  links: NetworkLink[];
  placements: Record<string, Placement>;
  filters: LinkFilters;
  selected: string | null;
  onSelect: (ieee: string | null) => void;
  /** Device waiting to be placed with the next click, if any. */
  placing: string | null;
  onPlace: (ieee: string, x: number, y: number) => void;
  /** Points (image pixels) picked so far with the scale tool, or null when it's off. */
  scalePoints: Point[] | null;
  onScalePoint: (p: Point) => void;
}

type View = { x: number; y: number; w: number; h: number };
type Gesture =
  | { kind: 'pan'; start: Point; view: View; moved: boolean }
  | { kind: 'drag'; ieee: string; start: Point; moved: boolean };

const RADIUS = { Coordinator: 11, Router: 9, EndDevice: 7 } as const;
const NICE_METRES = [0.5, 1, 2, 5, 10, 20, 50, 100];

export function FloorCanvas(props: Props) {
  const { floor, devices, links, placements, filters, selected, placing, scalePoints } = props;
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fit = (): View => {
    const pad = Math.max(floor.width, floor.height) * 0.03;
    return { x: -pad, y: -pad, w: floor.width + pad * 2, h: floor.height + pad * 2 };
  };
  const [view, setView] = useState<View>(fit);
  const [size, setSize] = useState({ w: 1, h: 1 });
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const [hover, setHover] = useState<Point | null>(null);

  // Refit when switching level or image.
  useLayoutEffect(() => setView(fit()), [floor.id, floor.imageVersion]);

  useEffect(() => {
    const el = containerRef.current!;
    const observer = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /** SVG units (image pixels) per screen pixel, matching preserveAspectRatio="meet". */
  const k = 1 / Math.min(size.w / view.w, size.h / view.h);

  const toImage = (clientX: number, clientY: number): Point => {
    const ctm = svgRef.current!.getScreenCTM()!.inverse();
    const p = new DOMPoint(clientX, clientY).matrixTransform(ctm);
    return { x: p.x, y: p.y };
  };

  const zoomAt = (p: Point, factor: number) =>
    setView((v) => {
      const w = Math.min(Math.max(v.w * factor, floor.width / 25), floor.width * 4);
      const f = w / v.w;
      return { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w, h: v.h * f };
    });

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(toImage(e.clientX, e.clientY), Math.pow(1.0015, e.deltaY));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  });

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    svgRef.current!.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY };
    const marker = (e.target as Element).closest('[data-ieee]');
    if (marker && !placing && !scalePoints) {
      setGesture({ kind: 'drag', ieee: marker.getAttribute('data-ieee')!, start, moved: false });
    } else {
      setGesture({ kind: 'pan', start, view, moved: false });
    }
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (placing || scalePoints) setHover(toImage(e.clientX, e.clientY));
    if (!gesture) return;
    const dx = e.clientX - gesture.start.x;
    const dy = e.clientY - gesture.start.y;
    const moved = gesture.moved || Math.hypot(dx, dy) > 4;
    if (moved !== gesture.moved) setGesture({ ...gesture, moved });
    if (!moved) return;
    if (gesture.kind === 'pan') {
      setView({ ...gesture.view, x: gesture.view.x - dx * k, y: gesture.view.y - dy * k });
    } else {
      setDragPos(clampToImage(toImage(e.clientX, e.clientY)));
    }
  };

  const onPointerUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!gesture) return;
    const p = toImage(e.clientX, e.clientY);
    if (gesture.kind === 'drag') {
      if (gesture.moved && dragPos) props.onPlace(gesture.ieee, dragPos.x / floor.width, dragPos.y / floor.height);
      else props.onSelect(gesture.ieee);
    } else if (!gesture.moved) {
      if (placing) {
        const c = clampToImage(p);
        props.onPlace(placing, c.x / floor.width, c.y / floor.height);
      } else if (scalePoints) {
        props.onScalePoint(p);
      } else {
        props.onSelect(null);
      }
    }
    setGesture(null);
    setDragPos(null);
  };

  const clampToImage = (p: Point): Point => ({
    x: Math.min(floor.width, Math.max(0, p.x)),
    y: Math.min(floor.height, Math.max(0, p.y)),
  });

  // Device positions on this level, in image pixels (the dragged one follows the pointer).
  const positions = new Map<string, Point>();
  for (const [ieee, placement] of Object.entries(placements)) {
    if (placement.floorId === floor.id) positions.set(ieee, { x: placement.x * floor.width, y: placement.y * floor.height });
  }
  if (gesture?.kind === 'drag' && dragPos) positions.set(gesture.ieee, dragPos);

  const visibleLinks = links.filter(
    (l) =>
      positions.has(l.a) && positions.has(l.b) &&
      (l.parent ? filters.parentChild : filters.neighbours) &&
      (filters.unmeasured || l.quality !== 'unknown'),
  );
  // Neighbours placed on other levels, per device on this level.
  const otherLevel = new Map<string, number>();
  for (const l of links) {
    for (const [here, there] of [[l.a, l.b], [l.b, l.a]]) {
      const p = placements[there];
      if (positions.has(here) && p && p.floorId !== floor.id) otherLevel.set(here, (otherLevel.get(here) ?? 0) + 1);
    }
  }

  const name = (ieee: string) => devices.get(ieee)?.name ?? ieee;
  const involvesSelected = (l: NetworkLink) => selected !== null && (l.a === selected || l.b === selected);
  const cursor = placing || scalePoints ? 'crosshair' : gesture?.kind === 'pan' && gesture.moved ? 'grabbing' : 'grab';

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
        onPointerLeave={() => setHover(null)}
      >
        <image href={floorImageUrl(floor)} width={floor.width} height={floor.height} className="plan" />

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

        {scalePoints && scalePoints.length > 0 && (
          <g className="measure">
            {(() => {
              const end = scalePoints[1] ?? hover;
              return end && <line x1={scalePoints[0].x} y1={scalePoints[0].y} x2={end.x} y2={end.y} strokeWidth={2 * k} strokeDasharray={`${6 * k} ${4 * k}`} />;
            })()}
            {scalePoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={4 * k} />)}
          </g>
        )}

        <g className="markers">
          {[...positions].map(([ieee, p]) => {
            const device = devices.get(ieee);
            const r = RADIUS[device?.type ?? 'EndDevice'] * k;
            const cross = otherLevel.get(ieee);
            return (
              <g key={ieee} data-ieee={ieee} className={`marker ${device?.type ?? 'unknown'} ${device?.status ?? 'missing'}${selected === ieee ? ' selected' : ''}`} transform={`translate(${p.x} ${p.y})`}>
                {selected === ieee && <circle className="selection" r={r + 5 * k} strokeWidth={2.5 * k} />}
                {device?.type === 'Coordinator'
                  ? <rect className="dot" x={-r} y={-r} width={r * 2} height={r * 2} rx={3 * k} strokeWidth={2 * k} />
                  : <circle className="dot" r={r} strokeWidth={2 * k} />}
                <text y={r + 13 * k} fontSize={12 * k} strokeWidth={3 * k} className="halo" textAnchor="middle">{name(ieee)}</text>
                {cross && (
                  <text x={r + 3 * k} y={-r} fontSize={11 * k} strokeWidth={3 * k} className="halo cross">
                    ⇅{cross}
                    <title>{`${cross} link${cross > 1 ? 's' : ''} to devices on other levels`}</title>
                  </text>
                )}
                <title>{device ? `${device.name} (${device.type}, ${device.status})` : `${ieee} — not in the last scan`}</title>
              </g>
            );
          })}
        </g>

        {placing && hover && (
          <circle className="ghost" cx={hover.x} cy={hover.y} r={RADIUS[devices.get(placing)?.type ?? 'EndDevice'] * k} strokeWidth={2 * k} />
        )}
      </svg>

      <div className="zoom">
        <button title="Zoom in" onClick={() => zoomAt({ x: view.x + view.w / 2, y: view.y + view.h / 2 }, 1 / 1.4)}>+</button>
        <button title="Zoom out" onClick={() => zoomAt({ x: view.x + view.w / 2, y: view.y + view.h / 2 }, 1.4)}>−</button>
        <button title="Fit to screen" onClick={() => setView(fit())}>⤢</button>
      </div>

      {floor.pxPerMetre && <ScaleBar pxPerMetre={floor.pxPerMetre} k={k} />}
    </div>
  );
}

function ScaleBar({ pxPerMetre, k }: { pxPerMetre: number; k: number }) {
  const screenPerMetre = pxPerMetre / k;
  const metres = NICE_METRES.find((m) => m * screenPerMetre >= 60) ?? NICE_METRES[NICE_METRES.length - 1];
  return (
    <div className="scalebar">
      <div style={{ width: metres * screenPerMetre }} />
      <span>{metres} m</span>
    </div>
  );
}

/** Straight-line distance in metres between two placements on the same scaled level. */
export function distanceMetres(floor: Floor, a: Placement, b: Placement): number | null {
  if (!floor.pxPerMetre || !floor.width || !floor.height || a.floorId !== floor.id || b.floorId !== floor.id) return null;
  return Math.hypot((a.x - b.x) * floor.width, (a.y - b.y) * floor.height) / floor.pxPerMetre;
}
