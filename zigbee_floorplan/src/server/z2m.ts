// Sources of Zigbee2MQTT data: the live broker, or captured files for offline development.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import mqtt, { type MqttClient } from 'mqtt';
import type { BridgeDevice, RawNetworkMap } from './networkmap.js';

export interface Z2mSource {
  readonly mode: 'mqtt' | 'fixture';
  connected(): boolean;
  devices(): BridgeDevice[];
  /** Ask Zigbee2MQTT for a fresh network map. Slow: it queries every router. */
  scan(): Promise<RawNetworkMap>;
}

interface NetworkmapResponse {
  status: 'ok' | 'error';
  data?: { value: RawNetworkMap };
  error?: string;
  transaction?: string;
}

export interface MqttOptions {
  url: string;
  username?: string;
  password?: string;
  baseTopic: string;
  scanTimeoutMs: number;
  log: (msg: string) => void;
}

export class MqttSource implements Z2mSource {
  readonly mode = 'mqtt';
  private readonly client: MqttClient;
  private bridgeDevices: BridgeDevice[] = [];
  private pending: { transaction: string; resolve: (map: RawNetworkMap) => void; reject: (err: Error) => void } | null = null;

  constructor(private readonly options: MqttOptions) {
    const { url, username, password, baseTopic, log } = options;
    this.client = mqtt.connect(url, { username, password, clientId: `zigbee_floorplan_${randomUUID().slice(0, 8)}` });
    this.client.on('connect', () => {
      log(`Connected to MQTT at ${url}`);
      this.client.subscribe([`${baseTopic}/bridge/devices`, `${baseTopic}/bridge/response/networkmap`]);
    });
    this.client.on('error', (err) => log(`MQTT error: ${err.message}`));
    this.client.on('message', (topic, payload) => this.onMessage(topic, payload));
  }

  connected(): boolean {
    return this.client.connected;
  }

  devices(): BridgeDevice[] {
    return this.bridgeDevices;
  }

  scan(): Promise<RawNetworkMap> {
    if (this.pending) return Promise.reject(new Error('A scan is already running'));
    const transaction = randomUUID();
    return new Promise<RawNetworkMap>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`No network map from Zigbee2MQTT after ${this.options.scanTimeoutMs / 1000}s`));
      }, this.options.scanTimeoutMs);
      this.pending = {
        transaction,
        resolve: (map) => { clearTimeout(timer); resolve(map); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      };
      // routes: false — none of the routers in this network answer routing-table requests.
      const request = JSON.stringify({ type: 'raw', routes: false, transaction });
      this.client.publish(`${this.options.baseTopic}/bridge/request/networkmap`, request, (err) => {
        if (err) this.settle(transaction, () => this.pending?.reject(err));
      });
    });
  }

  private onMessage(topic: string, payload: Buffer): void {
    const { baseTopic, log } = this.options;
    let message: unknown;
    try {
      message = JSON.parse(payload.toString());
    } catch {
      log(`Ignoring non-JSON message on ${topic}`);
      return;
    }
    if (topic === `${baseTopic}/bridge/devices`) {
      this.bridgeDevices = message as BridgeDevice[];
    } else if (topic === `${baseTopic}/bridge/response/networkmap`) {
      const response = message as NetworkmapResponse;
      // Responses without our transaction id come from scans started elsewhere (e.g. the Z2M UI).
      if (!this.pending || response.transaction !== this.pending.transaction) return;
      this.settle(response.transaction, () => {
        if (response.status === 'ok' && response.data) this.pending?.resolve(response.data.value);
        else this.pending?.reject(new Error(response.error ?? 'Zigbee2MQTT returned an error'));
      });
    }
  }

  private settle(transaction: string, action: () => void): void {
    if (this.pending?.transaction !== transaction) return;
    action();
    this.pending = null;
  }
}

/** Serves captured `networkmap.json` / `devices.json` so the UI can be built without a broker. */
export class FixtureSource implements Z2mSource {
  readonly mode = 'fixture';

  private constructor(private readonly map: RawNetworkMap, private readonly bridgeDevices: BridgeDevice[]) {}

  static async load(dir: string): Promise<FixtureSource> {
    const read = async (name: string) => JSON.parse(await readFile(join(dir, name), 'utf8'));
    const response = (await read('networkmap.json')) as NetworkmapResponse;
    if (!response.data) throw new Error('Fixture networkmap.json has no data');
    return new FixtureSource(response.data.value, await read('devices.json'));
  }

  connected(): boolean {
    return true;
  }

  devices(): BridgeDevice[] {
    return this.bridgeDevices;
  }

  async scan(): Promise<RawNetworkMap> {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    return this.map;
  }

  /** When the capture was taken, so device ages are judged as they were then. */
  capturedAt(): number {
    return Math.max(...this.map.nodes.map((n) => n.lastSeen ?? 0));
  }
}
