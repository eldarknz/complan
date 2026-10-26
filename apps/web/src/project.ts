import { catalogById } from './catalog.js';
import * as THREE from 'three';
import { Connections, findPort } from './connections.js';
import { defaultPipeColor, pipeColorById, supportsPipeColor } from './elements.js';

export interface ProjectElement {
  typeId: string;
  length: number;
  position: number[];
  quaternion: number[];
  color?: string;
}

export interface BillRow {
  typeId: string;
  length: number;
  quantity: number;
  name: string;
  kind: string;
  showLength: boolean;
}

type BillElement = { userData?: { typeId?: string; length?: number; color?: string }; typeId?: string; length?: number; color?: string };

export function serializeProject(elements: THREE.Object3D[], connections = new Connections()) {
  return {
    version: 3,
    units: 'mm',
    elements: elements.map((element) => {
      const record: ProjectElement = { typeId: element.userData.typeId, length: element.userData.length, position: element.position.toArray(), quaternion: element.quaternion.toArray() };
      if (element.userData.color) record.color = element.userData.color;
      return record;
    }),
    connections: connections.edges.map((edge) => ({ a: elements.indexOf(edge.a), ap: edge.ap, b: elements.indexOf(edge.b), bp: edge.bp })),
  };
}

/** Сводка размещенных элементов: имя, длина (для труб) и количество. */
export function summarizeBillOfMaterials(elements: BillElement[]): BillRow[] {
  const counts = new Map<string, BillRow>();
  for (const element of elements) {
    const typeId = element.userData?.typeId ?? element.typeId;
    const length = element.userData?.length ?? element.length;
    const color = element.userData?.color ?? element.color;
    const key = `${typeId}:${length}:${color || ''}`;
    const current = counts.get(key);
    if (current) {
      current.quantity += 1;
      continue;
    }
    const item = catalogById.get(typeId);
    const colorName = pipeColorById.get(color)?.name;
    counts.set(key, {
      typeId,
      length,
      quantity: 1,
      name: colorName ? `${item?.name ?? typeId} · ${colorName}` : (item?.name ?? typeId),
      kind: item?.kind ?? 'unknown',
      showLength: item?.kind === 'pipe' && !item.fixed,
    });
  }
  return [...counts.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru') || a.length - b.length);
}

/** Таблица спецификации для Excel: заголовок + строки. */
export function billOfMaterialsToAoa(rows: BillRow[]) {
  return [
    ['№', 'Наименование', 'Длина, мм', 'Количество', 'Код'],
    ...rows.map((row, index) => [
      index + 1,
      row.name,
      row.showLength ? row.length : '',
      row.quantity,
      row.typeId,
    ]),
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

export function parseProject(data: unknown): ProjectElement[] {
  if (!isRecord(data) || ![1, 2, 3].includes(Number(data.version)) || typeof data.version !== 'number' || data.units !== 'mm') throw new Error('Неверный формат проекта');
  const entries = data.version === 1 ? data.pipes : data.elements;
  if (!Array.isArray(entries) || entries.length > 500) throw new Error('Неверный список элементов');
  const vector = (value: unknown, size: number, max: number): value is number[] => Array.isArray(value) && value.length === size && value.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max);
  return entries.map((entry) => {
    if (!isRecord(entry)) throw new Error('Неверный элемент');
    const typeId = data.version === 1 ? 'pipe-110' : entry.typeId;
    const item = typeof typeId === 'string' ? catalogById.get(typeId) : undefined;
    if (!item || typeof entry.length !== 'number' || !Number.isFinite(entry.length) || (item.kind === 'pipe' && !item.fixed ? entry.length < 150 || entry.length > 6000 : entry.length !== item.length) || !vector(entry.position, 3, 1000000) || !vector(entry.quaternion, 4, 1) || Math.abs(Math.hypot(...entry.quaternion) - 1) > .01) throw new Error('Неверные параметры элемента');
    const parsed: ProjectElement = { typeId: item.id, length: entry.length, position: entry.position, quaternion: entry.quaternion };
    if (supportsPipeColor(item)) {
      const color = entry.color ?? defaultPipeColor;
      if (typeof color !== 'string' || !pipeColorById.has(color)) throw new Error('Неверный цвет');
      return { ...parsed, color };
    }
    if (entry.color !== undefined) throw new Error('Неверный цвет');
    return parsed;
  });
}

export function parseConnections(data: unknown, entries: ProjectElement[]) {
  if (!isRecord(data)) throw new Error('Неверный формат проекта');
  if (data.version !== 3) return [];
  if (!Array.isArray(data.connections) || data.connections.length > entries.length) throw new Error('Неверный список соединений');
  const elements = entries.map((entry) => {
    const element = new THREE.Object3D();
    element.userData = { typeId: entry.typeId, length: entry.length };
    element.position.fromArray(entry.position);
    element.quaternion.fromArray(entry.quaternion).normalize();
    return element;
  });
  const graph = new Connections();
  return data.connections.map((edge) => {
    if (!isRecord(edge) || typeof edge.a !== 'number' || typeof edge.b !== 'number' || typeof edge.ap !== 'string' || typeof edge.bp !== 'string' || !Number.isInteger(edge.a) || !Number.isInteger(edge.b) || !elements[edge.a] || !elements[edge.b]) throw new Error('Неизвестная деталь в соединении');
    const a = elements[edge.a], b = elements[edge.b];
    if (!graph.canJoin(a, edge.ap, b, edge.bp)) throw new Error('Недопустимое соединение');
    const ap = findPort(a, edge.ap), bp = findPort(b, edge.bp);
    const direction = ap.direction.clone().applyQuaternion(a.quaternion);
    const expected = ap.position.clone().applyQuaternion(a.quaternion).add(a.position).addScaledVector(direction, -(ap.socket ? ap.depth : bp.depth));
    const actual = bp.position.clone().applyQuaternion(b.quaternion).add(b.position);
    if (expected.distanceTo(actual) > .1 || direction.dot(bp.direction.clone().applyQuaternion(b.quaternion)) > -.99999) throw new Error('Нарушена геометрия соединения');
    graph.edges.push({ a, ap: edge.ap, b, bp: edge.bp });
    return { a: edge.a, ap: edge.ap, b: edge.b, bp: edge.bp };
  });
}
