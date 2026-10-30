// The 3D view: each level is a slab textured with its plan, its walls raised to the level's
// height, and the devices and links in the space between. Building metres map to three.js
// as x → X, y → Z and elevation → Y. Renders on demand (after a change or camera move),
// which keeps a phone or a Pi's browser idle while nothing moves.
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { floorImageUrl, type Floor, type NetworkDevice, type NetworkLink, type Placement } from './api';
import { linkShown, type LinkFilters } from './BuildingCanvas';
import { elevations, floorRect, imageToBuilding, metresPerPx, placementPoint, shownLevels, type SizedFloor } from './geometry';
import type { Theme } from './theme';

interface Props {
  floors: Floor[];
  active: SizedFloor;
  /** Ids of the levels turned off (the active level is drawn regardless). */
  hidden: string[];
  theme: Theme;
  devices: Map<string, NetworkDevice>;
  links: NetworkLink[];
  placements: Record<string, Placement>;
  filters: LinkFilters;
  selected: string | null;
  onSelect: (ieee: string | null) => void;
}

/** Height of device markers above their level's floor, in metres. */
const DEVICE_HEIGHT = 1;

interface Stage {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  content: THREE.Group;
  textures: Map<string, THREE.Texture>;
  render: () => void;
}

const cssColour = (name: string) => new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888');

export function ThreeView(props: Props) {
  const { floors, active, hidden, theme, devices, links, placements, filters, selected } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const fittedKey = useRef('');
  const [hover, setHover] = useState<{ name: string; x: number; y: number } | null>(null);
  const onSelect = useRef(props.onSelect);
  onSelect.current = props.onSelect;

  // Renderer, camera and controls live for the component's lifetime.
  useEffect(() => {
    const el = containerRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4);
    sun.position.set(30, 60, 40);
    scene.add(sun);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
    const controls = new OrbitControls(camera, renderer.domElement);
    const content = new THREE.Group();
    scene.add(content);
    const render = () => renderer.render(scene, camera);
    controls.addEventListener('change', render);
    const s: Stage = { renderer, scene, camera, controls, content, textures: new Map(), render };
    stage.current = s;

    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      renderer.setSize(width, height);
      // Fat lines are sized in screen pixels, so they need the new size.
      content.traverse((o) => (o as Line2).material instanceof LineMaterial && ((o as Line2).material.resolution.set(width, height)));
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      render();
    });
    observer.observe(el);

    // Hover shows a device's name; a click (not a drag) selects it, or clears the selection.
    const raycaster = new THREE.Raycaster();
    const pick = (e: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = raycaster.intersectObjects(content.children.filter((o) => o.userData.ieee), false)[0];
      return hit ? (hit.object.userData as { ieee: string; name: string }) : null;
    };
    let down: { x: number; y: number } | null = null;
    const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY });
    const onUp = (e: PointerEvent) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) onSelect.current(pick(e)?.ieee ?? null);
      down = null;
    };
    const onMove = (e: PointerEvent) => {
      const hit = pick(e);
      const r = el.getBoundingClientRect();
      setHover(hit ? { name: hit.name, x: e.clientX - r.left, y: e.clientY - r.top } : null);
      renderer.domElement.style.cursor = hit ? 'pointer' : 'grab';
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointerup', onUp);
    renderer.domElement.addEventListener('pointermove', onMove);

    return () => {
      observer.disconnect();
      fittedKey.current = ''; // a new stage (e.g. after a remount) needs framing again
      controls.dispose();
      clearContent(content);
      for (const t of s.textures.values()) t.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);
      stage.current = null;
    };
  }, []);

  // Rebuild the scene's content whenever what it shows changes.
  useEffect(() => {
    const s = stage.current;
    if (!s) return;
    clearContent(s.content);
    const dark = theme === 'dark';
    const holo = theme === 'hologram';
    const z = elevations(floors);
    const shown = shownLevels(floors, active, hidden);
    const box = new THREE.Box3();
    const unitBox = new THREE.BoxGeometry(1, 1, 1);
    // Hologram draws walls as glowing wireframes: faint additive faces plus bright edges.
    const unitEdges = new THREE.EdgesGeometry(unitBox);
    const additive = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };

    for (const floor of shown) {
      const isActive = floor.id === active.id;
      const elev = z.get(floor.id)!;
      const rect = floorRect(floor);

      // The plan as a floor slab.
      const key = `${floor.id}:${floor.imageVersion}${holo ? ':holo' : ''}`;
      let texture = s.textures.get(key);
      if (!texture) {
        // Redraw the live stage once the image arrives (the scene may have been rebuilt since).
        const redraw = () => requestAnimationFrame(() => stage.current?.render());
        texture = holo ? hologramTexture(floorImageUrl(floor), redraw) : new THREE.TextureLoader().load(floorImageUrl(floor), redraw);
        texture.colorSpace = THREE.SRGBColorSpace;
        s.textures.set(key, texture);
      }
      const slab = new THREE.Mesh(
        new THREE.PlaneGeometry(rect.w, rect.h),
        new THREE.MeshBasicMaterial(holo
          ? { map: texture, side: THREE.DoubleSide, ...additive, opacity: isActive ? 0.9 : 0.35 }
          : {
            map: texture, side: THREE.DoubleSide, transparent: true, opacity: isActive ? 1 : 0.4, depthWrite: isActive,
            color: dark ? 0x8a8a90 : 0xffffff,
          }),
      );
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(rect.x + rect.w / 2, elev, rect.y + rect.h / 2);
      s.content.add(slab);
      box.expandByPoint(new THREE.Vector3(rect.x, elev, rect.y)).expandByPoint(new THREE.Vector3(rect.x + rect.w, elev, rect.y + rect.h));

      // Walls, as tall as the level (1 m for a level of height 0, such as a site plan).
      const wallHeight = floor.floorHeight > 0 ? floor.floorHeight : 1;
      const wallMaterial = holo
        ? new THREE.MeshBasicMaterial({ color: 0x5fe1ff, ...additive, opacity: isActive ? 0.1 : 0.04 })
        : new THREE.MeshLambertMaterial({
          color: dark ? 0x9aa3b2 : 0xd5dae2, transparent: !isActive, opacity: isActive ? 1 : 0.3, depthWrite: isActive,
        });
      const edgeMaterial = holo ? new THREE.LineBasicMaterial({ color: isActive ? 0x9af0ff : 0x2d7fc4, ...additive, opacity: isActive ? 0.9 : 0.5 }) : null;
      for (const w of floor.walls) {
        const a = imageToBuilding(floor, { x: w.x1, y: w.y1 });
        const b = imageToBuilding(floor, { x: w.x2, y: w.y2 });
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length < 0.05) continue;
        const wall = new THREE.Mesh(unitBox, wallMaterial);
        wall.scale.set(length, wallHeight, Math.max(0.08, w.t * metresPerPx(floor)));
        wall.position.set((a.x + b.x) / 2, elev + wallHeight / 2, (a.y + b.y) / 2);
        wall.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
        s.content.add(wall);
        if (edgeMaterial) {
          const edges = new THREE.LineSegments(unitEdges, edgeMaterial);
          edges.scale.copy(wall.scale);
          edges.position.copy(wall.position);
          edges.rotation.copy(wall.rotation);
          s.content.add(edges);
        }
      }
      box.expandByPoint(new THREE.Vector3(rect.x, elev + wallHeight, rect.y));
    }

    // Devices and links.
    const position = new Map<string, THREE.Vector3>();
    for (const [ieee, placement] of Object.entries(placements)) {
      const floor = shown.find((f) => f.id === placement.floorId);
      if (!floor) continue;
      const p = placementPoint(floor, placement);
      position.set(ieee, new THREE.Vector3(p.x, z.get(floor.id)! + DEVICE_HEIGHT, p.y));
    }
    const colourOf = { Coordinator: cssColour('--coordinator'), Router: cssColour('--router'), EndDevice: cssColour('--end-device') };
    const sphere = new THREE.SphereGeometry(0.3, 20, 14);
    const cube = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const halo3d = new THREE.SphereGeometry(0.6, 20, 14);
    for (const [ieee, at] of position) {
      const device = devices.get(ieee);
      const marker = new THREE.Mesh(
        device?.type === 'Coordinator' ? cube : sphere,
        new THREE.MeshBasicMaterial({ color: device ? colourOf[device.type] : cssColour('--unknown') }),
      );
      marker.position.copy(at);
      if (ieee === selected) marker.scale.setScalar(1.7);
      marker.userData = { ieee, name: device?.name ?? ieee };
      s.content.add(marker);
      if (holo) {
        // A soft halo around the marker stands in for bloom, which would cost a render pass.
        const halo = new THREE.Mesh(halo3d, new THREE.MeshBasicMaterial({ color: (marker.material as THREE.MeshBasicMaterial).color, ...additive, opacity: 0.25 }));
        halo.position.copy(at);
        halo.scale.setScalar(ieee === selected ? 1.7 : 1);
        s.content.add(halo);
      }
    }
    const qualityColour = { good: cssColour('--good'), fair: cssColour('--fair'), poor: cssColour('--poor'), unknown: cssColour('--unknown') };
    for (const l of links) {
      const a = position.get(l.a);
      const b = position.get(l.b);
      if (!a || !b || !linkShown(l, filters)) continue;
      const focus = selected !== null && (l.a === selected || l.b === selected);
      const dimmed = selected !== null && !focus;
      if (holo) {
        // WebGL draws plain lines one pixel wide, so hologram links are screen-space fat lines:
        // a bright core and a wide, faint band that reads as glow.
        const width = (l.parent ? 3 : 2) * (focus ? 1.5 : 1);
        const layers = l.quality === 'unknown' ? [[width * 0.75, dimmed ? 0.1 : 0.7]] : [[width, dimmed ? 0.15 : 1], [width * 4, dimmed ? 0.03 : focus ? 0.3 : 0.18]];
        for (const [linewidth, opacity] of layers) {
          const fat = new Line2(new LineGeometry().setPositions([a.x, a.y, a.z, b.x, b.y, b.z]), new LineMaterial({
            color: qualityColour[l.quality].getHex(), linewidth, ...additive, opacity,
            dashed: l.quality === 'unknown', dashSize: 0.3, gapSize: 0.4,
            resolution: s.renderer.getSize(new THREE.Vector2()),
          }));
          fat.computeLineDistances();
          s.content.add(fat);
        }
        continue;
      }
      const options = { color: qualityColour[l.quality], transparent: true, opacity: dimmed ? 0.12 : focus ? 1 : 0.8 };
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([a, b]),
        l.quality === 'unknown' ? new THREE.LineDashedMaterial({ ...options, dashSize: 0.3, gapSize: 0.4 }) : new THREE.LineBasicMaterial(options),
      );
      line.computeLineDistances();
      s.content.add(line);
    }

    // Frame the levels when the set shown changes, not on every rebuild, so selecting a
    // device doesn't move the camera.
    const key = shown.map((f) => f.id).join();
    if (key !== fittedKey.current && !box.isEmpty()) {
      fittedKey.current = key;
      const centre = box.getCenter(new THREE.Vector3());
      const radius = box.getSize(new THREE.Vector3()).length() / 2;
      s.controls.target.copy(centre);
      s.camera.position.set(centre.x + radius * 0.8, centre.y + radius * 1.1, centre.z + radius * 1.3);
      s.camera.far = radius * 20;
      s.camera.updateProjectionMatrix();
      s.controls.update();
    }
    s.render();
  }, [floors, active, hidden, theme, devices, links, placements, filters, selected]);

  return (
    <div className="canvas three" ref={containerRef}>
      {hover && <div className="three-label" style={{ left: hover.x + 12, top: hover.y + 12 }}>{hover.name}</div>}
      <p className="three-help muted small">Drag to orbit · right-drag to pan · scroll to zoom · click a device</p>
    </div>
  );
}

/** Longest side a hologram plan texture is drawn at; plenty for a slab, and quick to recolour. */
const HOLOGRAM_MAX_SIDE = 2048;

/**
 * The plan recoloured as a hologram: the paper goes black and the drawing's lines glow cyan,
 * brightest where the drawing is darkest. Starts empty and fills in once the image loads.
 */
function hologramTexture(url: string, onLoad: () => void): THREE.Texture {
  const texture = new THREE.Texture();
  const image = new Image();
  image.onload = () => {
    const scale = Math.min(1, HOLOGRAM_MAX_SIDE / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = pixels.data;
    for (let i = 0; i < d.length; i += 4) {
      const ink = 255 - (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
      d[i] = ink * 0.37;
      d[i + 1] = ink * 0.88;
      d[i + 2] = ink;
      d[i + 3] = 255;
    }
    ctx.putImageData(pixels, 0, 0);
    texture.image = canvas;
    texture.needsUpdate = true;
    onLoad();
  };
  image.src = url;
  return texture;
}

/** Removes and frees everything in the group except shared plan textures (cached on the stage). */
function clearContent(group: THREE.Group) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  for (const child of group.children) {
    const object = child as THREE.Mesh;
    if (object.geometry) geometries.add(object.geometry);
    for (const m of [object.material].flat()) if (m) materials.add(m as THREE.Material);
  }
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  group.clear();
}
