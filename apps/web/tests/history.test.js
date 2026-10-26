import test from 'node:test';
import assert from 'node:assert/strict';
import { CommandHistory } from '../src/history.js';

const state = (value) => ({ project: { value }, selectedIndex: value });

test('История хранит ровно 10 последних команд и позволяет повторить все отмены', () => {
  const history = new CommandHistory(10);
  for (let i = 0; i < 12; i++) history.record(state(i), state(i + 1));
  assert.equal(history.past.length, 10);
  for (let i = 11; i >= 2; i--) assert.deepEqual(history.undo(), state(i));
  assert.equal(history.undo(), null);
  for (let i = 3; i <= 12; i++) assert.deepEqual(history.redo(), state(i));
  assert.equal(history.redo(), null);
});

test('Новая команда удаляет повтор, а выбор и команды без изменений не занимают историю', () => {
  const history = new CommandHistory();
  history.record(state(0), state(1));
  history.undo();
  assert.equal(history.record(state(0), { ...state(0), selectedIndex: 99 }), false);
  assert.equal(history.future.length, 1);
  history.record(state(0), state(5));
  assert.equal(history.redo(), null);
  assert.deepEqual(history.undo(), state(0));
  assert.deepEqual(history.redo(), state(5));
});

test('История изолирует снимки от последующих изменений и сохраняет связи', () => {
  const history = new CommandHistory();
  const before = { project: { elements: [{ position: [0, 0, 0] }], connections: [] }, paused: [true] };
  const after = structuredClone(before);
  after.project.elements[0].position[0] = 100;
  after.project.connections.push({ a: 0, ap: 'out', b: 1, bp: 'in' });
  history.record(before, after);
  after.project.connections.length = 0;
  const undo = history.undo();
  undo.project.elements[0].position[0] = 999;
  assert.equal(history.redo().project.connections.length, 1);
  assert.equal(history.undo().project.elements[0].position[0], 0);
});
