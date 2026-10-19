import { test, expect } from '@playwright/test';
import { catalog } from '../../src/catalog.js';
import * as THREE from 'three';
import { buildElement } from '../../src/elements.js';
import { Connections } from '../../src/connections.js';
import { serializeProject, parseProject, parseConnections } from '../../src/project.js';

async function savedProject(page) {
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#save').click();
  const download = await downloadPromise;
  const chunks = [];
  for await (const chunk of await download.createReadStream()) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function openProject(page, project) {
  await page.locator('#file').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.locator('#toast')).toHaveText('Проект открыт');
}

test('Поворот вокруг стыка вращает только выбранную сторону, включая манипулятор', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const graph = new Connections();
  const pipe = buildElement('pipe-110'), tee = buildElement('tee-110-50-87'), branch = buildElement('pipe-50', 500);
  pipe.position.set(0, 100, 0); pipe.rotation.y = -Math.PI / 2;
  graph.join(pipe, 'out', tee, 'in'); graph.join(tee, 'branch', branch, 'in');
  const elements = [pipe, branch, tee];
  await page.goto('/');
  await openProject(page, serializeProject(elements, graph));
  await expect(page.locator('#rotation-scope')).toHaveValue('joint');
  await expect(page.locator('#rotation-port')).toHaveValue('in');
  const before = await savedProject(page);
  await page.locator('#apply-joint-angle').click();
  const after = await savedProject(page);
  expect(after.elements[0]).toEqual(before.elements[0]);
  expect(after.elements[2].quaternion).not.toEqual(before.elements[2].quaternion);
  expect(after.elements[1].position).not.toEqual(before.elements[1].position);
  expect(parseConnections(after, parseProject(after))).toHaveLength(2);
  await page.keyboard.press('Control+z');
  expect(await savedProject(page)).toEqual(before);

  await page.locator('[data-view="front"]').click();
  await page.locator('#rotate').click();
  const rect = await page.locator('#viewport canvas').boundingBox();
  const box = new THREE.Box3(); elements.forEach((element) => box.expandByObject(element));
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(38, rect.width / rect.height, 1, 100000);
  const distance = Math.max(700, box.getSize(new THREE.Vector3()).length() / (2 * Math.tan(THREE.MathUtils.degToRad(19))) / Math.min(camera.aspect, 1) * 1.3);
  camera.position.copy(center).addScaledVector(new THREE.Vector3(0, .001, 1), distance);
  camera.lookAt(center); camera.updateMatrixWorld();
  const pivot = tee.position.clone();
  const radius = pivot.distanceTo(camera.position) * 1.9 * Math.tan(THREE.MathUtils.degToRad(19)) * .85 / 8;
  const screen = (angle) => {
    const point = pivot.clone().add(new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0)).project(camera);
    return { x: rect.x + (point.x + 1) * rect.width / 2, y: rect.y + (1 - point.y) * rect.height / 2 };
  };
  const start = screen(0);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  for (let step = 1; step <= 15; step++) {
    const point = screen(step * Math.PI / 30);
    await page.mouse.move(point.x, point.y);
  }
  await page.mouse.up();
  const dragged = await savedProject(page);
  expect(dragged.elements[0]).toEqual(before.elements[0]);
  expect(dragged.elements[2].quaternion).not.toEqual(before.elements[2].quaternion);
  expect(parseConnections(dragged, parseProject(dragged))).toHaveLength(2);
  await page.keyboard.press('Control+z');
  expect(await savedProject(page)).toEqual(before);
  await page.keyboard.press('Control+Shift+z');
  expect(await savedProject(page)).toEqual(dragged);
  await page.locator('#rotation-scope').selectOption('assembly');
  await expect(page.locator('#rotation-x')).toBeEnabled();
  expect(errors).toEqual([]);
});

test('Редактор рисует сцену, добавляет элементы и переключает виды', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.catalog-item')).toHaveCount(catalog.length);
  await expect(page.locator('#object-count')).toHaveText('Элементов: 1');
  const canvas = page.locator('#viewport canvas');
  await expect(canvas).toBeVisible();
  await page.locator('[data-view="front"]').click();
  await expect(page.locator('[data-view="front"]')).toHaveClass('active');
  await page.keyboard.press('Escape');
  const withPipe = await canvas.screenshot();
  const rect = await canvas.boundingBox();
  await canvas.click({ position: { x: rect.width / 2, y: rect.height / 2 } });
  await expect(page.locator('#selection-name')).toContainText('Труба HTEM Ø110');
  await page.locator('#delete').click();
  await expect(page.locator('#object-count')).toHaveText('Элементов: 0');
  const withoutPipe = await canvas.screenshot();
  expect(withPipe.equals(withoutPipe)).toBe(false);

  await page.locator('[data-type-id="pipe-110"]').click();
  await expect(page.locator('#object-count')).toHaveText('Элементов: 1');
  await page.locator('#target-select').selectOption('tee-110-50-87');
  await page.locator('#connect').click();
  await expect(page.locator('#object-count')).toHaveText('Элементов: 2');
  await page.locator('#port-select').selectOption('branch');
  await page.locator('#target-select').selectOption('pipe-50');
  await page.locator('#connect').click();
  await expect(page.locator('#object-count')).toHaveText('Элементов: 3');
  await expect(page.locator('#selection-name')).toContainText('Труба HTEM Ø50');

  await page.locator('[data-view="top"]').click();
  await expect(page.locator('[data-view="top"]')).toHaveClass('active');
  const top = await canvas.screenshot();
  await page.locator('[data-view="perspective"]').click();
  await expect(page.locator('[data-view="perspective"]')).toHaveClass('active');
  expect(top.equals(await canvas.screenshot())).toBe(false);
  await page.locator('#rotate').click();
  await expect(page.locator('#rotate')).toHaveClass('active');
  await page.locator('#move').click();
  await expect(page.locator('#move')).toHaveClass('active');

  await page.locator('[data-filter="50"]').click();
  await expect(page.locator('.catalog-item')).toHaveCount(catalog.filter((item) => item.diameter === 50).length);
  await page.locator('#catalog-search').fill('Трап');
  await expect(page.locator('.catalog-item')).toHaveCount(1);
  await page.locator('.catalog-item').click();
  await expect(page.locator('#object-count')).toHaveText('Элементов: 4');
  expect(errors).toEqual([]);
});

test('Выбор длины, автоматическое соединение, движение сборки и сохранение связей', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.locator('#catalog-kind').selectOption('pipe');
  await page.getByLabel('Длина Труба HTEM Ø110', { exact: true }).selectOption('750');
  await page.locator('[data-type-id="pipe-110"]').click();
  await expect(page.locator('#length')).toHaveValue('750');
  let project = await savedProject(page);
  expect(project.connections).toHaveLength(1);
  expect(project.elements[1].position).toEqual([940, 100, 0]);
  await page.locator('#position-y').fill('300');
  await page.locator('#position-y').press('Tab');
  project = await savedProject(page);
  expect(project.elements.map((entry) => entry.position[1])).toEqual([300, 300]);
  await page.locator('#length').fill('1500');
  await page.locator('#length').press('Tab');
  await openProject(page, await savedProject(page));
  await page.locator('#port-select').selectOption('in');
  await expect(page.locator('#disconnect')).toBeVisible();
  await page.locator('#disconnect').click();
  project = await savedProject(page);
  expect(project.connections).toHaveLength(0);
  await page.locator('#join-mode').selectOption('existing');
  await page.locator('#target-select').selectOption('1');
  await expect(page.locator('#target-port')).toHaveValue('out');
  await page.locator('#connect').click();
  expect((await savedProject(page)).connections).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('Перетаскивание манипулятором примагничивает свободные концы', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  const entries = [0, 1300].map((x) => ({ typeId: 'pipe-110', length: 1000, position: [x, 100, 0], quaternion: [0, 0, 0, 1] }));
  await openProject(page, { version: 2, units: 'mm', elements: entries });
  await page.locator('[data-view="front"]').click();
  const rect = await page.locator('#viewport canvas').boundingBox();
  const box = new THREE.Box3();
  for (const entry of entries) {
    const element = buildElement(entry.typeId, entry.length);
    element.position.fromArray(entry.position); box.expandByObject(element);
  }
  const center = box.getCenter(new THREE.Vector3());
  const camera = new THREE.PerspectiveCamera(38, rect.width / rect.height, 1, 100000);
  const distance = Math.max(700, box.getSize(new THREE.Vector3()).length() / (2 * Math.tan(THREE.MathUtils.degToRad(19))) / Math.min(camera.aspect, 1) * 1.3);
  camera.position.copy(center).addScaledVector(new THREE.Vector3(0, .001, 1), distance);
  camera.lookAt(center); camera.updateMatrixWorld();
  const screen = (x, y) => {
    const p = new THREE.Vector3(x, y, 0).project(camera);
    return { x: rect.x + (p.x + 1) * rect.width / 2, y: rect.y + (1 - p.y) * rect.height / 2 };
  };
  const start = screen(1450, 100), end = screen(1150, 100);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 20 });
  await expect(page.locator('#snap-status')).toHaveText('Совместимо — отпустите мышь');
  await page.mouse.up();
  const project = await savedProject(page);
  expect(project.connections).toHaveLength(1);
  expect(project.elements[1].position[0]).toBeCloseTo(940, 5);
  await page.keyboard.press('Control+z');
  const beforeDrag = await savedProject(page);
  expect(beforeDrag.connections).toHaveLength(0);
  expect(beforeDrag.elements[1].position[0]).toBe(1300);
  await page.keyboard.press('Control+Shift+z');
  expect(await savedProject(page)).toEqual(project);
  await expect(page.locator('#detach-element')).toBeVisible();
  await page.locator('#detach-element').click();
  await expect(page.locator('#assembly-status')).toContainText('Независимая деталь');
  await expect(page.locator('#snap-status')).toHaveText('Первое перемещение без магнита');
  const detachedStart = screen(1090, 100), detachedEnd = screen(1140, 100);
  await page.mouse.move(detachedStart.x, detachedStart.y);
  await page.mouse.down();
  await page.mouse.move(detachedEnd.x, detachedEnd.y, { steps: 10 });
  await page.mouse.up();
  const detached = await savedProject(page);
  expect(detached.connections).toHaveLength(0);
  expect(detached.elements[0].position).toEqual(project.elements[0].position);
  expect(detached.elements[1].position[0]).toBeCloseTo(990, 0);
  await expect(page.locator('#snap-enabled')).toBeChecked();
  await expect(page.locator('#snap-status')).toHaveText('до 90 мм');
  expect(errors).toEqual([]);
});

test('Цвет новых и выбранных деталей сохраняется и отменяется', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.keyboard.press('Escape');
  await page.locator('#catalog-colors [data-color="orange"]').click();
  await expect(page.locator('#catalog-color-name')).toHaveText('Оранжевый');
  await page.locator('[data-type-id="tee-110-50-87"]').click();
  await expect(page.locator('#element-color-name')).toHaveText('Оранжевый');
  expect((await savedProject(page)).elements.at(-1).color).toBe('orange');
  const canvas = page.locator('#viewport canvas');
  const orangeShot = await canvas.screenshot();
  await page.locator('#element-colors [data-color="white"]').click();
  await page.locator('#element-colors [data-color="black"]').click();
  await expect(page.locator('#element-color-name')).toHaveText('Черный');
  const project = await savedProject(page);
  expect(project.elements[0].color).toBe('gray');
  expect(project.elements.at(-1).color).toBe('black');
  expect(orangeShot.equals(await canvas.screenshot())).toBe(false);
  await page.keyboard.press('Control+z');
  expect((await savedProject(page)).elements.at(-1).color).toBe('white');
  await page.keyboard.press('Control+z');
  expect((await savedProject(page)).elements.at(-1).color).toBe('orange');
  await page.locator('#duplicate').click();
  expect((await savedProject(page)).elements.at(-1).color).toBe('orange');
  await page.locator('[data-type-id="clamp-110"]').click();
  await expect(page.locator('#color-section')).toBeHidden();
  expect((await savedProject(page)).elements.at(-1).color).toBeUndefined();
  expect(errors).toEqual([]);
});

test('Cmd/Ctrl+Z и Shift+Z отменяют связи и хранят последние 10 команд', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#undo')).toBeDisabled();
  await page.locator('[data-type-id="pipe-110"]').click();
  const connected = await savedProject(page);
  expect(connected.connections).toHaveLength(1);
  await page.locator('#detach-element').click();
  await page.keyboard.press('Meta+z');
  expect(await savedProject(page)).toEqual(connected);
  await page.keyboard.press('Meta+Shift+z');
  expect((await savedProject(page)).connections).toHaveLength(0);
  await expect(page.locator('#snap-status')).toHaveText('Первое перемещение без магнита');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#object-count')).toHaveText('Элементов: 1');
  await page.keyboard.press('Control+Shift+z');
  expect(await savedProject(page)).toEqual(connected);
  await page.locator('#duplicate').click();
  await expect(page.locator('#redo')).toBeDisabled();
  for (let i = 0; i < 12; i++) await page.locator('#duplicate').click();
  await expect(page.locator('#object-count')).toHaveText('Элементов: 15');
  for (let i = 0; i < 10; i++) await page.keyboard.press('Control+z');
  await expect(page.locator('#object-count')).toHaveText('Элементов: 5');
  await expect(page.locator('#undo')).toBeDisabled();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#object-count')).toHaveText('Элементов: 5');
  for (let i = 0; i < 10; i++) await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#object-count')).toHaveText('Элементов: 15');
  await expect(page.locator('#redo')).toBeDisabled();
  expect(errors).toEqual([]);
});
