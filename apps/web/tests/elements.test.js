import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { catalog, catalogById } from '../src/catalog.js';
import { buildElement, getPorts, connectionPose, disposeElement, pipeColors } from '../src/elements.js';
import { parseProject, serializeProject, summarizeBillOfMaterials, billOfMaterialsToAoa } from '../src/project.js';

test('Каталог содержит все 73 уникальных элемента, геометрия конечна', () => {
  assert.equal(catalog.length, 73);
  assert.equal(catalogById.size, 73);
  assert.equal(catalog.filter((item) => item.diameter === 110).length, 43);
  for (const item of catalog) {
    const element = buildElement(item.id);
    assert.ok(element.children.length, item.id);
    element.traverse((object) => {
      if (!object.isMesh) return;
      assert.ok([...object.geometry.attributes.position.array].every(Number.isFinite), item.id);
      assert.ok([...object.geometry.attributes.normal.array].every(Number.isFinite), item.id);
    });
    const bounds = new THREE.Box3().setFromObject(element);
    assert.ok(!bounds.isEmpty(), item.id);
    for (const port of getPorts(item)) assert.ok(Math.abs(port.direction.length() - 1) < 1e-10);
    disposeElement(element);
  }
});

test('Боковая ветка Ø50 совмещается после произвольного поворота тройника', () => {
  const item = catalogById.get('tee-110-50-87');
  const source = buildElement(item.id);
  source.position.set(200, 550, -300);
  source.rotation.set(.4, -.8, 1.2);
  const port = getPorts(item).find((port) => port.id === 'branch');
  const pose = connectionPose(source, port, catalogById.get('pipe-50'));
  assert.ok(pose);
  const direction = port.direction.clone().applyQuaternion(source.quaternion);
  const mouth = port.position.clone().applyQuaternion(source.quaternion).add(source.position);
  assert.ok(pose.position.clone().addScaledVector(direction, 30).distanceTo(mouth) < 1e-8);
  assert.ok(new THREE.Vector3(1, 0, 0).applyQuaternion(pose.quaternion).distanceTo(direction) < 1e-8);
  assert.equal(connectionPose(source, port, catalogById.get('pipe-110')), null);
  disposeElement(source);
});

test('Два отвода 45° меняют направление на 90°', () => {
  const item = catalogById.get('elbow-110-45');
  const first = buildElement(item.id);
  const port = getPorts(item)[1];
  const pose = connectionPose(first, port, item);
  const finalDirection = port.direction.clone().applyQuaternion(pose.quaternion);
  assert.ok(finalDirection.distanceTo(new THREE.Vector3(0, 1, 0)) < 1e-8);
  disposeElement(first);
});

test('Прямое соединение сохраняет вращение вокруг оси и вставку 60 мм', () => {
  const item = catalogById.get('pipe-110');
  const source = buildElement(item.id);
  source.rotation.set(.7, .2, -.4);
  const pose = connectionPose(source, getPorts(item)[1], item);
  assert.ok(source.quaternion.angleTo(pose.quaternion) < 1e-7);
  assert.ok(pose.position.distanceTo(new THREE.Vector3(940, 0, 0).applyQuaternion(source.quaternion)) < 1e-8);
  disposeElement(source);
});

test('Муфта соединяется с гладким концом; монтажные элементы не имеют портов', () => {
  const item = catalogById.get('pipe-110');
  const source = buildElement(item.id);
  const coupling = catalogById.get('coupling-110');
  assert.ok(connectionPose(source, getPorts(item)[0], coupling));
  assert.equal(connectionPose(source, getPorts(item)[1], coupling), null);
  assert.equal(connectionPose(source, getPorts(item)[0], item), null);
  for (const accessory of catalog.filter((entry) => entry.accessory)) {
    assert.deepEqual(getPorts(accessory), []);
    assert.equal(connectionPose(source, getPorts(item)[1], accessory), null);
  }
  assert.equal(getPorts(catalogById.get('cap-110')).length, 1);
  assert.equal(getPorts(catalogById.get('reducer-50-40'))[1].diameter, 40);
  disposeElement(source);
});

test('Все типы, длины и трансформации сохраняются и открываются', () => {
  const elements = catalog.map((item, index) => {
    const element = buildElement(item.id, item.kind === 'pipe' && !item.fixed ? 2000 : item.length);
    element.position.set(index * 10, 200, -(index + 1) * 20);
    element.rotation.set(.1 * index, .2, .3);
    return element;
  });
  const project = serializeProject(elements);
  assert.deepEqual(parseProject(JSON.parse(JSON.stringify(project))), project.elements);
  elements.forEach(disposeElement);
});

test('Спецификация группирует одинаковые элементы и разделяет трубы по длине', () => {
  const elements = [
    { userData: { typeId: 'pipe-110', length: 1000 } },
    { userData: { typeId: 'pipe-110', length: 1000 } },
    { userData: { typeId: 'pipe-110', length: 2000 } },
    { userData: { typeId: 'elbow-110-45', length: catalogById.get('elbow-110-45').length } },
    { userData: { typeId: 'elbow-110-45', length: catalogById.get('elbow-110-45').length } },
  ];
  assert.deepEqual(summarizeBillOfMaterials(elements), [
    { typeId: 'elbow-110-45', length: catalogById.get('elbow-110-45').length, quantity: 2, name: catalogById.get('elbow-110-45').name, kind: 'elbow', showLength: false },
    { typeId: 'pipe-110', length: 1000, quantity: 2, name: catalogById.get('pipe-110').name, kind: 'pipe', showLength: true },
    { typeId: 'pipe-110', length: 2000, quantity: 1, name: catalogById.get('pipe-110').name, kind: 'pipe', showLength: true },
  ]);
  assert.deepEqual(summarizeBillOfMaterials([]), []);
  assert.deepEqual(billOfMaterialsToAoa(summarizeBillOfMaterials(elements)), [
    ['№', 'Наименование', 'Длина, мм', 'Количество', 'Код'],
    [1, catalogById.get('elbow-110-45').name, '', 2, 'elbow-110-45'],
    [2, catalogById.get('pipe-110').name, 1000, 2, 'pipe-110'],
    [3, catalogById.get('pipe-110').name, 2000, 1, 'pipe-110'],
  ]);
});

test('Трубы и фитинги окрашиваются, монтажные элементы нет', () => {
  const orange = pipeColors.find((color) => color.id === 'orange');
  const tee = buildElement('tee-110-50-87', undefined, 'orange');
  const pipe = buildElement('pipe-50', 500, 'orange');
  assert.equal(tee.userData.color, 'orange');
  assert.equal(pipe.children[0].material, tee.children[0].material);
  assert.equal(pipe.children[0].material.color.getHexString(), orange.hex.slice(1));
  for (const color of pipeColors) {
    const element = buildElement('elbow-110-45', undefined, color.id);
    assert.equal(element.userData.color, color.id);
    assert.equal(element.children[0].material.color.getHexString(), color.hex.slice(1));
    disposeElement(element);
  }
  const clamp = buildElement('clamp-110', undefined, 'black');
  const toilet = buildElement('toilet-110', undefined, 'white');
  assert.equal(clamp.userData.color, undefined);
  assert.equal(toilet.userData.color, undefined);
  const coupling = buildElement('htam-110', undefined, 'black');
  const materials = new Set();
  coupling.traverse((object) => { if (object.isMesh) materials.add(object.material.color.getHexString()); });
  assert.ok(materials.has(pipeColors.find((color) => color.id === 'black').hex.slice(1)));
  assert.ok(materials.size > 1);
  disposeElement(tee); disposeElement(pipe); disposeElement(clamp); disposeElement(toilet); disposeElement(coupling);
  const elbow = catalogById.get('elbow-110-45');
  const legacy = { typeId: elbow.id, length: elbow.length, position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  assert.equal(parseProject({ version: 3, units: 'mm', elements: [legacy] })[0].color, 'gray');
  assert.throws(() => parseProject({ version: 3, units: 'mm', elements: [{ ...legacy, typeId: 'pipe-110', length: 1000, color: 'red' }] }));
  assert.throws(() => parseProject({ version: 3, units: 'mm', elements: [{ typeId: 'clamp-110', length: catalogById.get('clamp-110').length, position: [0, 0, 0], quaternion: [0, 0, 0, 1], color: 'gray' }] }));
});

test('Спецификация разделяет одинаковые детали по цвету', () => {
  const name = catalogById.get('pipe-110').name;
  const rows = summarizeBillOfMaterials([
    { userData: { typeId: 'pipe-110', length: 1000, color: 'orange' } },
    { userData: { typeId: 'pipe-110', length: 1000, color: 'gray' } },
    { userData: { typeId: 'pipe-110', length: 1000, color: 'orange' } },
  ]);
  assert.deepEqual(rows.map((row) => [row.name, row.quantity]), [[`${name} · Оранжевый`, 2], [`${name} · Серый`, 1]]);
});

test('Старые проекты Ø110 читаются, повреждённые данные отклоняются', () => {
  const entry = { length: 1000, position: [0, 100, 0], quaternion: [0, 0, 0, 1] };
  assert.equal(parseProject({ version: 1, units: 'mm', pipes: [entry] })[0].typeId, 'pipe-110');
  const data = (patch) => ({ version: 2, units: 'mm', elements: [{ ...entry, typeId: 'pipe-110', ...patch }] });
  for (const patch of [{ typeId: 'missing' }, { length: 0 }, { length: '1000' }, { position: [NaN, 0, 0] }, { quaternion: [0, 0, 0, 0] }, { typeId: 'elbow-110-45', length: 1000 }]) assert.throws(() => parseProject(data(patch)));
  assert.throws(() => parseProject(null));
});
