// Right-hand panel: the selected device's details, or the device tray for placing devices.
import { useState } from 'react';
import { distanceMetres } from './FloorCanvas';
import type { Floor, NetworkDevice, NetworkLink, Placement } from './api';

const formatTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'never');
const TYPE_LABEL = { Coordinator: 'Coordinator', Router: 'Router', EndDevice: 'End device' } as const;

export function DeviceTray(props: {
  devices: NetworkDevice[];
  placements: Record<string, Placement>;
  floor: Floor | null;
  placing: string | null;
  onStartPlacing: (ieee: string) => void;
  onSelect: (ieee: string) => void;
}) {
  const { devices, placements, floor, placing } = props;
  const [query, setQuery] = useState('');
  const matches = (d: NetworkDevice) => d.name.toLowerCase().includes(query.trim().toLowerCase());
  const unplaced = devices.filter((d) => !placements[d.ieee] && matches(d));
  const here = devices.filter((d) => floor && placements[d.ieee]?.floorId === floor.id && matches(d));

  return (
    <div className="tray">
      <input type="search" placeholder="Find device" value={query} onChange={(e) => setQuery(e.target.value)} />

      <h3>Not placed <span className="muted">({unplaced.length})</span></h3>
      {unplaced.length === 0 && <p className="muted small">{query ? 'No matches.' : 'Every device is on the plan.'}</p>}
      {floor && unplaced.length > 0 && <p className="muted small">Click a device, then click the plan to place it.</p>}
      <ul>
        {unplaced.map((d) => (
          <li key={d.ieee}>
            <button
              className={`device-row${placing === d.ieee ? ' active' : ''}`}
              disabled={!floor}
              onClick={() => props.onStartPlacing(d.ieee)}
            >
              <DeviceIcon device={d} />
              <span className="grow">{d.name}</span>
              {d.status !== 'linked' && <span className={`tag ${d.status}`}>{d.status}</span>}
            </button>
          </li>
        ))}
      </ul>

      {floor && (
        <>
          <h3>On {floor.name} <span className="muted">({here.length})</span></h3>
          <ul>
            {here.map((d) => (
              <li key={d.ieee}>
                <button className="device-row" onClick={() => props.onSelect(d.ieee)}>
                  <DeviceIcon device={d} />
                  <span className="grow">{d.name}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

export function DeviceDetails(props: {
  ieee: string;
  devices: Map<string, NetworkDevice>;
  links: NetworkLink[];
  placements: Record<string, Placement>;
  floors: Floor[];
  onSelect: (ieee: string) => void;
  onMove: (ieee: string) => void;
  onRemove: (ieee: string) => void;
  onClose: () => void;
}) {
  const { ieee, devices, placements, floors } = props;
  const device = devices.get(ieee);
  const placement = placements[ieee];
  const floor = floors.find((f) => f.id === placement?.floorId) ?? null;
  const name = (id: string) => devices.get(id)?.name ?? id;
  const neighbours = props.links
    .filter((l) => l.a === ieee || l.b === ieee)
    .map((l) => ({ link: l, other: l.a === ieee ? l.b : l.a }))
    .sort((x, y) => (x.link.lqi ?? 999) - (y.link.lqi ?? 999));

  return (
    <div className="details">
      <div className="details-head">
        <h3>{device?.name ?? ieee}</h3>
        <button className="icon" title="Close" onClick={props.onClose}>✕</button>
      </div>
      {!device && <p className="muted">This device wasn't in the last scan. It may have been removed from Zigbee2MQTT.</p>}
      {device && (
        <dl>
          <dt>Type</dt><dd>{TYPE_LABEL[device.type]}</dd>
          <dt>Status</dt><dd><span className={`tag ${device.status}`}>{device.status}</span>{device.status === 'orphan' && ' — in no neighbour table and not seen for a day'}{device.status === 'unlisted' && ' — seen recently but in no neighbour table'}</dd>
          <dt>Model</dt><dd>{[device.vendor, device.model].filter(Boolean).join(' ') || '—'}</dd>
          <dt>Power</dt><dd>{device.powerSource ?? '—'}</dd>
          <dt>Last seen</dt><dd>{formatTime(device.lastSeen)}</dd>
          <dt>Level</dt><dd>{floor?.name ?? 'Not placed'}</dd>
          {device.scanFailures.length > 0 && (<><dt>Scan</dt><dd className="muted">No {device.scanFailures.join(', ')} reply</dd></>)}
        </dl>
      )}

      <div className="actions">
        <button onClick={() => props.onMove(ieee)}>{placement ? 'Move' : 'Place'}</button>
        {placement && <button className="secondary" onClick={() => props.onRemove(ieee)}>Remove from plan</button>}
      </div>

      <h3>Links <span className="muted">({neighbours.length}, weakest first)</span></h3>
      {neighbours.length === 0 && <p className="muted small">No links in the last scan.</p>}
      <ul className="neighbours">
        {neighbours.map(({ link, other }) => {
          const role = link.parent === ieee ? 'child' : link.child === ieee ? 'parent' : 'neighbour';
          const otherFloor = floors.find((f) => f.id === placements[other]?.floorId);
          const metres = floor && placement && placements[other] ? distanceMetres(floor, placement, placements[other]) : null;
          const heard = (reporter: string) => link.reports.find((r) => r.reporter === reporter);
          const fmt = (lqi: number | null | undefined) => (lqi === undefined ? '—' : lqi ?? '?');
          return (
            <li key={link.id}>
              <button className="neighbour" onClick={() => props.onSelect(other)}>
                <span className={`tag ${link.quality}`}>{link.lqi ?? '?'}</span>
                <span className="grow">
                  <strong>{name(other)}</strong> <span className="muted">· {role}</span>
                  <br />
                  <span className="muted small">
                    hears it {fmt(heard(ieee)?.lqi)} · heard by it {fmt(heard(other)?.lqi)}
                    {metres !== null && ` · ${metres.toFixed(1)} m`}
                    {otherFloor && otherFloor.id !== floor?.id && ` · on ${otherFloor.name}`}
                    {!otherFloor && ' · not placed'}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DeviceIcon({ device }: { device: NetworkDevice }) {
  return <span className={`device-icon ${device.type}`} title={TYPE_LABEL[device.type]} />;
}
