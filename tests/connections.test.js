import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { catalogById } from '../src/catalog.js';
import { getPorts, buildElement, connectionPose } from '../src/elements.js';
import { Connections, poseOf, findPort, nearestConnection } from '../src/connections.js';
import { serializeProject, parseProject, parseConnections } from '../src/project.js';

function aligned(graph) {
  for (const edge of graph.edges) {
    const a = findPort(edge.a, edge.ap), b = findPort(edge.b, edge.bp);
    const direction = a.direction.clone().applyQuaternion(edge.a.quaternion);
    const expected = a.position.clone().applyQuaternion(edge.a.quaternion).add(edge.a.position).addScaledVector(direction, -(a.socket ? a.depth : b.depth));
    const actual = b.position.clone().applyQuaternion(edge.b.quaternion).add(edge.b.position);
    assert.ok(expected.distanceTo(actual) < 1e-7);
    assert.ok(direction.dot(b.direction.clone().applyQuaternion(edge.b.quaternion)) < -.999999);
  }
}

test('Все запрошенные трубы, длины, углы и комбинации есть в каталоге', () => {
  for (const d of [50, 110]) {
    assert.deepEqual(catalogById.get(`pipe-${d}`).lengths, [150, 250, 500, 750, 1000, 1500, 2000, 3000]);
    assert.deepEqual(catalogById.get(`pipe-plain-${d}`).lengths, [5000]);
    assert.ok(getPorts(catalogById.get(`pipe-plain-${d}`)).every((port) => !port.socket));
    for (const angle of [15, 30, 45, 67, 87]) assert.ok(catalogById.has(`elbow-${d}-${angle}`));
  }
  for (const [a, b] of [[50, 50], [50, 40], [110, 50], [110, 75], [110, 110]]) {
    for (const angle of [45, 67, 87]) assert.ok(catalogById.has(`tee-${a}-${b}-${angle}`));
  }
  const ports = getPorts(catalogById.get('cross-two-plane-110'));
  assert.equal(ports.length, 4);
  assert.ok(ports[2].direction.y > .99 && ports[3].direction.z > .99);
});

test('Можно выбрать любой совместимый конец, в том числе раструб целевой трубы', () => {
  const source = buildElement('pipe-110');
  const target = catalogById.get('pipe-110');
  const pose = connectionPose(source, findPort(source, 'in'), target, 1000, 'out', 90);
  assert.ok(pose);
  assert.ok(pose.position.distanceTo(new THREE.Vector3(-940, 0, 0)) < 1e-8);
  assert.equal(connectionPose(source, findPort(source, 'in'), target, 1000, 'in'), null);
});

test('Сборка сохраняет все стыки после перемещения, поворота, изменения длины и вращения отвода', () => {
  const graph = new Connections();
  const pipe = buildElement('pipe-110'), elbow = buildElement('elbow-110-45'), cross = buildElement('cross-110-50-87');
  const branchA = buildElement('pipe-50'), branchB = buildElement('pipe-50');
  graph.join(pipe, 'out', elbow, 'in', 90);
  graph.join(elbow, 'out', cross, 'in');
  graph.join(cross, 'branch', branchA, 'in');
  graph.join(cross, 'branch-b', branchB, 'in');
  aligned(graph);
  const previous = poseOf(elbow);
  elbow.position.set(300, 450, 650); elbow.rotation.set(.3, .8, -.4);
  graph.moveWith(elbow, previous); aligned(graph);
  pipe.userData.length = 2000; graph.reflow(pipe); aligned(graph);
  const stationary = poseOf(pipe);
  graph.twist(elbow, 'in', 90); aligned(graph);
  assert.ok(pipe.position.distanceTo(stationary.position) < 1e-8);
  assert.ok(pipe.quaternion.angleTo(stationary.quaternion) < 1e-7);
  assert.throws(() => graph.join(pipe, 'out', buildElement('pipe-110'), 'in'));
  graph.disconnect(elbow, 'in');
  assert.equal(graph.component(pipe).size, 1);
  assert.equal(graph.component(elbow).size, 4);
  graph.remove(cross);
  assert.equal(graph.component(branchA).size, 1);
});

test('Стыковка двух готовых сборок перемещает целевую сборку целиком', () => {
  const graph = new Connections();
  const a = buildElement('pipe-110'), b = buildElement('pipe-110'), c = buildElement('pipe-110');
  graph.join(b, 'out', c, 'in');
  a.rotation.set(.4, -.3, .8);
  graph.join(a, 'out', b, 'in'); aligned(graph);
  assert.equal(graph.component(a).size, 3);
  assert.equal(graph.canJoin(a, 'in', c, 'out'), false);
});

test('Магнит выбирает только ближайшие свободные совместимые концы', () => {
  const graph = new Connections();
  const source = buildElement('pipe-110'), moving = buildElement('pipe-110'), wrong = buildElement('pipe-50');
  moving.position.set(1000, 0, 0); wrong.position.copy(moving.position);
  let candidate = nearestConnection(moving, [source, moving, wrong], graph);
  assert.equal(candidate.source, source); assert.equal(candidate.port.id, 'out'); assert.equal(candidate.input.id, 'in');
  assert.equal(candidate.distance, 60);
  assert.equal(nearestConnection(wrong, [source, wrong], graph), null);
  moving.position.x = 1100;
  assert.equal(nearestConnection(moving, [source, moving], graph), null);
  moving.position.x = 1000;
  candidate = nearestConnection(moving, [source, moving], graph);
  graph.join(candidate.source, candidate.port.id, candidate.target, candidate.input.id);
  aligned(graph);
  assert.equal(nearestConnection(moving, [source, moving], graph), null);
});

test('Редукция 110/50 соединяет трубы разных диаметров через соответствующие концы', () => {
  const graph = new Connections(), a = buildElement('pipe-110'), reducer = buildElement('reducer-ecc-110-50'), b = buildElement('pipe-50');
  assert.equal(graph.canJoin(a, 'out', b, 'in'), false);
  graph.join(a, 'out', reducer, 'in'); graph.join(reducer, 'out', b, 'in'); aligned(graph);
  assert.equal(b.position.z, 30);
});

test('Проект v3 сохраняет связи и отвергает занятые порты, циклы и разорванные стыки', () => {
  const graph = new Connections(), a = buildElement('pipe-110'), b = buildElement('elbow-110-45');
  graph.join(a, 'out', b, 'in', 45);
  const data = JSON.parse(JSON.stringify(serializeProject([a, b], graph)));
  assert.deepEqual(parseConnections(data, parseProject(data)), data.connections);
  assert.throws(() => parseConnections({ ...data, connections: [...data.connections, ...data.connections] }, parseProject(data)));
  const displaced = structuredClone(data); displaced.elements[1].position[0] += 100;
  assert.throws(() => parseConnections(displaced, parseProject(displaced)));
  assert.deepEqual(parseConnections({ version: 2 }, parseProject(data)), []);
});
