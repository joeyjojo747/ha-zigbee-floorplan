// Add-on entry point: HTTP API + web UI on the ingress port.
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import {
  addFloor, deleteFloor, IMAGE_TYPES, LayoutError, removePlacement, reorderFloors, setFloorImage, setPlacement, setWalls, updateFloor,
  type Layout,
} from './layout.js';
import { buildNetwork } from './networkmap.js';
import { Store, type ScanRecord } from './store.js';
import { FixtureSource, MqttSource, type Z2mSource } from './z2m.js';

const env = process.env;
const port = Number(env.PORT ?? 8099);
const store = new Store(env.DATA_DIR ?? '/data');
const app = Fastify({ logger: { level: env.LOG_LEVEL ?? 'info' } });
const log = (msg: string) => app.log.info(msg);

async function createSource(): Promise<Z2mSource> {
  if (env.MQTT_HOST) {
    return new MqttSource({
      url: `mqtt://${env.MQTT_HOST}:${env.MQTT_PORT ?? 1883}`,
      username: env.MQTT_USERNAME || undefined,
      password: env.MQTT_PASSWORD || undefined,
      baseTopic: env.BASE_TOPIC ?? 'zigbee2mqtt',
      scanTimeoutMs: Number(env.SCAN_TIMEOUT_SECONDS ?? 300) * 1000,
      log,
    });
  }
  if (env.FIXTURE_DIR) return FixtureSource.load(env.FIXTURE_DIR);
  throw new Error('Set MQTT_HOST (normal) or FIXTURE_DIR (offline development)');
}

const source = await createSource();
let latest: ScanRecord | null = await store.loadLatestScan();
let scanning = false;
let lastError: string | null = null;

async function runScan(): Promise<void> {
  scanning = true;
  lastError = null;
  try {
    const map = await source.scan();
    const takenAt = source instanceof FixtureSource ? source.capturedAt() : Date.now();
    latest = { takenAt, map, devices: source.devices() };
    await store.saveLatestScan(latest);
    log(`Network scan complete: ${map.nodes.length} devices, ${map.links.length} links`);
  } catch (err) {
    lastError = (err as Error).message;
    app.log.error(`Network scan failed: ${lastError}`);
  } finally {
    scanning = false;
  }
}

app.get('/api/status', async () => ({
  mode: source.mode,
  connected: source.connected(),
  scanning,
  lastScanAt: latest?.takenAt ?? null,
  lastError,
}));

app.get('/api/network', async (_req, reply) => {
  if (!latest) return reply.code(404).send({ error: 'No scan yet' });
  return { takenAt: latest.takenAt, ...buildNetwork(latest.map, { now: latest.takenAt, bridgeDevices: latest.devices }) };
});

app.post('/api/scan', async (_req, reply) => {
  if (scanning) return reply.code(409).send({ error: 'A scan is already running' });
  if (!source.connected()) return reply.code(503).send({ error: 'Not connected to MQTT' });
  void runScan();
  return reply.code(202).send({ started: true });
});

// ---- Layout -------------------------------------------------------------

let layout: Layout = await store.loadLayout();
let layoutQueue: Promise<unknown> = Promise.resolve();

/** Applies a change to a copy of the layout and saves it; changes run one at a time. */
function changeLayout<T>(change: (draft: Layout) => T | Promise<T>): Promise<T> {
  const run = layoutQueue.then(async () => {
    const draft = structuredClone(layout);
    const result = await change(draft);
    await store.saveLayout(draft);
    layout = draft;
    return result;
  });
  layoutQueue = run.catch(() => undefined);
  return run;
}

app.setErrorHandler((err, _req, reply) => {
  if (err instanceof LayoutError) return reply.code(err.statusCode).send({ error: err.message });
  const statusCode = (err as { statusCode?: number }).statusCode ?? 500;
  if (statusCode >= 500) app.log.error(err);
  return reply.code(statusCode).send({ error: (err as Error).message });
});

// Floor images are sent as the raw request body.
app.addContentTypeParser(Object.keys(IMAGE_TYPES), { parseAs: 'buffer', bodyLimit: 15 * 1024 * 1024 }, (_req, body, done) =>
  done(null, body),
);

type FloorParams = { Params: { id: string } };

app.get('/api/layout', async () => layout);

app.post<{ Body: { name?: unknown } }>('/api/floors', async (req, reply) => {
  const floor = await changeLayout((draft) => addFloor(draft, req.body?.name));
  return reply.code(201).send(floor);
});

app.patch<FloorParams & { Body: { name?: unknown; pxPerMetre?: unknown; x?: unknown; y?: unknown; floorHeight?: unknown } }>('/api/floors/:id', async (req) =>
  changeLayout((draft) => updateFloor(draft, req.params.id, req.body ?? {})),
);

app.put<FloorParams & { Body: unknown }>('/api/floors/:id/walls', async (req) => changeLayout((draft) => setWalls(draft, req.params.id, req.body)));

app.put<{ Body: { ids?: unknown } }>('/api/floors/order', async (req) => {
  await changeLayout((draft) => reorderFloors(draft, req.body?.ids));
  return layout;
});

app.delete<FloorParams>('/api/floors/:id', async (req, reply) => {
  const image = await changeLayout((draft) => deleteFloor(draft, req.params.id));
  if (image) await store.deleteFloorImage(image);
  return reply.code(204).send();
});

app.put<FloorParams & { Querystring: { width?: string; height?: string }; Body: Buffer }>('/api/floors/:id/image', async (req) => {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new LayoutError(400, 'Send the image as the request body');
  return changeLayout(async (draft) => {
    const { floor, replaced } = setFloorImage(draft, req.params.id, {
      contentType: req.headers['content-type'] ?? '',
      width: Number(req.query.width),
      height: Number(req.query.height),
    });
    await store.saveFloorImage(floor.image!, req.body);
    if (replaced) await store.deleteFloorImage(replaced);
    return floor;
  });
});

app.get<FloorParams>('/api/floors/:id/image', async (req, reply) => {
  const floor = layout.floors.find((f) => f.id === req.params.id);
  if (!floor?.image) throw new LayoutError(404, 'This level has no image');
  // The UI adds ?v=<imageVersion>, so a given URL never changes content.
  const path = store.floorImagePath(floor.image);
  return reply.sendFile(basename(path), dirname(path), { maxAge: '365d', immutable: true });
});

app.put<{ Params: { ieee: string }; Body: { floorId?: unknown; x?: unknown; y?: unknown } }>('/api/placements/:ieee', async (req) =>
  changeLayout((draft) => setPlacement(draft, req.params.ieee, req.body ?? {})),
);

app.delete<{ Params: { ieee: string } }>('/api/placements/:ieee', async (req, reply) => {
  await changeLayout((draft) => removePlacement(draft, req.params.ieee));
  return reply.code(204).send();
});

await app.register(fastifyStatic, { root: fileURLToPath(new URL('../web', import.meta.url)) });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}

// Offline mode starts with the captured scan already loaded.
if (!latest && source instanceof FixtureSource) await runScan();

await app.listen({ host: '0.0.0.0', port });
