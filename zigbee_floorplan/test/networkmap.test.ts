import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildNetwork, lqiQuality, type BridgeDevice, type RawLink, type RawNetworkMap, type RawNode } from '../src/server/networkmap.js';

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const realMap: RawNetworkMap = fixture('networkmap.json').data.value;
const realDevices: BridgeDevice[] = fixture('devices.json');
// Last lastSeen in the capture (2026-10-29 13:27 local).
const captureTime = Math.max(...realMap.nodes.map((n) => n.lastSeen ?? 0));

const node = (ieee: string, type: RawNode['type'] = 'Router', lastSeen: number | null = 1000): RawNode => ({
  ieeeAddr: ieee, friendlyName: ieee, type, networkAddress: 1, lastSeen,
});
// `reporter` hears `neighbour` at `lqi`; relationship is the neighbour's role.
const link = (neighbour: string, reporter: string, lqi: number, relationship = 2): RawLink => ({
  source: { ieeeAddr: neighbour, networkAddress: 1 },
  target: { ieeeAddr: reporter, networkAddress: 2 },
  lqi, depth: 1, relationship,
});

describe('lqiQuality', () => {
  it('buckets measured values and treats null as unknown', () => {
    expect(lqiQuality(null)).toBe('unknown');
    expect(lqiQuality(24)).toBe('poor');
    expect(lqiQuality(50)).toBe('fair');
    expect(lqiQuality(99)).toBe('fair');
    expect(lqiQuality(100)).toBe('good');
  });
});

describe('buildNetwork (synthetic)', () => {
  it('merges both directions into one link and keeps the weaker measured lqi', () => {
    const net = buildNetwork({ nodes: [node('a'), node('b')], links: [link('a', 'b', 120), link('b', 'a', 40)] }, { now: 1000 });
    expect(net.links).toHaveLength(1);
    expect(net.links[0]).toMatchObject({ a: 'a', b: 'b', lqi: 40, quality: 'poor' });
    expect(net.links[0].reports).toHaveLength(2);
  });

  it('treats lqi 0 as unmeasured', () => {
    const net = buildNetwork({ nodes: [node('a'), node('b')], links: [link('a', 'b', 0), link('b', 'a', 70)] }, { now: 1000 });
    expect(net.links[0]).toMatchObject({ lqi: 70, quality: 'fair' });
    expect(net.links[0].reports.find((r) => r.reporter === 'b')?.lqi).toBeNull();

    const unmeasured = buildNetwork({ nodes: [node('a'), node('b')], links: [link('a', 'b', 0)] }, { now: 1000 });
    expect(unmeasured.links[0]).toMatchObject({ lqi: null, quality: 'unknown' });
  });

  it('drops duplicate reports from the same reporter', () => {
    const net = buildNetwork({ nodes: [node('a'), node('b')], links: [link('a', 'b', 80), link('a', 'b', 80)] }, { now: 1000 });
    expect(net.links[0].reports).toHaveLength(1);
  });

  it('derives parent and child from either side', () => {
    // b reports a as its parent (0); a reports c as its child (1).
    const net = buildNetwork(
      { nodes: [node('a'), node('b', 'EndDevice'), node('c', 'EndDevice')], links: [link('a', 'b', 90, 0), link('c', 'a', 90, 1)] },
      { now: 1000 },
    );
    expect(net.links.find((l) => l.b === 'b')).toMatchObject({ parent: 'a', child: 'b' });
    expect(net.links.find((l) => l.b === 'c')).toMatchObject({ parent: 'a', child: 'c' });
    expect(net.devices.find((d) => d.ieee === 'a')?.childCount).toBe(2);
  });

  it('ignores self links and links to unknown devices', () => {
    const net = buildNetwork({ nodes: [node('a')], links: [link('a', 'a', 90), link('zz', 'a', 90)] }, { now: 1000 });
    expect(net.links).toHaveLength(0);
    expect(net.summary.ignoredLinks).toBe(2);
  });

  it('classifies unlinked devices by how recently they were seen', () => {
    const day = 24 * 60 * 60 * 1000;
    const now = 10 * day;
    const net = buildNetwork({ nodes: [node('recent', 'EndDevice', now - day + 1), node('old', 'EndDevice', now - day - 1), node('never', 'EndDevice', null)], links: [] }, { now });
    const status = Object.fromEntries(net.devices.map((d) => [d.ieee, d.status]));
    expect(status).toEqual({ recent: 'unlisted', old: 'orphan', never: 'orphan' });
  });
});

describe('buildNetwork (captured network, 2026-10-29)', () => {
  const net = buildNetwork(realMap, { now: captureTime, bridgeDevices: realDevices });
  const byName = (name: string) => net.devices.find((d) => d.name === name)!;
  const linkBetween = (x: string, y: string) =>
    net.links.find((l) => [l.a, l.b].sort().join() === [byName(x).ieee, byName(y).ieee].sort().join());

  it('keeps every device, coordinator first', () => {
    expect(net.devices).toHaveLength(22);
    expect(net.devices[0].type).toBe('Coordinator');
    expect(net.summary.types).toEqual({ Coordinator: 1, Router: 6, EndDevice: 15 });
  });

  it('merges 42 raw reports into one link per device pair', () => {
    const pairs = new Set(realMap.links.map((l) => [l.source.ieeeAddr, l.target.ieeeAddr].sort().join()));
    expect(net.links).toHaveLength(pairs.size);
  });

  it('flags the weak coordinator ↔ workshop_presence backbone', () => {
    const l = linkBetween('Coordinator', 'workshop_presence')!;
    expect(l.lqi).toBe(24);
    expect(l.quality).toBe('poor');
    expect(l.parent).toBe(byName('Coordinator').ieee);
    expect(byName('workshop_presence').childCount).toBeGreaterThanOrEqual(5);
  });

  it('finds orphaned and unlisted devices', () => {
    const named = (status: string) => net.devices.filter((d) => d.status === status).map((d) => d.name).sort();
    expect(named('orphan')).toEqual(['twins_vestibule_motion', 'workshop_main_motion']);
    expect(named('unlisted')).toEqual(['garage_light']);
  });

  it('records routing-table failures on every router', () => {
    const routers = net.devices.filter((d) => d.type === 'Router');
    expect(routers.every((d) => d.scanFailures.includes('routingTable'))).toBe(true);
  });

  it('takes power source and model from the bridge device list', () => {
    expect(byName('Workshop_door_lock')).toMatchObject({ powerSource: 'Battery', model: 'YRD226HA2619' });
  });
});
