// Persists add-on state under DATA_DIR (/data in the add-on, which HA backs up).
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { emptyLayout, normaliseLayout, type Layout } from './layout.js';
import type { BridgeDevice, RawNetworkMap } from './networkmap.js';

export interface ScanRecord {
  takenAt: number;
  map: RawNetworkMap;
  devices: BridgeDevice[];
}

export class Store {
  constructor(private readonly dataDir: string) {}

  async loadLatestScan(): Promise<ScanRecord | null> {
    return this.readJson<ScanRecord>('scans/latest.json');
  }

  async saveLatestScan(scan: ScanRecord): Promise<void> {
    await this.writeAtomic('scans/latest.json', JSON.stringify(scan));
  }

  async loadLayout(): Promise<Layout> {
    const stored = await this.readJson<Layout>('layout.json');
    return stored ? normaliseLayout(stored) : emptyLayout();
  }

  async saveLayout(layout: Layout): Promise<void> {
    await this.writeAtomic('layout.json', JSON.stringify(layout, null, 2));
  }

  async saveFloorImage(file: string, contents: Buffer): Promise<void> {
    await this.writeAtomic(this.floorImage(file), contents);
  }

  async deleteFloorImage(file: string): Promise<void> {
    await rm(this.path(this.floorImage(file)), { force: true });
  }

  floorImagePath(file: string): string {
    return this.path(this.floorImage(file));
  }

  // basename() guards against a stored name ever escaping the floors directory.
  private floorImage(file: string): string {
    return join('floors', basename(file));
  }

  private async readJson<T>(relative: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(this.path(relative), 'utf8')) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  private path(relative: string): string {
    return join(this.dataDir, relative);
  }

  // Write to a temp file and rename, so a crash mid-write never leaves half a file.
  private async writeAtomic(relative: string, contents: string | Buffer): Promise<void> {
    const target = this.path(relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.tmp`, contents);
    await rename(`${target}.tmp`, target);
  }
}
