// List view: summary cards plus device and link tables.
import type { NetworkResponse } from './api';

const formatTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'never');

export function Tables({ network, onSelect }: { network: NetworkResponse; onSelect: (ieee: string) => void }) {
  const names = new Map(network.devices.map((d) => [d.ieee, d.name]));
  const links = [...network.links].sort((x, y) => (x.lqi ?? 999) - (y.lqi ?? 999));

  return (
    <div className="tables">
      <section className="cards">
        <Card label="Devices" value={network.devices.length} detail={`${network.summary.types.Router} routers · ${network.summary.types.EndDevice} end devices`} />
        <Card label="Links" value={network.links.length} detail={`${network.summary.qualities.poor} poor · ${network.summary.qualities.unknown} unmeasured`} />
        <Card label="Orphaned" value={network.summary.statuses.orphan} detail={`${network.summary.statuses.unlisted} seen but not in any table`} />
      </section>

      <section>
        <h2>Devices</h2>
        <table>
          <thead>
            <tr><th>Name</th><th>Type</th><th>Status</th><th>Links</th><th>Children</th><th>Power</th><th>Model</th><th>Last seen</th></tr>
          </thead>
          <tbody>
            {network.devices.map((d) => (
              <tr key={d.ieee} className="clickable" onClick={() => onSelect(d.ieee)}>
                <td>{d.name}</td>
                <td>{d.type}</td>
                <td><span className={`tag ${d.status}`}>{d.status}</span></td>
                <td className="num">{d.linkCount}</td>
                <td className="num">{d.childCount || ''}</td>
                <td>{d.powerSource}</td>
                <td>{d.model}</td>
                <td className="muted">{formatTime(d.lastSeen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Links <span className="muted">(weakest first)</span></h2>
        <table>
          <thead>
            <tr><th>Between</th><th>Weakest LQI</th><th>Each direction</th><th>Parent → child</th></tr>
          </thead>
          <tbody>
            {links.map((l) => (
              <tr key={l.id}>
                <td>{names.get(l.a)} ↔ {names.get(l.b)}</td>
                <td><span className={`tag ${l.quality}`}>{l.lqi ?? '—'}</span></td>
                <td className="muted">
                  {l.reports.map((r) => `${names.get(r.reporter)} hears ${r.lqi ?? '?'}`).join(' · ')}
                </td>
                <td className="muted">{l.parent ? `${names.get(l.parent)} → ${names.get(l.child!)}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Card({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <div className="card">
      <div className="muted">{label}</div>
      <div className="value">{value}</div>
      <div className="muted small">{detail}</div>
    </div>
  );
}
