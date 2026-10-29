// Add, rename, reorder, re-image and delete levels.
import { useState, type FormEvent } from 'react';
import { api, floorImageUrl, type Layout } from './api';

const ACCEPT = 'image/jpeg,image/png,image/webp';

export function LevelsDialog(props: { layout: Layout; onChanged: () => Promise<void>; onClose: () => void }) {
  const { layout } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      await props.onChanged();
      setBusy(false);
    }
  };

  const move = (index: number, delta: number) => {
    const ids = layout.floors.map((f) => f.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    return run(() => api.reorderFloors(ids));
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!newFile) return;
    void run(async () => {
      const floor = await api.addFloor(newName);
      await api.uploadFloorImage(floor.id, newFile);
      setNewName('');
      setNewFile(null);
      (e.target as HTMLFormElement).reset();
    });
  };

  const placedOn = (id: string) => Object.values(layout.placements).filter((p) => p.floorId === id).length;

  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="dialog" role="dialog" aria-label="Levels">
        <div className="details-head">
          <h2>Levels</h2>
          <button className="icon" title="Close" onClick={props.onClose}>✕</button>
        </div>
        {error && <p className="error">{error}</p>}

        <ul className="levels">
          {layout.floors.map((floor, i) => (
            <li key={floor.id}>
              {floor.image ? <img src={floorImageUrl(floor)} alt="" /> : <div className="noimage">No image</div>}
              <div className="grow">
                <input
                  defaultValue={floor.name}
                  aria-label="Level name"
                  onBlur={(e) => e.target.value.trim() !== floor.name && void run(() => api.updateFloor(floor.id, { name: e.target.value }))}
                />
                <div className="muted small">
                  {placedOn(floor.id)} device{placedOn(floor.id) === 1 ? '' : 's'} · {floor.pxPerMetre ? 'scale set' : 'no scale'}
                  {floor.width && ` · ${floor.width}×${floor.height}px`}
                </div>
                <label className="link-button">
                  Replace image
                  <input type="file" accept={ACCEPT} hidden disabled={busy}
                    onChange={(e) => e.target.files?.[0] && void run(() => api.uploadFloorImage(floor.id, e.target.files![0]))} />
                </label>
              </div>
              <div className="level-actions">
                <button className="icon" title="Move up" disabled={busy || i === 0} onClick={() => move(i, -1)}>↑</button>
                <button className="icon" title="Move down" disabled={busy || i === layout.floors.length - 1} onClick={() => move(i, 1)}>↓</button>
                <button
                  className="icon danger"
                  title="Delete level"
                  disabled={busy}
                  onClick={() => {
                    const count = placedOn(floor.id);
                    const warning = count ? ` Its ${count} placed devices will go back to the tray.` : '';
                    if (confirm(`Delete ${floor.name}?${warning}`)) void run(() => api.deleteFloor(floor.id));
                  }}
                >🗑</button>
              </div>
            </li>
          ))}
        </ul>

        <form className="add-level" onSubmit={add}>
          <h3>Add a level</h3>
          <input required placeholder="Name, e.g. Ground floor" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input required type="file" accept={ACCEPT} onChange={(e) => setNewFile(e.target.files?.[0] ?? null)} />
          <button type="submit" disabled={busy || !newName.trim() || !newFile}>Add level</button>
          <p className="muted small">JPEG, PNG or WebP. A sharper image can be swapped in later without losing placements.</p>
        </form>
      </div>
    </div>
  );
}
