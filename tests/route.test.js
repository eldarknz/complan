import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { catalogById } from '../src/catalog.js';
import { buildElement, disposeElement, getPorts } from '../src/elements.js';
import { Connections, findPort } from '../src/connections.js';
import { assembleRoute, chooseElbows, elbowReach, fitPipeLengths, insertionDepth, simplifyRoute, stockLengths } from '../src/route.js';

function rebuild(element) {
  disposeElement(element);
  element.clear();
  const replacement = buildElement(element.userData.typeId, element.userData.length, element.userData.color);
  for (const child of [...replacement.children]) element.add(child);
}

function aligned(graph) {
  for (const edge of graph.edges) {
    const a = findPort(edge.a, edge.ap);
    const b = findPort(edge.b, edge.bp);
    const direction = a.direction.clone().applyQuaternion(edge.a.quaternion);
    const expected = a.position.clone().applyQuaternion(edge.a.quaternion).add(edge.a.position).addScaledVector(direction, -(a.socket ? a.depth : b.depth));
    const actual = b.position.clone().applyQuaternion(edge.b.quaternion).add(edge.b.position);
    assert.ok(expected.distanceTo(actual) < 1e-6, `стык ${edge.ap}/${edge.bp} разошелся на ${expected.distanceTo(actual)}`);
    assert.ok(direction.dot(b.direction.clone().applyQuaternion(edge.b.quaternion)) < -.999);
  }
}

function build(points, diameter, elements = [], graph = new Connections()) {
  const created = [];
  const result = assembleRoute({
    points: points.map((point) => new THREE.Vector3(...point)),
    diameter,
    elements,
    graph,
    create: (typeId, length) => {
      const element = buildElement(typeId, length);
      created.push(element);
      return element;
    },
    rebuild,
  });
  aligned(graph);
  for (const element of created) {
    const item = catalogById.get(element.userData.typeId);
    if (item.kind === 'pipe' && !item.fixed) assert.ok(stockLengths(item.diameter).includes(element.userData.length), item.id);
    else assert.equal(element.userData.length, item.length);
  }
  return { ...result, created, graph };
}

function directionOf(element, portId = 'out') {
  return findPort(element, portId).direction.clone().applyQuaternion(element.quaternion).normalize();
}

test('Подбор отводов и длин берет только каталог', () => {
  assert.deepEqual(chooseElbows(4), []);
  assert.deepEqual(chooseElbows(90), [87]);
  assert.deepEqual(chooseElbows(60), [45, 15]);
  assert.deepEqual(chooseElbows(120), [87, 30]);
  for (const diameter of [50, 110]) {
    assert.equal(insertionDepth(diameter), getPorts(catalogById.get(`pipe-${diameter}`), 1000)[1].depth);
    assert.deepEqual(fitPipeLengths(4200, diameter), [3000, 1000, 150]);
    assert.deepEqual(fitPipeLengths(4500, diameter), [3000, 1500]);
    assert.deepEqual(fitPipeLengths(3100, diameter), [3000]);
    assert.deepEqual(fitPipeLengths(4700, diameter), [3000, 1500, 150]);
    assert.deepEqual(fitPipeLengths(100, diameter), []);
  }
  const item = catalogById.get('elbow-110-87');
  const reach = elbowReach(110, 87);
  const corner = new THREE.Vector3(reach, 0, 0);
  const ports = getPorts(item);
  assert.ok(Math.abs(ports[1].position.distanceTo(corner) - reach) < 1e-6);
  assert.ok(Math.abs(corner.x - reach) < 1e-6);
});

test('Мелкие изломы выпрямляются, прямая линия собирается трубами каталога', () => {
  const simplified = simplifyRoute([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1000, 8, 0),
    new THREE.Vector3(2200, -6, 0),
    new THREE.Vector3(4000, 0, 0),
  ]);
  assert.equal(simplified.length, 2);
  const { created } = build([[0, 200, 0], [3000, 200, 0]], 110);
  assert.equal(created.length, 1);
  assert.equal(created[0].userData.typeId, 'pipe-110');
  assert.equal(created[0].userData.length, 3000);
  const long = build([[0, 200, 0], [4500, 200, 0]], 110);
  assert.deepEqual(long.created.map((element) => element.userData.length), [3000, 1500]);
  assert.ok(directionOf(created[0]).distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6);
});

test('Поворот около 90 градусов ставит отвод 87 и продолжает линию по нему', () => {
  const { created } = build([[0, 0, 0], [2000, 0, 0], [2000, 0, 1800]], 110);
  const elbow = created.find((element) => element.userData.typeId === 'elbow-110-87');
  assert.ok(elbow);
  const exit = directionOf(created.at(-1));
  assert.ok(exit.angleTo(new THREE.Vector3(0, 0, 1)) < THREE.MathUtils.degToRad(8), exit.toArray().join(','));
  assert.ok(created.filter((element) => catalogById.get(element.userData.typeId).kind === 'elbow').length <= 2);
});

test('Линия Ø50, доведенная до раструба Ø110, получает переход 110/50', () => {
  const graph = new Connections();
  const existing = buildElement('pipe-110', 1000);
  const { created } = build([[1000, 0, 0], [4000, 0, 0]], 50, [existing], graph);
  assert.ok(created.some((element) => element.userData.typeId === 'reducer-110-50'));
  assert.ok(created.some((element) => element.userData.typeId === 'pipe-50'));
  assert.equal(graph.at(existing, 'out').b.userData.typeId, 'reducer-110-50');
  assert.ok(directionOf(created.at(-1)).x > .99);
});

test('Подвод Ø50 к гладкому концу Ø110 ставит муфту и переход', () => {
  const graph = new Connections();
  const existing = buildElement('pipe-110', 1000);
  const { created } = build([[0, 0, 0], [-2500, 0, 0]], 50, [existing], graph);
  assert.equal(graph.at(existing, 'in').b.userData.typeId, 'coupling-110');
  assert.ok(created.some((element) => element.userData.typeId === 'reducer-110-50'));
  assert.ok(directionOf(created.at(-1)).x < -.99);
});

test('Подвод Ø110 к гладкому концу Ø50 разворачивает переход', () => {
  const graph = new Connections();
  const existing = buildElement('pipe-50', 1000);
  const { created } = build([[0, 0, 0], [-3000, 0, 0]], 110, [existing], graph);
  const reducer = created.find((element) => element.userData.typeId === 'reducer-110-50');
  assert.ok(reducer);
  assert.equal(graph.at(existing, 'in').b, reducer);
  assert.ok(created.some((element) => element.userData.typeId === 'pipe-110'));
});

test('Линия Ø50 в тело трубы Ø110 врезает тройник и сохраняет уже надетый отвод', () => {
  const graph = new Connections();
  const existing = buildElement('pipe-110', 2000);
  const elbow = buildElement('elbow-110-45');
  graph.join(existing, 'out', elbow, 'in', 90);
  const before = directionOf(elbow);
  const { created } = build([[1000, 0, 0], [1000, 0, 1600]], 50, [existing, elbow], graph);
  const tee = created.find((element) => catalogById.get(element.userData.typeId).kind === 'tee');
  assert.ok(tee);
  assert.equal(tee.userData.typeId, 'tee-110-50-87');
  assert.equal(catalogById.get(existing.userData.typeId).kind, 'pipe');
  assert.ok(stockLengths(110).includes(existing.userData.length));
  const branch = directionOf(tee, 'branch');
  assert.ok(branch.z > .9, branch.toArray().join(','));
  assert.ok(before.angleTo(directionOf(elbow)) < THREE.MathUtils.degToRad(2));
  assert.ok(graph.at(tee, 'branch'));
});

test('Вертикальный поворот и врезка в трубу 1000 мм используют каталог', () => {
  const dropped = build([[0, 100, 0], [1600, 100, 0], [1600, 1200, 0]], 50);
  assert.ok(dropped.created.some((element) => catalogById.get(element.userData.typeId).kind === 'elbow'));
  assert.ok(directionOf(dropped.created.at(-1)).y > .9);
  const existing = buildElement('pipe-110', 1000);
  existing.position.set(0, 100, 0);
  const branch = build([[500, 100, 0], [500, 100, 1500]], 50, [existing]);
  assert.ok(branch.created.some((element) => element.userData.typeId === 'tee-110-50-87'));
  assert.ok(stockLengths(110).includes(existing.userData.length));
});

test('Линия под углом к гладкому концу врезает тройник и оставляет трубу до него', () => {
  const graph = new Connections();
  const existing = buildElement('pipe-110', 1000);
  const { created } = build([[0, 0, 0], [0, 0, 2000]], 110, [existing], graph);
  const tee = created.find((element) => catalogById.get(element.userData.typeId).kind === 'tee');
  assert.ok(tee);
  assert.equal(created.some((element) => catalogById.get(element.userData.typeId).kind === 'coupling'), false);
  assert.ok(existing.userData.length < 1000);
  assert.ok(stockLengths(110).includes(existing.userData.length));
  const edge = graph.at(existing, 'out');
  assert.equal(edge.a === existing ? edge.b : edge.a, tee);
  const branch = directionOf(tee, 'branch');
  assert.ok(branch.z > .9, branch.toArray().join(','));
  assert.ok(graph.at(tee, 'branch'));
  assert.ok(Math.abs(directionOf(created.at(-1)).x) < .4);
});

test('Прямая линия к гладкому концу садится раструбом новой трубы', () => {
  const graph = new Connections();
  const existing = buildElement('pipe-110', 1000);
  const { created } = build([[0, 0, 0], [-3000, 0, 0]], 110, [existing], graph);
  assert.equal(created.some((element) => catalogById.get(element.userData.typeId).kind === 'coupling'), false);
  const edge = graph.at(existing, 'in');
  const attachedPort = edge.a === existing ? edge.bp : edge.ap;
  assert.equal(edge.a === existing ? edge.b.userData.typeId : edge.a.userData.typeId, 'pipe-110');
  assert.equal(attachedPort, 'out');
  assert.ok(directionOf(created.at(-1), 'in').x < -.99);
});

test('Продолжение от гладкого конца поворачивает отводом без муфты', () => {
  const graph = new Connections();
  const existing = buildElement('pipe-110', 1000);
  const { created } = build([[0, 0, 0], [-2000, 0, 0], [-2000, 0, 1500]], 110, [existing], graph);
  assert.equal(created.some((element) => catalogById.get(element.userData.typeId).kind === 'coupling'), false);
  assert.ok(created.some((element) => catalogById.get(element.userData.typeId).kind === 'elbow'));
  const exit = directionOf(created.at(-1), 'in');
  assert.ok(exit.z > .9, exit.toArray().join(','));
});

test('Раструб Ø50 не принимает переход на Ø110, линия остается отдельной', () => {
  const graph = new Connections();
  const existing = buildElement('pipe-50', 1000);
  existing.position.set(0, 0, 0);
  const { created, message } = build([[1000, 0, 0], [1000, 0, 2000]], 110, [existing], graph);
  assert.match(message, /гладкий конец/);
  assert.equal(graph.at(existing, 'in'), undefined);
  assert.equal(graph.at(existing, 'out'), undefined);
  assert.ok(created.some((element) => element.userData.typeId === 'pipe-110'));
});
