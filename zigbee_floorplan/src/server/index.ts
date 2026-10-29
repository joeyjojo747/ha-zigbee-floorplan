// Add-on entry point: HTTP API + web UI on the ingress port.
import { fileURLToPath } from 'node:url';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
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

await app.register(fastifyStatic, { root: fileURLToPath(new URL('../web', import.meta.url)) });

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => void app.close().then(() => process.exit(0)));
}

// Offline mode starts with the captured scan already loaded.
if (!latest && source instanceof FixtureSource) await runScan();

await app.listen({ host: '0.0.0.0', port });
