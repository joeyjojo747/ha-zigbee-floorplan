// Persists add-on state under DATA_DIR (/data in the add-on, which HA backs up).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { BridgeDevice, RawNetworkMap } from './networkmap.js';

export interface ScanRecord {
  takenAt: number;
  map: RawNetworkMap;
  devices: BridgeDevice[];
}

export class Store {
  constructor(private readonly dataDir: string) {}

  async loadLatestScan(): Promise<ScanRecord | null> {
    try {
      return JSON.parse(await readFile(this.path('scans/latest.json'), 'utf8')) as ScanRecord;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async saveLatestScan(scan: ScanRecord): Promise<void> {
    await this.writeAtomic('scans/latest.json', JSON.stringify(scan));
  }

  private path(relative: string): string {
    return join(this.dataDir, relative);
  }

  // Write to a temp file and rename, so a crash mid-write never leaves half a file.
  private async writeAtomic(relative: string, contents: string): Promise<void> {
    const target = this.path(relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(`${target}.tmp`, contents);
    await rename(`${target}.tmp`, target);
  }
}
