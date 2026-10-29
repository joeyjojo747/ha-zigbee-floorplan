// Placeholder UI for the scaffold: scan control plus device and link tables.
// The floorplan editor replaces the tables in phase 2.
import { useCallback, useEffect, useState } from 'react';
import type { Network } from '../server/networkmap';

interface Status {
  mode: 'mqtt' | 'fixture';
  connected: boolean;
  scanning: boolean;
  lastScanAt: number | null;
  lastError: string | null;
}

type NetworkResponse = Network & { takenAt: number };

// Relative URLs: the page is served under the HA ingress path prefix.
async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json() as Promise<T>;
}

const formatTime = (ms: number | null) => (ms ? new Date(ms).toLocaleString() : 'never');

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [network, setNetwork] = useState<NetworkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await getJson<Status>('api/status');
      setStatus(s);
      if (s && !s.scanning) setNetwork(await getJson<NetworkResponse>('api/network'));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while a scan runs.
  useEffect(() => {
    if (!status?.scanning) return;
    const timer = setInterval(() => void refresh(), 2000);
    return () => clearInterval(timer);
  }, [status?.scanning, refresh]);

  const startScan = async () => {
    const res = await fetch('api/scan', { method: 'POST' });
    if (!res.ok) setError(((await res.json()) as { error: string }).error);
    await refresh();
  };

  const names = new Map(network?.devices.map((d) => [d.ieee, d.name]));
  const links = [...(network?.links ?? [])].sort((x, y) => (x.lqi ?? 999) - (y.lqi ?? 999));

  return (
    <main>
      <header>
        <h1>Zigbee Floorplan</h1>
        <div className="toolbar">
          <span className={`pill ${status?.connected ? 'ok' : 'bad'}`}>
            {status?.mode === 'fixture' ? 'Offline (captured data)' : status?.connected ? 'MQTT connected' : 'MQTT disconnected'}
          </span>
          <span className="muted">Last scan: {formatTime(network?.takenAt ?? null)}</span>
          <button onClick={startScan} disabled={!status?.connected || status.scanning}>
            {status?.scanning ? 'Scanning…' : 'Scan now'}
          </button>
        </div>
      </header>

      {(error || status?.lastError) && <p className="error">{error ?? status?.lastError}</p>}
      {!network && !status?.scanning && <p className="muted">No scan yet. Scanning takes a minute or two and queries every router.</p>}

      {network && (
        <>
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
                  <tr key={d.ieee}>
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
        </>
      )}
    </main>
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
