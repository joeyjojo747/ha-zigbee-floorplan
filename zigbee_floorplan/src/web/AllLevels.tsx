// Every level side by side, with links between levels drawn across the panels.
// Each panel is a normal FloorCanvas; an overlay measures where the markers are on
// screen and draws the cross-level lines, re-measuring whenever a panel pans or zooms.
import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Floor, NetworkDevice, NetworkLink, Placement } from './api';
import { FloorCanvas, linkShown, type LinkFilters } from './FloorCanvas';

interface Props {
  floors: Floor[];
  devices: Map<string, NetworkDevice>;
  links: NetworkLink[];
  placements: Record<string, Placement>;
  filters: LinkFilters;
  selected: string | null;
  onSelect: (ieee: string | null) => void;
  placing: string | null;
  onPlace: (ieee: string, floorId: string, x: number, y: number) => void;
  onOpenLevel: (floorId: string) => void;
  onManageLevels: () => void;
}

const hasImage = (floor: Floor): floor is Floor & { width: number; height: number } => !!floor.image && !!floor.width && !!floor.height;

export function AllLevels(props: Props) {
  const { floors, placements } = props;
  const gridRef = useRef<HTMLDivElement>(null);
  // The overlay registers its re-measure function here, so panning one panel
  // redraws the overlay without re-rendering every panel.
  const remeasure = useRef<() => void>(() => {});
  const onViewChange = useCallback(() => remeasure.current(), []);
  const columns = floors.length <= 1 ? 1 : floors.length <= 4 ? 2 : 3;

  return (
    <div className="all-levels">
      <div ref={gridRef} className="level-grid" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {floors.map((floor) => (
          <section key={floor.id} className="level-panel">
            <div className="level-panel-head">
              <strong>{floor.name}</strong>
              <span className="muted small">{Object.values(placements).filter((p) => p.floorId === floor.id).length} devices</span>
              <button className="secondary" onClick={() => props.onOpenLevel(floor.id)}>Open</button>
            </div>
            {hasImage(floor) ? (
              <FloorCanvas
                floor={floor}
                devices={props.devices}
                links={props.links}
                placements={placements}
                filters={props.filters}
                selected={props.selected}
                onSelect={props.onSelect}
                placing={props.placing}
                onPlace={props.onPlace}
                scalePoints={null}
                onScalePoint={() => {}}
                crossLevelBadges={false}
                onViewChange={onViewChange}
              />
            ) : (
              <div className="empty">
                <p>No image yet.</p>
                <button onClick={props.onManageLevels}>Upload image</button>
              </div>
            )}
          </section>
        ))}
        <CrossLevelLinks {...props} gridRef={gridRef} remeasure={remeasure} />
      </div>
    </div>
  );
}

type Line = { id: string; x1: number; y1: number; x2: number; y2: number; className: string; focus: boolean; lqi: number | null; title: string };

function CrossLevelLinks(props: Props & { gridRef: RefObject<HTMLDivElement | null>; remeasure: { current: () => void } }) {
  const { links, placements, filters, selected, devices, gridRef, remeasure } = props;
  const [tick, setTick] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  remeasure.current = () => setTick((t) => t + 1);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const origin = grid.getBoundingClientRect();
    const name = (ieee: string) => devices.get(ieee)?.name ?? ieee;

    // Centre of a device's marker relative to the grid, kept inside its panel so a
    // marker panned out of view still gets a line pointing towards it.
    const anchor = (ieee: string, floorId: string) => {
      const panel = grid.querySelector(`[data-floor="${CSS.escape(floorId)}"]`);
      const dot = panel?.querySelector(`[data-ieee="${CSS.escape(ieee)}"] .dot`);
      if (!panel || !dot) return null;
      const p = panel.getBoundingClientRect();
      const d = dot.getBoundingClientRect();
      const x = Math.min(p.right, Math.max(p.left, d.left + d.width / 2));
      const y = Math.min(p.bottom, Math.max(p.top, d.top + d.height / 2));
      return { x: x - origin.left, y: y - origin.top };
    };

    const next: Line[] = [];
    for (const l of links) {
      const pa = placements[l.a];
      const pb = placements[l.b];
      if (!pa || !pb || pa.floorId === pb.floorId || !linkShown(l, filters)) continue;
      const a = anchor(l.a, pa.floorId);
      const b = anchor(l.b, pb.floorId);
      if (!a || !b) continue;
      const focus = selected !== null && (l.a === selected || l.b === selected);
      const dimmed = selected !== null && !focus;
      next.push({
        id: l.id, x1: a.x, y1: a.y, x2: b.x, y2: b.y, focus, lqi: l.lqi,
        className: `link cross ${l.quality}${focus ? ' focus' : ''}${dimmed ? ' dimmed' : ''}`,
        title: `${name(l.a)} ↔ ${name(l.b)}`,
      });
    }
    setLines(next);
  }, [tick, links, placements, filters, selected, devices, gridRef]);

  return (
    <svg className="cross-links" aria-hidden="true">
      {lines.map((l) => (
        <g key={l.id} className={l.className}>
          <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} strokeWidth={l.focus ? 4 : 2.5} strokeDasharray={l.className.includes('unknown') ? '3 5' : undefined} />
          {l.focus && (
            <text x={(l.x1 + l.x2) / 2} y={(l.y1 + l.y2) / 2} fontSize={12} strokeWidth={3} className="halo" textAnchor="middle" dominantBaseline="middle">
              {l.lqi ?? '?'}
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
