// Turns a raw Zigbee2MQTT network map into a model the floorplan can draw.
// See docs/design.md for what the raw fields mean.

export type DeviceType = 'Coordinator' | 'Router' | 'EndDevice';

export interface RawNode {
  ieeeAddr: string;
  friendlyName: string;
  type: DeviceType;
  networkAddress: number;
  lastSeen?: number | null;
  failed?: string[];
  definition?: { model?: string; vendor?: string; description?: string } | null;
}

/** One entry of `target`'s neighbour table: `target` hears `source` at `lqi`. */
export interface RawLink {
  source: { ieeeAddr: string; networkAddress: number };
  target: { ieeeAddr: string; networkAddress: number };
  lqi: number;
  depth: number;
  /** Role of `source` relative to `target`: 0 parent, 1 child, 2 sibling, 3 none, 4 previous child. */
  relationship: number;
}

export interface RawNetworkMap {
  nodes: RawNode[];
  links: RawLink[];
}

/** Entry of the retained `<base_topic>/bridge/devices` message. */
export interface BridgeDevice {
  ieee_address: string;
  friendly_name: string;
  type: string;
  power_source?: string;
  model_id?: string;
  manufacturer?: string;
  definition?: { model?: string; vendor?: string; description?: string } | null;
}

export type Quality = 'good' | 'fair' | 'poor' | 'unknown';
export type DeviceStatus = 'linked' | 'unlisted' | 'orphan';
export type Relationship = 'parent' | 'child' | 'sibling' | 'none' | 'previous_child' | 'unknown';

export interface LinkReport {
  reporter: string;
  neighbour: string;
  /** null when the reporter didn't measure it (raw lqi 0). */
  lqi: number | null;
  relationship: Relationship;
  depth: number;
}

export interface NetworkLink {
  id: string;
  /** Endpoints in sorted order. */
  a: string;
  b: string;
  /** Weakest measured lqi across both directions. */
  lqi: number | null;
  quality: Quality;
  parent: string | null;
  child: string | null;
  reports: LinkReport[];
}

export interface NetworkDevice {
  ieee: string;
  name: string;
  type: DeviceType;
  model: string | null;
  vendor: string | null;
  powerSource: string | null;
  lastSeen: number | null;
  status: DeviceStatus;
  scanFailures: string[];
  linkCount: number;
  childCount: number;
}

export interface Network {
  devices: NetworkDevice[];
  links: NetworkLink[];
  summary: {
    types: Record<DeviceType, number>;
    statuses: Record<DeviceStatus, number>;
    qualities: Record<Quality, number>;
    ignoredLinks: number;
  };
}

export interface BuildOptions {
  /** Reference time for "recently seen", normally when the scan was taken. */
  now: number;
  bridgeDevices?: BridgeDevice[];
  /** How recently an unlinked device must have been seen to count as unlisted rather than orphaned. */
  recentMs?: number;
}

const RELATIONSHIPS: Relationship[] = ['parent', 'child', 'sibling', 'none', 'previous_child'];
const TYPE_ORDER: Record<DeviceType, number> = { Coordinator: 0, Router: 1, EndDevice: 2 };
const DAY_MS = 24 * 60 * 60 * 1000;

export function lqiQuality(lqi: number | null): Quality {
  if (lqi === null) return 'unknown';
  if (lqi >= 100) return 'good';
  if (lqi >= 50) return 'fair';
  return 'poor';
}

export function buildNetwork(map: RawNetworkMap, options: BuildOptions): Network {
  const { now, bridgeDevices = [], recentMs = DAY_MS } = options;
  const known = new Set(map.nodes.map((n) => n.ieeeAddr));
  const bridgeByIeee = new Map(bridgeDevices.map((d) => [d.ieee_address, d]));

  const links = new Map<string, NetworkLink>();
  const seenReports = new Set<string>();
  let ignoredLinks = 0;

  for (const raw of map.links) {
    const neighbour = raw.source.ieeeAddr;
    const reporter = raw.target.ieeeAddr;
    if (neighbour === reporter || !known.has(neighbour) || !known.has(reporter)) {
      ignoredLinks++;
      continue;
    }
    const reportKey = `${reporter}>${neighbour}`;
    if (seenReports.has(reportKey)) continue;
    seenReports.add(reportKey);

    const [a, b] = [neighbour, reporter].sort();
    const id = `${a}|${b}`;
    let link = links.get(id);
    if (!link) {
      link = { id, a, b, lqi: null, quality: 'unknown', parent: null, child: null, reports: [] };
      links.set(id, link);
    }

    const relationship = RELATIONSHIPS[raw.relationship] ?? 'unknown';
    const lqi = raw.lqi > 0 ? raw.lqi : null;
    link.reports.push({ reporter, neighbour, lqi, relationship, depth: raw.depth });

    if (lqi !== null && (link.lqi === null || lqi < link.lqi)) link.lqi = lqi;
    if (!link.parent && relationship === 'parent') [link.parent, link.child] = [neighbour, reporter];
    if (!link.parent && relationship === 'child') [link.parent, link.child] = [reporter, neighbour];
  }

  const linkCount = new Map<string, number>();
  const childCount = new Map<string, number>();
  for (const link of links.values()) {
    link.quality = lqiQuality(link.lqi);
    for (const end of [link.a, link.b]) linkCount.set(end, (linkCount.get(end) ?? 0) + 1);
    if (link.parent) childCount.set(link.parent, (childCount.get(link.parent) ?? 0) + 1);
  }

  const devices: NetworkDevice[] = map.nodes.map((n) => {
    const bridge = bridgeByIeee.get(n.ieeeAddr);
    const definition = n.definition ?? bridge?.definition ?? null;
    const lastSeen = n.lastSeen ?? null;
    const count = linkCount.get(n.ieeeAddr) ?? 0;
    const status: DeviceStatus =
      count > 0 ? 'linked' : lastSeen !== null && now - lastSeen <= recentMs ? 'unlisted' : 'orphan';
    return {
      ieee: n.ieeeAddr,
      name: n.friendlyName,
      type: n.type,
      model: definition?.model ?? bridge?.model_id ?? null,
      vendor: definition?.vendor ?? bridge?.manufacturer ?? null,
      powerSource: bridge?.power_source ?? null,
      lastSeen,
      status,
      scanFailures: n.failed ?? [],
      linkCount: count,
      childCount: childCount.get(n.ieeeAddr) ?? 0,
    };
  });
  devices.sort((x, y) => TYPE_ORDER[x.type] - TYPE_ORDER[y.type] || x.name.localeCompare(y.name));

  const linkList = [...links.values()];
  return {
    devices,
    links: linkList,
    summary: {
      types: countBy(devices, (d) => d.type, { Coordinator: 0, Router: 0, EndDevice: 0 }),
      statuses: countBy(devices, (d) => d.status, { linked: 0, unlisted: 0, orphan: 0 }),
      qualities: countBy(linkList, (l) => l.quality, { good: 0, fair: 0, poor: 0, unknown: 0 }),
      ignoredLinks,
    },
  };
}

function countBy<T, K extends string>(items: T[], key: (item: T) => K, initial: Record<K, number>): Record<K, number> {
  const counts = { ...initial };
  for (const item of items) counts[key(item)]++;
  return counts;
}
