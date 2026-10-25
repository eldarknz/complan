import test from 'node:test';
import assert from 'node:assert/strict';
import { autorun } from 'mobx';
import { Object3D } from 'three';
import { EditorStore } from '../src/store.js';
import { catalogById } from '../src/catalog.js';

test('Фильтры каталога обновляются реактивно и сохраняют выбранную длину', () => {
  const store = new EditorStore();
  const results: string[][] = [];
  const stop = autorun(() => results.push(store.filteredCatalog.map((item) => item.id)));
  try {
    store.setDiameter('50');
    store.setKind('pipe');
    store.setQuery('HTEM');
    assert.deepEqual(results.at(-1), ['pipe-50']);
    store.setLength('pipe-50', 1500);
    store.setQuery('нет такого элемента');
    assert.deepEqual(results.at(-1), []);
    store.setQuery('HTEM');
    let added: [string, number] | undefined;
    store.setCommands((item, length) => { added = [item.id, length!]; }, null);
    store.add(catalogById.get('pipe-50')!);
    assert.deepEqual(added, ['pipe-50', 1500]);
  } finally { stop(); }
});

test('Спецификация публикует снимки Three.js и реагирует на перекраску и удаление', () => {
  const store = new EditorStore();
  const element = new Object3D();
  element.userData = { typeId: 'pipe-110', length: 1000, color: 'gray' };
  const names: string[] = [];
  const stop = autorun(() => names.push(store.rows.map((row) => row.name).join(', ')));
  try {
    store.updateElements([element]);
    assert.equal(store.total, 1);
    assert.match(names.at(-1)!, /Серый/);
    element.userData.color = 'orange';
    assert.match(store.rows[0].name, /Серый/);
    store.updateElements([element]);
    assert.match(names.at(-1)!, /Оранжевый/);
    store.updateElements([]);
    assert.equal(store.total, 0);
    assert.equal(names.at(-1), '');
  } finally { stop(); }
});
