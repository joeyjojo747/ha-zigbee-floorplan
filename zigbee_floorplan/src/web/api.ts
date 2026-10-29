// Typed calls to the add-on API. All URLs are relative: the page is served under the HA ingress prefix.
import type { Floor, Layout, Placement } from '../server/layout';
import type { Network } from '../server/networkmap';

export type { Floor, Layout, Placement };
export type { Network, NetworkDevice, NetworkLink, Quality } from '../server/networkmap';

export interface Status {
  mode: 'mqtt' | 'fixture';
  connected: boolean;
  scanning: boolean;
  lastScanAt: number | null;
  lastError: string | null;
}

export type NetworkResponse = Network & { takenAt: number };

async function request<T>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  const isJson = body !== undefined && !(body instanceof Blob);
  const res = await fetch(url, {
    method,
    headers: isJson ? { 'content-type': 'application/json', ...headers } : headers,
    body: isJson ? JSON.stringify(body) : (body as Blob | undefined),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => null) as { error?: string } | null;
    throw new Error(error?.error ?? `${method} ${url} failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : (res.json() as Promise<T>);
}

export const api = {
  status: () => request<Status>('GET', 'api/status'),
  network: () => request<NetworkResponse>('GET', 'api/network').catch(() => null),
  scan: () => request<void>('POST', 'api/scan', {}),
  layout: () => request<Layout>('GET', 'api/layout'),
  addFloor: (name: string) => request<Floor>('POST', 'api/floors', { name }),
  updateFloor: (id: string, patch: { name?: string; pxPerMetre?: number | null; x?: number; y?: number; floorHeight?: number }) => request<Floor>('PATCH', `api/floors/${id}`, patch),
  reorderFloors: (ids: string[]) => request<Layout>('PUT', 'api/floors/order', { ids }),
  deleteFloor: (id: string) => request<void>('DELETE', `api/floors/${id}`),
  uploadFloorImage: async (id: string, file: File) => {
    const { width, height } = await imageSize(file);
    return request<Floor>('PUT', `api/floors/${id}/image?width=${width}&height=${height}`, file, { 'content-type': file.type });
  },
  place: (ieee: string, placement: Placement) => request<Placement>('PUT', `api/placements/${encodeURIComponent(ieee)}`, placement),
  unplace: (ieee: string) => request<void>('DELETE', `api/placements/${encodeURIComponent(ieee)}`),
};

export const floorImageUrl = (floor: Floor) => `api/floors/${floor.id}/image?v=${floor.imageVersion}`;

async function imageSize(file: File): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}
