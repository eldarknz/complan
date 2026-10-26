import * as THREE from 'three';
import { catalogById, type CatalogItem } from './catalog.js';

export interface Port {
  id: string;
  name: string;
  diameter: number;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  socket: boolean;
  depth: number;
}

export const pipeColors = [
  { id: 'orange', name: 'Оранжевый', hex: '#e25a12' },
  { id: 'white', name: 'Белый', hex: '#f4f5f2' },
  { id: 'gray', name: 'Серый', hex: '#969b9e' },
  { id: 'black', name: 'Черный', hex: '#2a2c2f' },
];
export const pipeColorById = new Map(pipeColors.map((color) => [color.id, color]));
export const defaultPipeColor = 'gray';
const colorableKinds = new Set(['pipe', 'elbow', 'tee', 'cross', 'coupling', 'reducer', 'cap', 'inspection', 'vacuum', 'check', 'drain', 'funnel']);
export const supportsPipeColor = (item: CatalogItem | null | undefined) => !!item && colorableKinds.has(item.kind);

const xAxis = new THREE.Vector3(1, 0, 0);
const plastics = new Map(pipeColors.map((color) => [color.id, new THREE.MeshStandardMaterial({ color: color.hex, roughness: .43, metalness: .06, side: THREE.DoubleSide })]));
const plastic = plastics.get(defaultPipeColor);
const rubber = new THREE.MeshStandardMaterial({ color: '#303734', roughness: .9 });
const metal = new THREE.MeshStandardMaterial({ color: '#afb7b8', roughness: .3, metalness: .75 });
const fire = new THREE.MeshStandardMaterial({ color: '#ac5344', roughness: .5, metalness: .3 });
const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const depth = (diameter: number) => diameter === 110 ? 60 : 30;
const port = (id: string, name: string, diameter: number, position: THREE.Vector3, direction: THREE.Vector3, socket = true): Port => ({ id, name, diameter, position, direction, socket, depth: socket ? depth(diameter) : 0 });

export function getPorts(item: CatalogItem, length = item.length): Port[] {
  if (item.accessory) return [];
  const input = port('in', 'Гладкий конец', item.diameter, v(), v(-1), false);
  if (item.kind === 'coupling') { input.socket = true; input.depth = depth(item.diameter); input.name = 'Раструб A'; }
  if (['cap', 'drain', 'funnel', 'toilet', 'vacuum'].includes(item.kind)) return [input];
  let end = v(length), direction = v(1);
  if (item.kind === 'elbow') {
    const angle = THREE.MathUtils.degToRad(item.angle);
    const radius = item.diameter;
    const lead = item.diameter * .7;
    direction = v(Math.cos(angle), Math.sin(angle));
    end = v(lead + radius * Math.sin(angle), radius * (1 - Math.cos(angle))).addScaledVector(direction, lead);
  }
  const ports = [input, port('out', 'Прямой выход', item.outlet || item.diameter, end, direction)];
  if (item.eccentric) ports[1].position.z = (item.diameter - item.outlet) / 2;
  if (item.plain) { ports[1].socket = false; ports[1].depth = 0; ports[1].name = 'Гладкий конец B'; input.name = 'Гладкий конец A'; }
  if (item.kind === 'elbow') ports[1].name = `Выход ${item.angle}°`;
  if (item.kind === 'tee' || item.kind === 'cross') {
    const angle = THREE.MathUtils.degToRad(item.angle);
    const direction = v(Math.cos(angle), Math.sin(angle));
    ports.push(port('branch', `Боковой выход ${item.angle}°`, item.branch, v(length * .45).addScaledVector(direction, item.diameter * .65 + item.branch), direction));
    if (item.kind === 'cross') {
      const opposite = item.twoPlane ? v(Math.cos(angle), 0, Math.sin(angle)) : v(Math.cos(angle), -Math.sin(angle));
      ports[2].name = `Боковой выход A · ${item.angle}°`;
      ports.push(port('branch-b', `Боковой выход B · ${item.angle}°`, item.branch, v(length * .45).addScaledVector(opposite, item.diameter * .65 + item.branch), opposite));
    }
  }
  return ports;
}

export function compatiblePorts(a: Port | undefined, b: Port | undefined) {
  return !!a && !!b && a.diameter === b.diameter && a.socket !== b.socket;
}

export function connectionPose(source: THREE.Object3D, sourcePort: Port, targetItem: CatalogItem, targetLength = targetItem.length, targetPortId = 'in', roll = 0) {
  const input = getPorts(targetItem, targetLength).find((port) => port.id === targetPortId);
  if (!compatiblePorts(sourcePort, input) || !Number.isFinite(roll)) return null;
  const direction = sourcePort.direction.clone().applyQuaternion(source.quaternion);
  const quaternion = source.quaternion.clone().multiply(new THREE.Quaternion().setFromUnitVectors(input.direction.clone().negate(), sourcePort.direction));
  quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(direction, THREE.MathUtils.degToRad(roll)));
  const insertion = sourcePort.socket ? sourcePort.depth : input.depth;
  const position = sourcePort.position.clone().applyQuaternion(source.quaternion).add(source.position)
    .addScaledVector(direction, -insertion).sub(input.position.clone().applyQuaternion(quaternion));
  return { position, quaternion, insertion };
}

function lathe(profile: number[][]) {
  const geometry = new THREE.LatheGeometry(profile.map(([x, radius]) => new THREE.Vector2(radius, x)), 48);
  geometry.rotateZ(-Math.PI / 2);
  return geometry;
}

export function buildElement(typeId: string, length?: number, color = defaultPipeColor) {
  const item = catalogById.get(typeId);
  if (!item) throw new Error('Неизвестный элемент');
  length ??= item.length;
  const group = new THREE.Group();
  const colorId = supportsPipeColor(item) ? (pipeColorById.has(color) ? color : defaultPipeColor) : undefined;
  group.userData = colorId ? { typeId, length, color: colorId } : { typeId, length };
  const body = plastics.get(colorId || defaultPipeColor);
  const d = item.diameter, r = d / 2, wall = d === 110 ? 3.2 : 2;
  function mesh(geometry: THREE.BufferGeometry, position = v(), direction = xAxis, material = body) {
    const object = new THREE.Mesh(geometry, material);
    object.position.copy(position);
    object.quaternion.setFromUnitVectors(xAxis, direction);
    object.castShadow = true;
    object.receiveShadow = true;
    group.add(object);
    return object;
  }
  function tube(start: THREE.Vector3, end: THREE.Vector3, diameter = d, material = body) {
    const len = start.distanceTo(end), radius = diameter / 2, inner = radius - wall;
    return mesh(lathe([[0, radius], [len, radius], [len, inner], [0, inner], [0, radius]]), start, end.clone().sub(start).normalize(), material);
  }
  function socket(position: THREE.Vector3, direction: THREE.Vector3, diameter = d) {
    const len = depth(diameter), radius = diameter / 2;
    mesh(lathe([[0, radius], [6, radius + 6], [len, radius + 6], [len, radius + .7], [6, radius + .7], [0, radius]]), position.clone().addScaledVector(direction, -len), direction);
  }
  function disk(position: THREE.Vector3, radius: number, thickness: number, direction = xAxis, material = body) {
    const geometry = new THREE.CylinderGeometry(radius, radius, thickness, 48);
    geometry.rotateZ(-Math.PI / 2);
    return mesh(geometry, position, direction, material);
  }
  function box(position: THREE.Vector3, size: [number, number, number], material = metal) { return mesh(new THREE.BoxGeometry(...size), position, xAxis, material); }
  const ports = getPorts(item, length);
  switch (item.kind) {
    case 'pipe': {
      if (item.plain) { tube(v(), v(length)); break; }
      const s = item.socketDepth || depth(d);
      mesh(lathe([[0, r - 1], [5, r], [length - s - 12, r], [length - s, r + 6], [length, r + 6], [length, r + .7], [length - s, r + .7], [length - s - 12, r - wall], [0, r - wall], [0, r - 1]]));
      break;
    }
    case 'tee':
    case 'cross':
    case 'inspection': {
      tube(v(), v(length)); socket(v(length), v(1));
      const direction = item.kind !== 'inspection' ? ports[2].direction : v(0, 1);
      const start = v(length * .45);
      const end = item.kind !== 'inspection' ? ports[2].position : start.clone().addScaledVector(direction, d);
      tube(start, end, item.branch || d);
      socket(end, direction, item.branch || d);
      if (item.kind === 'cross') {
        tube(start, ports[3].position, item.branch);
        socket(ports[3].position, ports[3].direction, item.branch);
      }
      if (item.kind === 'inspection') {
        disk(end, r + 9, 12, direction);
        box(end.clone().add(v(0, 9)), [d * .65, 10, 12], body);
      }
      break;
    }
    case 'elbow': {
      const angle = THREE.MathUtils.degToRad(item.angle), lead = d * .7;
      const path = new THREE.CurvePath<THREE.Vector3>();
      path.add(new THREE.LineCurve3(v(), v(lead)));
      class Arc extends THREE.Curve<THREE.Vector3> {
        constructor() { super(); }
        getPoint(t: number, target = v()) { return target.set(lead + d * Math.sin(t * angle), d * (1 - Math.cos(t * angle)), 0); }
      }
      const arc = new Arc();
      path.add(arc);
      path.add(new THREE.LineCurve3(arc.getPoint(1), ports[1].position));
      mesh(new THREE.TubeGeometry(path, 48, r, 48, false));
      mesh(new THREE.TubeGeometry(path, 48, r - wall, 48, false));
      socket(ports[1].position, ports[1].direction);
      mesh(lathe([[0, r], [0, r - wall]]));
      break;
    }
    case 'coupling':
      tube(v(), v(length), d + 14);
      socket(v(), v(-1)); socket(v(length), v(1));
      if (item.cuff) tube(v(8), v(25), d + 18, rubber);
      break;
    case 'cap':
      tube(v(), v(length)); disk(v(length - 4), r + 4, 8);
      break;
    case 'reducer': {
      const endR = item.outlet / 2;
      const geometry = lathe([[0, r], [25, r], [length - 35, endR], [length, endR], [length, endR - 2], [length - 35, endR - 2], [25, r - wall], [0, r - wall], [0, r]]);
      if (item.eccentric) {
        const positions = geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) positions.setZ(i, positions.getZ(i) + THREE.MathUtils.clamp((positions.getX(i) - 25) / (length - 60), 0, 1) * (r - endR));
        geometry.computeVertexNormals();
      }
      mesh(geometry);
      socket(ports[1].position, v(1), item.outlet);
      if (item.internal) tube(v(5), v(15), d + 3, rubber);
      break;
    }
    case 'toilet':
      tube(v(), v(length * .5));
      mesh(lathe([[length * .4, r], [length * .6, r + 10], [length, r + 10], [length, r - 3], [length * .6, r - 3], [length * .4, r - wall], [length * .4, r]]), v(), xAxis, rubber);
      for (let x = length * .65; x < length; x += 9) tube(v(x), v(x + 3), d + 24, rubber);
      break;
    case 'clamp':
    case 'fire': {
      tube(v(), v(length), d + 8, rubber);
      tube(v(2), v(length - 2), d + (item.kind === 'fire' ? 30 : 16), item.kind === 'fire' ? fire : item.plastic ? plastic : metal);
      for (const side of [-1, 1]) {
        box(v(length / 2, side * (r + 18)), [length, 30, 8]);
        disk(v(length / 2, side * (r + 25), 6), 5, 12, v(0, 0, 1), metal);
      }
      if (item.kind === 'clamp') box(v(length / 2, 0, -r - 40), [9, 9, 70]);
      else for (const side of [-1, 1]) box(v(length - 5, 0, side * (r + 22)), [15, 22, 40]);
      break;
    }
    case 'sleeve':
      mesh(lathe([[0, 80], [length, 80], [length, 75], [0, 75], [0, 80]]), v(), xAxis, metal);
      break;
    case 'roof': {
      mesh(lathe([[0, 130], [length * .6, r + 12], [length, r + 8], [length, r + 2], [length * .6, r + 6], [0, 120], [0, 130]]), v(), xAxis, rubber);
      const shape = new THREE.Shape();
      shape.moveTo(-180, -180); shape.lineTo(180, -180); shape.lineTo(180, 180); shape.lineTo(-180, 180); shape.closePath();
      const hole = new THREE.Path(); hole.absarc(0, 0, 120, 0, Math.PI * 2, true); shape.holes.push(hole);
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: 5, bevelEnabled: false }); geometry.rotateY(Math.PI / 2);
      mesh(geometry, v(), xAxis, metal);
      break;
    }
    case 'drain':
      tube(v(), v(90)); tube(v(90, 0), v(90, 65), 80);
      box(v(90, 52), [110, 18, 110], body);
      for (let z = -45; z <= 45; z += 15) box(v(90, 65, z), [105, 5, 7]);
      disk(v(90, 25), 35, 5, v(0, 1), rubber);
      break;
    case 'funnel':
      tube(v(), v(45)); tube(v(45), v(45, 45));
      mesh(lathe([[0, r], [35, r], [95, 65], [95, 61], [35, r - wall], [0, r - wall], [0, r]]), v(45, 25), v(0, 1));
      break;
    case 'vacuum':
      tube(v(), v(length * .6));
      tube(v(length * .4), v(length), d * 1.5);
      disk(v(length), r * 1.6, 10);
      for (let x = length * .6; x < length; x += 12) tube(v(x), v(x + 4), d * 1.6);
      break;
    case 'check':
      tube(v(), v(length)); socket(v(length), v(1));
      tube(v(length * .2), v(length * .75), d * 1.5);
      box(v(length * .5, r * 1.6), [d * 1.4, 12, d], body);
      box(v(length * .5, r * 1.6 + 12), [30, 12, 12], fire);
      break;
  }
  return group;
}

export function disposeElement(group: THREE.Object3D) {
  group.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
}
