import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { catalog, catalogById } from './catalog.js';
import { buildElement, getPorts, compatiblePorts, disposeElement, supportsPipeColor, pipeColorById, defaultPipeColor } from './elements.js';
import { parseProject, parseConnections, serializeProject } from './project.js';
import { initializeInterface, updateBillOfMaterials, getCatalogColor, syncColorSwatches } from './interface.js';
import { Connections, elementPorts, findPort, poseOf, nearestConnection } from './connections.js';
import { assembleRoute, findAttachment } from './route.js';
import { CommandHistory } from './history.js';
import { editorStore } from './store.js';

type Axis = 'x' | 'y' | 'z';
interface RouteAxis { id: string; direction: THREE.Vector3; color: string }
interface RoutePointer { clientX: number; clientY: number; shiftKey: boolean }

export function initializeEditor() {
const lifetime = new AbortController();
const $ = (selector: string) => document.querySelector<HTMLInputElement>(selector)!;
const viewport = $('#viewport');
initializeInterface((item, length = item.length) => {
  const before = captureState();
  const source = selected, port = selectedPort();
  const input = port && getPorts(item, length).find((input) => compatiblePorts(port, input));
  const canConnect = $('#snap-enabled').checked && source && port && !connections.at(source, port.id) && input;
  const element = createElement(item.id, length, new THREE.Vector3(0, 200, pipes.length * 180));
  if (canConnect) {
    connections.join(source, port.id, element, input.id);
    select(element);
    toast('Элемент пристыкован к выбранному свободному концу');
  } else toast(`${item.name} добавлен`);
  recordEdit(before);
}, (color) => changeColor(color));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#f0f2ed');
const camera = new THREE.PerspectiveCamera(38, 1, 1, 100000);
camera.position.set(1700, 1500, 1900);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor('#f0f2ed');
viewport.prepend(renderer.domElement);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(400, 120, 0);
orbit.maxDistance = 40000;
orbit.minDistance = 150;
const transform = new TransformControls(camera, renderer.domElement);
transform.setSize(.85);
transform.setSpace('world');
scene.add(transform.getHelper());
transform.addEventListener('dragging-changed', (event) => {
  orbit.enabled = !event.value;
  if (event.value) {
    translatedDuringDrag = false;
    dragBefore = captureState();
  }
  if (!event.value && snapCandidate) {
    const { source, port, target, input } = snapCandidate;
    if ($('#snap-enabled').checked && connections.canJoin(source, port.id, target, input.id)) {
      connections.join(source, port.id, target, input.id);
      toast('Магнитная стыковка: соединение закреплено');
    }
    snapCandidate = null;
    lastPose = selected ? poseOf(selected) : null;
    updateFields(); updateConnections(); updateOutline();
  }
  if (!event.value && translatedDuringDrag && selected && snapPaused.has(selected)) {
    for (const member of connections.component(selected)) snapPaused.delete(member);
    updatePortMarkers();
  }
  if (!event.value && dragBefore) {
    recordEdit(dragBefore);
    dragBefore = null;
  }
  if (!event.value) syncTransform();
});
transform.addEventListener('objectChange', () => {
  if (transform.object === jointPivot && selected) {
    const port = jointRotationPort();
    if (port) {
      const direction = port.direction.clone().applyQuaternion(selected.quaternion);
      const delta = jointPivot.quaternion.clone().multiply(pivotPrevious.clone().invert());
      const angle = 2 * Math.atan2(new THREE.Vector3(delta.x, delta.y, delta.z).dot(direction), delta.w);
      connections.twist(selected, port.id, degrees(angle));
      pivotPrevious.copy(jointPivot.quaternion);
      lastPose = poseOf(selected);
    }
  } else applyAssemblyMove();
  if (transform.dragging && transform.mode === 'translate') translatedDuringDrag = true;
  snapCandidate = selected && !snapPaused.has(selected) && transform.mode === 'translate' && $('#snap-enabled').checked ? nearestConnection(selected, pipes, connections) : null;
  updateFields(); updateOutline();
});
scene.add(new THREE.HemisphereLight(0xffffff, 0x929b83, 3));
const sun = new THREE.DirectionalLight(0xfff6e9, 3.2);
sun.position.set(1200, 2500, 1200);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -4000, right: 4000, top: 4000, bottom: -4000, far: 10000 });
sun.shadow.normalBias = 3;
scene.add(sun);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(100000, 100000), new THREE.MeshStandardMaterial({ color: '#f0f2ed', roughness: 1 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.GridHelper(12000, 120, '#c6d1bf', '#dce2d5');
grid.material.transparent = true;
grid.material.opacity = .65;
scene.add(grid);
const axes = new THREE.AxesHelper(250);
axes.position.set(0, 2, 0);
scene.add(axes);

const pipes: THREE.Object3D[] = [];
const connections = new Connections();
let routeActive = false;
let routeDiameter = 110;
let routePoints: THREE.Vector3[] = [];
const routePreview = new THREE.Group();
scene.add(routePreview);
const routeMaterial = new THREE.MeshBasicMaterial({ color: '#e25a12', depthTest: false });
const routeLiveMaterial = new THREE.MeshBasicMaterial({ color: '#3f5946', depthTest: false });
const routeSnapMaterial = new THREE.MeshBasicMaterial({ color: '#57d596', depthTest: false });
const routeAxes = [
  { id: 'x', direction: new THREE.Vector3(1, 0, 0), color: '#e23b2f' },
  { id: 'y', direction: new THREE.Vector3(0, 1, 0), color: '#2f9e4f' },
  { id: 'z', direction: new THREE.Vector3(0, 0, 1), color: '#2f6ed6' },
];
const routeAxisMaterials = Object.fromEntries(routeAxes.map((axis) => [axis.id, new THREE.MeshBasicMaterial({ color: axis.color, depthTest: false })]));
let routeLockedAxis: RouteAxis | null = null;
let routePointer: RoutePointer | null = null;
let lastPose: ReturnType<typeof poseOf> | null = null;
let snapCandidate: ReturnType<typeof nearestConnection> = null;
const snapPaused = new WeakSet();
let translatedDuringDrag = false;
const portMarkers = new THREE.Group();
scene.add(portMarkers);
let selected: THREE.Object3D | null = null;
let nextId = 1;
let outline: THREE.BoxHelper | null;
const radians = THREE.MathUtils.degToRad;
const degrees = THREE.MathUtils.radToDeg;
const history = new CommandHistory<ReturnType<typeof captureState>>(10);
let dragBefore: ReturnType<typeof captureState> | null = null;
const jointPivot = new THREE.Object3D();
scene.add(jointPivot);
const pivotPrevious = new THREE.Quaternion();

function jointRotationPort() {
  if (!selected || $('#rotation-scope').value !== 'joint') return null;
  const id = $('#rotation-port').value;
  return connections.at(selected, id) ? findPort(selected, id) : null;
}

function syncTransform() {
  if (transform.dragging) return;
  if (routeActive) { transform.detach(); return; }
  const port = jointRotationPort();
  if (!selected) { transform.detach(); return; }
  if (port && transform.mode === 'rotate') {
    jointPivot.position.copy(port.position).applyQuaternion(selected.quaternion).add(selected.position);
    const direction = port.direction.clone().applyQuaternion(selected.quaternion);
    jointPivot.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction);
    pivotPrevious.copy(jointPivot.quaternion);
    jointPivot.updateMatrixWorld();
    transform.setSpace('local');
    transform.showX = true; transform.showY = false; transform.showZ = false;
    transform.attach(jointPivot);
  } else {
    transform.setSpace('world');
    transform.showX = true; transform.showY = true; transform.showZ = true;
    transform.attach(selected);
  }
}

function updateJointRotation() {
  const previous = $('#rotation-port').value;
  const ports = selected ? elementPorts(selected).filter((port) => connections.at(selected, port.id)) : [];
  $('#joint-rotation').hidden = !ports.length;
  $('#rotation-port').replaceChildren(...ports.map((port) => new Option(`${port.name} · Ø${port.diameter}`, port.id)));
  if (ports.some((port) => port.id === previous)) $('#rotation-port').value = previous;
  $('#joint-settings').hidden = $('#rotation-scope').value !== 'joint';
  syncTransform();
}
$('#rotation-scope').onchange = updateJointRotation;
$('#rotation-port').onchange = syncTransform;
$('#apply-joint-angle').onclick = () => {
  const port = jointRotationPort(), angle = $('#joint-angle').valueAsNumber;
  if (!port || !Number.isFinite(angle) || Math.abs(angle) > 360) { toast('Укажите угол от −360° до 360°'); return; }
  connections.twist(selected, port.id, angle);
  lastPose = poseOf(selected);
  updateFields(); updateOutline(); syncTransform();
};

function captureState() {
  return {
    project: serializeProject(pipes, connections),
    ids: pipes.map((pipe) => pipe.userData.id),
    nextId,
    selectedIndex: pipes.indexOf(selected),
    selectedPort: $('#port-select').value,
    rotationPort: $('#rotation-port').value,
    rotationScope: $('#rotation-scope').value,
    paused: pipes.map((pipe) => snapPaused.has(pipe)),
  };
}

function restoreState(state: ReturnType<typeof captureState>) {
  select(null);
  [...pipes].forEach(removePipe);
  state.project.elements.forEach((entry, index) => {
    const element = createElement(entry.typeId, entry.length, new THREE.Vector3().fromArray(entry.position), new THREE.Quaternion().fromArray(entry.quaternion), entry.color);
    element.userData.id = state.ids[index];
    if (state.paused[index]) snapPaused.add(element);
  });
  nextId = state.nextId;
  connections.edges = state.project.connections.map((edge) => ({ a: pipes[edge.a], ap: edge.ap, b: pipes[edge.b], bp: edge.bp }));
  select(pipes[state.selectedIndex] || null);
  $('#rotation-scope').value = state.rotationScope;
  $('#rotation-port').value = state.rotationPort;
  updateJointRotation();
  if (selected && elementPorts(selected).some((port) => port.id === state.selectedPort)) {
    $('#port-select').value = state.selectedPort;
    updateTargets();
  }
  updateCount();
}

function updateHistoryButtons() {
  $('#undo').disabled = !history.past.length;
  $('#redo').disabled = !history.future.length;
  $('#undo').title = `Отменить — Cmd/Ctrl+Z (${history.past.length}/10)`;
  $('#redo').title = `Повторить — Cmd/Ctrl+Shift+Z (${history.future.length})`;
}

function recordEdit(before: ReturnType<typeof captureState>) {
  history.record(before, captureState());
  updateHistoryButtons();
}

function travelHistory(direction: 'undo' | 'redo') {
  if (transform.dragging) return;
  const state = direction === 'undo' ? history.undo() : history.redo();
  if (!state) return;
  restoreState(state);
  updateHistoryButtons();
  toast(direction === 'undo' ? 'Действие отменено' : 'Действие повторено');
}
$('#undo').onclick = () => travelHistory('undo');
$('#redo').onclick = () => travelHistory('redo');

function createElement(typeId = 'pipe-110', length?: number, position = new THREE.Vector3(0, 100, 0), quaternion = new THREE.Quaternion(), color?: string, silent = false) {
  const item = catalogById.get(typeId);
  length ??= item.length;
  const resolved = supportsPipeColor(item) ? (pipeColorById.has(color) ? color : getCatalogColor()) : undefined;
  const pipe = buildElement(typeId, length, resolved);
  pipe.userData.id = nextId++;
  pipe.position.copy(position);
  pipe.quaternion.copy(quaternion);
  scene.add(pipe);
  pipes.push(pipe);
  if (!silent) select(pipe);
  updateCount();
  return pipe;
}

function updateCount() {
  $('#object-count').textContent = `Элементов: ${pipes.length}`;
  updateBillOfMaterials(pipes);
}

function updateOutline() {
  if (outline) { scene.remove(outline); outline.geometry.dispose(); outline.material.dispose(); outline = null; }
  if (!selected) return;
  outline = new THREE.BoxHelper(selected, '#879d72');
  outline.material.transparent = true;
  outline.material.opacity = .45;
  scene.add(outline);
  updatePortMarkers();
}

function updatePortMarkers() {
  $('#snap-status').textContent = selected && snapPaused.has(selected) ? 'Первое перемещение без магнита' : snapCandidate ? 'Совместимо — отпустите мышь' : 'до 90 мм';
  for (const marker of [...portMarkers.children]) {
    if (marker instanceof THREE.Mesh) { marker.geometry.dispose(); marker.material.dispose(); }
    portMarkers.remove(marker);
  }
  if (!selected) return;
  for (const port of elementPorts(selected)) {
    const occupied = connections.at(selected, port.id);
    const marker = new THREE.Mesh(new THREE.SphereGeometry(9, 12, 8), new THREE.MeshBasicMaterial({ color: occupied ? '#c08662' : port.id === $('#port-select').value ? '#3e9cdb' : '#50b582', depthTest: false }));
    marker.position.copy(port.position).applyQuaternion(selected.quaternion).add(selected.position);
    marker.userData.portId = port.id;
    marker.renderOrder = 10;
    portMarkers.add(marker);
  }
  if (snapCandidate) {
    const marker = new THREE.Mesh(new THREE.SphereGeometry(18, 16, 12), new THREE.MeshBasicMaterial({ color: '#57d596', depthTest: false, wireframe: true }));
    marker.position.copy(snapCandidate.destination);
    marker.renderOrder = 11;
    portMarkers.add(marker);
  }
}

function applyAssemblyMove() {
  if (!selected) return;
  if (lastPose) connections.moveWith(selected, lastPose);
  lastPose = poseOf(selected);
}

function select(pipe: THREE.Object3D | null) {
  if (pipe !== selected) { $('#rotation-scope').value = 'joint'; $('#rotation-port').value = ''; }
  selected = pipe;
  lastPose = pipe ? poseOf(pipe) : null;
  snapCandidate = null;
  $('#properties').hidden = !pipe;
  $('#empty-selection').hidden = !!pipe;
  $('#selection-name').textContent = pipe ? `${catalogById.get(pipe.userData.typeId).name} · ${pipe.userData.id}` : 'Нет выделения';
  if (!pipe) transform.detach();
  updateFields();
  updateConnections();
  updateOutline();
  if (!pipe) updatePortMarkers();
}

function updateFields() {
  if (!selected) return;
  const item = catalogById.get(selected.userData.typeId);
  $('#element-diameter').textContent = item.branch || item.outlet ? `${item.diameter} / ${item.branch || item.outlet} мм` : `${item.diameter} мм`;
  $('#length').disabled = item.kind !== 'pipe' || !!item.fixed;
  $('.field-label[for="length"]').textContent = item.kind === 'pipe' ? 'Длина трубы' : 'Эскизный габарит (фиксированный)';
  const presets = $('#length').closest('section').querySelector<HTMLElement>('.presets');
  presets.hidden = item.kind !== 'pipe' || !!item.fixed;
  presets.replaceChildren(...(item.lengths || []).map((length) => {
    const button = document.createElement('button'); button.textContent = String(length); button.dataset.length = String(length);
    button.onclick = () => changeLength(length); return button;
  }));
  $('#length').value = selected.userData.length;
  const colorable = supportsPipeColor(item);
  $('#color-section').hidden = !colorable;
  if (colorable) {
    const color = selected.userData.color || defaultPipeColor;
    $('#element-color-name').textContent = pipeColorById.get(color).name;
    syncColorSwatches($('#element-colors'), color);
  }
  for (const axis of ['x', 'y', 'z'] as const) {
    $(`#position-${axis}`).value = String(+selected.position[axis].toFixed(1));
    $(`#rotation-${axis}`).value = String(+degrees(selected.rotation[axis]).toFixed(1));
  }
  document.querySelectorAll<HTMLButtonElement>('[data-length]').forEach((button) => button.classList.toggle('active', +button.dataset.length === selected.userData.length));
}

function applyAxisValue(kind: 'position' | 'rotation', axis: Axis, value: number) {
  if (!selected) return;
  if (!Number.isFinite(value) || Math.abs(value) > (kind === 'position' ? 1000000 : 36000)) { updateFields(); return; }
  const before = captureState();
  selected[kind][axis] = kind === 'rotation' ? radians(value) : value;
  applyAssemblyMove();
  updateFields(); updateOutline();
  syncTransform();
  recordEdit(before);
}

for (const kind of ['position', 'rotation'] as const) {
  for (const axis of ['x', 'y', 'z'] as const) {
    const label = document.createElement('div');
    label.className = kind === 'rotation' ? 'axis-input rotation-axis' : 'axis-input';
    label.innerHTML = `<span>${axis.toUpperCase()}</span><input id="${kind}-${axis}" type="number" step="${kind === 'position' ? 10 : 5}" aria-label="${kind === 'position' ? 'Положение' : 'Поворот'} ${axis.toUpperCase()}" />`;
    if (kind === 'rotation') {
      for (const turn of [-90, 90]) {
        const button = document.createElement('button');
        button.type = 'button';
        const labelText = `Повернуть ${axis.toUpperCase()} на ${turn} градусов`;
        button.title = labelText;
        button.setAttribute('aria-label', labelText);
        button.innerHTML = turn < 0
          ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8.5A6 6 0 1 1 6.5 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M8 4.5v4.5h4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>'
          : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 8.5A6 6 0 1 0 17.5 14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M16 4.5v4.5h-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        button.onclick = () => applyAxisValue('rotation', axis, degrees(selected?.rotation[axis] || 0) + turn);
        label.append(button);
      }
    }
    $(`#${kind}-fields`).append(label);
    label.querySelector('input').addEventListener('change', (event) => applyAxisValue(kind, axis, (event.target as HTMLInputElement).valueAsNumber));
  }
}

function rebuildBody(element: THREE.Object3D) {
  disposeElement(element);
  element.clear();
  const replacement = buildElement(element.userData.typeId, element.userData.length, element.userData.color);
  [...replacement.children].forEach((child) => element.add(child));
}

function changeColor(color: string) {
  const item = selected && catalogById.get(selected.userData.typeId);
  if (!supportsPipeColor(item) || !pipeColorById.has(color) || selected.userData.color === color) return;
  const before = captureState();
  selected.userData.color = color;
  rebuildBody(selected);
  updateFields();
  updateCount();
  recordEdit(before);
}

function changeLength(value: number) {
  if (!selected || catalogById.get(selected.userData.typeId).kind !== 'pipe' || catalogById.get(selected.userData.typeId).fixed) return;
  if (!Number.isFinite(value) || value < 150 || value > 6000) { toast('Допустимая длина: от 150 до 6000 мм'); updateFields(); return; }
  const before = captureState();
  selected.userData.length = value;
  rebuildBody(selected);
  connections.reflow(selected);
  updateFields(); updateConnections(); updateOutline(); updateCount();
  recordEdit(before);
}
$('#length').onchange = () => changeLength($('#length').valueAsNumber);
document.querySelectorAll<HTMLButtonElement>('[data-length]').forEach((button) => button.onclick = () => changeLength(+button.dataset.length));
function selectedPort() {
  if (!selected) return null;
  return getPorts(catalogById.get(selected.userData.typeId), selected.userData.length).find((port) => port.id === $('#port-select').value);
}
function updateConnections() {
  if (!selected) return;
  const count = connections.component(selected).size;
  $('#assembly-status').textContent = count > 1 ? `В сборке: ${count} деталей. При перемещении они двигаются вместе.` : 'Независимая деталь — перемещается отдельно.';
  $('#detach-element').hidden = count === 1;
  const previous = $('#port-select').value;
  const item = catalogById.get(selected.userData.typeId);
  const ports = getPorts(item, selected.userData.length);
  $('#port-select').replaceChildren(...ports.map((port) => new Option(`${port.name} · Ø${port.diameter} · ${connections.at(selected, port.id) ? 'занят' : port.socket ? 'раструб' : 'гладкий'}`, port.id)));
  $('#port-select').value = ports.some((port) => port.id === previous && !connections.at(selected, port.id)) ? previous : (ports.find((port) => port.id === 'out' && !connections.at(selected, port.id)) || ports.find((port) => !connections.at(selected, port.id)) || ports[0])?.id || '';
  $('#port-select').disabled = !ports.length;
  updateJointRotation();
  updateTargets();
}
function updateTargets() {
  if (!selected) return;
  const port = selectedPort();
  const previous = $('#target-select').value;
  const occupied = port && connections.at(selected, port.id);
  $('#join-controls').hidden = !!occupied || !port;
  $('#occupied-controls').hidden = !occupied;
  $('#connect').hidden = !!occupied || !port;
  const existing = $('#join-mode').value === 'existing';
  const items = !port || occupied ? [] : existing
    ? pipes.filter((element) => elementPorts(element).some((input) => connections.canJoin(selected, port.id, element, input.id))).map((element) => ({ id: String(element.userData.id), name: `${catalogById.get(element.userData.typeId).name} · #${element.userData.id}` }))
    : catalog.filter((item) => getPorts(item).some((input) => compatiblePorts(port, input))).map((item) => ({ id: item.id, name: item.name }));
  $('#target-select').replaceChildren(...items.map((item) => new Option(item.name, item.id)));
  if (items.some((item) => item.id === previous)) $('#target-select').value = previous;
  $('#target-select').disabled = !items.length;
  $('.connection-note').textContent = !port ? 'Монтажный элемент: размещайте по XYZ вокруг трубы.' : occupied ? 'Стык занят. Можно повернуть выбранную сторону или разъединить.' : !items.length ? 'Нет совместимых свободных концов. Два гладких конца требуют муфту.' : 'Зелёный — свободный, синий — выбранный, оранжевый — занятый конец.';
  updateTargetPorts(); updatePortMarkers();
}
function targetDefinition() {
  if ($('#join-mode').value === 'existing') {
    const element = pipes.find((element) => String(element.userData.id) === $('#target-select').value);
    return element ? { element, item: catalogById.get(element.userData.typeId), length: element.userData.length } : null;
  }
  const item = catalogById.get($('#target-select').value);
  return item ? { item, length: item.length } : null;
}
function updateTargetPorts() {
  const target = targetDefinition(), source = selectedPort(), previous = $('#target-port').value;
  const ports = target && source ? getPorts(target.item, target.length).filter((input) => target.element ? connections.canJoin(selected, source.id, target.element, input.id) : compatiblePorts(source, input)) : [];
  $('#target-port').replaceChildren(...ports.map((port) => new Option(`${port.name} · Ø${port.diameter} · ${port.socket ? 'раструб' : 'гладкий'}`, port.id)));
  if (ports.some((port) => port.id === previous)) $('#target-port').value = previous;
  $('#target-port').disabled = !ports.length;
  $('#connect').disabled = !ports.length;
}
$('#port-select').onchange = updateTargets;
$('#join-mode').onchange = updateTargets;
$('#target-select').onchange = updateTargetPorts;
$('#connect').onclick = () => {
  if (!selected) return;
  const target = targetDefinition(), source = selected, port = selectedPort(), inputId = $('#target-port').value;
  const roll = $('#join-roll').valueAsNumber;
  if (!target || !port || !inputId || !Number.isFinite(roll) || Math.abs(roll) > 360) { toast('Укажите корректный конец и угол от −360° до 360°'); return; }
  const element = target.element || createElement(target.item.id, target.length);
  const pose = connections.join(source, port.id, element, inputId, roll);
  select(element);
  toast(`Элемент присоединён · вставка ${pose.insertion} мм`);
};
$('#disconnect').onclick = () => {
  if (!selected) return;
  connections.disconnect(selected, $('#port-select').value);
  pauseSnapAfterDisconnect();
  updateConnections(); updateOutline(); toast('Стык разъединён');
};
function pauseSnapAfterDisconnect() {
  for (const member of connections.component(selected)) snapPaused.add(member);
  snapCandidate = null;
  lastPose = poseOf(selected);
}
$('#detach-element').onclick = () => {
  if (!selected) return;
  connections.remove(selected);
  pauseSnapAfterDisconnect();
  setMode('translate');
  updateConnections(); updateOutline();
  toast('Деталь отсоединена. Теперь её можно отодвинуть отдельно.');
};
for (const [id, angle] of [['twist-minus', -15], ['twist-plus', 15], ['twist-quarter', 90]] as const) {
  $(`#${id}`).onclick = () => {
    if (!selected) return;
    connections.twist(selected, $('#port-select').value, angle);
    lastPose = poseOf(selected); updateFields(); updateOutline(); syncTransform();
  };
}
$('#snap-enabled').onchange = () => { snapCandidate = null; updatePortMarkers(); };
$('#duplicate').onclick = () => { if (selected) createElement(selected.userData.typeId, selected.userData.length, selected.position.clone().add(new THREE.Vector3(0, 0, 180)), selected.quaternion.clone(), selected.userData.color); };
function removePipe(pipe: THREE.Object3D) {
  connections.remove(pipe);
  scene.remove(pipe);
  disposeElement(pipe);
  pipes.splice(pipes.indexOf(pipe), 1);
}
$('#delete').onclick = () => { if (!selected) return; removePipe(selected); select(pipes.at(-1) || null); updateCount(); };
$('#delete-all').onclick = () => {
  if (!pipes.length && !routePoints.length) return;
  select(null);
  [...pipes].forEach(removePipe);
  routePoints = [];
  routeLockedAxis = null;
  updateRouteUi();
  refreshRoutePreview();
  updateCount();
  toast('Все элементы удалены');
};
$('#reset-rotation').onclick = () => { if (selected && !jointRotationPort()) { selected.rotation.set(0, 0, 0); applyAssemblyMove(); updateFields(); updateOutline(); syncTransform(); } };
function setMode(mode: 'translate' | 'rotate') {
  transform.setMode(mode);
  $('#move').classList.toggle('active', mode === 'translate');
  $('#rotate').classList.toggle('active', mode === 'rotate');
  syncTransform();
}
$('#move').onclick = () => setMode('translate');
$('#rotate').onclick = () => setMode('rotate');

function focus(view = 'perspective') {
  const box = new THREE.Box3();
  pipes.forEach((pipe) => box.expandByObject(pipe));
  const center = pipes.length ? box.getCenter(new THREE.Vector3()) : new THREE.Vector3();
  const size = pipes.length ? box.getSize(new THREE.Vector3()).length() : 1000;
  const distance = Math.max(700, size / (2 * Math.tan(radians(camera.fov / 2))) / Math.min(camera.aspect, 1) * 1.3);
  const direction = view === 'top' ? new THREE.Vector3(0, 1, .001) : view === 'front' ? new THREE.Vector3(0, .001, 1) : new THREE.Vector3(1, .85, 1.2).normalize();
  orbit.target.copy(center);
  camera.position.copy(center).addScaledVector(direction, distance);
  orbit.update();
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
}
$('#focus').onclick = () => focus();
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => button.onclick = () => focus(button.dataset.view));
window.addEventListener('keydown', (event) => {
  if (editorStore.bomOpen || event.defaultPrevented) return;
  const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLElement && event.target.isContentEditable;
  if (!editing && (event.metaKey || event.ctrlKey) && !event.altKey && (event.code === 'KeyZ' || ['z', 'я'].includes(event.key.toLowerCase()))) {
    event.preventDefault();
    travelHistory(event.shiftKey ? 'redo' : 'undo');
    return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (event.key === 'Shift' && routeActive && routePointer && !(event.target instanceof HTMLInputElement)) syncRoutePointer(true);
  if (routeActive && key === 'escape') {
    if (routePoints.length) undoRoutePoint();
    else setRouteActive(false);
    return;
  }
  if (key === 'w' || key === 'ц') setMode('translate');
  if (key === 'e' || key === 'у') setMode('rotate');
  if (key === 'f' || key === 'а') focus();
  if ((key === 'delete' || key === 'backspace') && routeActive) { event.preventDefault(); undoRoutePoint(); return; }
  if (key === 'delete' || key === 'backspace') { event.preventDefault(); $('#delete').click(); }
  if (key === 'escape') select(null);
}, { signal: lifetime.signal });
window.addEventListener('keyup', (event) => {
  if (event.key === 'Shift' && routeActive && routePointer) syncRoutePointer(false);
}, { signal: lifetime.signal });
const raycaster = new THREE.Raycaster();
let pointerStart: { x: number; y: number; gizmo: boolean } | undefined;
renderer.domElement.addEventListener('pointerdown', (event) => { pointerStart = { x: event.clientX, y: event.clientY, gizmo: !!transform.axis }; });
renderer.domElement.addEventListener('pointerup', (event) => {
  if (event.button !== 0 || !pointerStart || pointerStart.gizmo || transform.dragging || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4) return;
  if (routeActive) {
    const result = routePointFromEvent(event);
    if (result) addRoutePoint(result);
    return;
  }
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  const marker = raycaster.intersectObjects(portMarkers.children)[0];
  if (marker?.object.userData.portId) { $('#port-select').value = marker.object.userData.portId; updateTargets(); return; }
  const hit = raycaster.intersectObjects(pipes, true)[0];
  if (hit) select(hit.object.parent); else select(null);
});
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(message: string) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2800);
}
$('#save').onclick = () => {
  const project = serializeProject(pipes, connections);
  const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'complan-project.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Проект сохранён в JSON');
};
$('#load').onclick = () => $('#file').click();
$('#file').onchange = async (event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files[0];
  if (!file) return;
  try {
    if (file.size > 2e6) throw new Error();
    const data = JSON.parse(await file.text());
    if (lifetime.signal.aborted) return;
    const entries = parseProject(data);
    const edges = parseConnections(data, entries);
    const before = captureState();
    select(null);
    [...pipes].forEach(removePipe);
    nextId = 1;
    entries.forEach((entry) => createElement(entry.typeId, entry.length, new THREE.Vector3().fromArray(entry.position), new THREE.Quaternion().fromArray(entry.quaternion).normalize(), entry.color));
    connections.edges = edges.map((edge) => ({ a: pipes[edge.a], ap: edge.ap, b: pipes[edge.b], bp: edge.bp }));
    select(pipes.at(-1) || null);
    updateCount(); focus(); toast('Проект открыт');
    recordEdit(before);
  } catch { toast('Не удалось открыть: некорректный файл проекта'); }
  input.value = '';
};
const resizeObserver = new ResizeObserver(() => {
  const { width, height } = viewport.getBoundingClientRect();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
});
resizeObserver.observe(viewport);
for (const id of ['connect', 'disconnect', 'detach-element', 'twist-minus', 'twist-plus', 'twist-quarter', 'apply-joint-angle', 'duplicate', 'delete', 'delete-all', 'reset-rotation']) {
  const button = $(`#${id}`);
  const action = button.onclick;
  button.onclick = (event) => {
    const before = captureState();
    action.call(button, event);
    recordEdit(before);
  };
}
const routeHint = $('.scene-bottom span');
const routeHintDefault = routeHint.textContent;

const routeLabels: THREE.Sprite[] = [];
const routeGizmos: THREE.Group[] = [];
const routeLabelUp = new THREE.Vector3();
const routeLabelSide = new THREE.Vector3();

function clearRoutePreview() {
  for (const child of [...routePreview.children]) {
    child.traverse((object) => {
      if (object instanceof THREE.Mesh) object.geometry.dispose();
      if (object instanceof THREE.Sprite || object instanceof THREE.Mesh && object.userData.disposeMaterial) {
        object.material?.map?.dispose();
        object.material?.dispose();
      }
    });
    routePreview.remove(child);
  }
  routeLabels.length = 0;
  routeGizmos.length = 0;
}

function routeSegment(start: THREE.Vector3, end: THREE.Vector3, material: THREE.Material, radius = 14) {
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length < 1) return;
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
  mesh.position.copy(start).lerp(end, .5);
  mesh.renderOrder = 5;
  routePreview.add(mesh);
}

function routeDot(position: THREE.Vector3, material: THREE.Material, radius: number) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 16, 12), material);
  mesh.position.copy(position);
  mesh.renderOrder = 6;
  routePreview.add(mesh);
}

function makeRouteSprite(text: string, color: string) {
  const font = '700 48px Manrope, Arial, sans-serif';
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  context.font = font;
  const width = Math.ceil(context.measureText(text).width + 44);
  const height = 72;
  canvas.width = width;
  canvas.height = height;
  context.font = font;
  context.fillStyle = '#ffffff';
  context.beginPath();
  context.roundRect(4, 4, width - 8, height - 8, 18);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 4;
  context.stroke();
  context.fillStyle = '#233034';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, width / 2, height / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.renderOrder = 8;
  routePreview.add(sprite);
  routeLabels.push(sprite);
  return { sprite, aspect: width / height };
}

function routeLengthLabel(start: THREE.Vector3, end: THREE.Vector3, color: string, radius: number) {
  const length = start.distanceTo(end);
  if (length < 1) return;
  const { sprite, aspect } = makeRouteSprite(`${Math.round(length)} мм`, color);
  sprite.userData.routeLabel = {
    midpoint: start.clone().lerp(end, .5),
    direction: end.clone().sub(start).normalize(),
    aspect,
    radius,
  };
}

function routeAngleMark(start: THREE.Vector3, end: THREE.Vector3, axis: THREE.Vector3) {
  const approach = start.clone().sub(end);
  if (approach.lengthSq() < 1) return;
  approach.normalize();
  const pipe = axis.clone().normalize();
  if (approach.dot(pipe) < 0) pipe.negate();
  const radians = approach.angleTo(pipe);
  const guide = approach.clone().add(pipe);
  if (guide.lengthSq() < 1e-4) guide.crossVectors(pipe, Math.abs(pipe.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0));
  guide.normalize();
  let arc = null;
  if (radians > 0.05) {
    const normal = approach.clone().cross(pipe).normalize();
    const turn = new THREE.Quaternion();
    const points = [];
    const steps = Math.max(8, Math.ceil(radians / .15));
    for (let step = 0; step <= steps; step++) {
      turn.setFromAxisAngle(normal, radians * step / steps);
      points.push(approach.clone().applyQuaternion(turn));
    }
    const positions = [];
    const inner = .78;
    for (const point of points) {
      positions.push(point.x * inner, point.y * inner, point.z * inner, point.x, point.y, point.z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const index = [];
    for (let step = 0; step < steps; step++) index.push(step * 2, step * 2 + 1, step * 2 + 2, step * 2 + 1, step * 2 + 3, step * 2 + 2);
    geometry.setIndex(index);
    const band = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: '#2f6b45', depthTest: false, transparent: true, side: THREE.DoubleSide }));
    band.userData.disposeMaterial = true;
    band.renderOrder = 7;
    arc = new THREE.Group();
    arc.position.copy(end);
    arc.add(band);
    routePreview.add(arc);
  }
  const { sprite, aspect } = makeRouteSprite(`${Math.round(THREE.MathUtils.radToDeg(radians))}°`, '#2f6b45');
  sprite.userData.routeLabel = { kind: 'angle', origin: end.clone(), guide, aspect, arc };
}

function updateRouteLabels() {
  const slope = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(renderer.domElement.clientHeight, 1);
  for (const group of routeGizmos) {
    const pixel = Math.max(camera.position.distanceTo(group.position), 1) * slope;
    group.scale.setScalar(70 * pixel);
  }
  if (!routeLabels.length) return;
  routeLabelUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  for (const sprite of routeLabels) {
    const label = sprite.userData.routeLabel;
    if (label.kind === 'angle') {
      const pixel = Math.max(camera.position.distanceTo(label.origin), 1) * slope;
      const labelPx = 22;
      const arcPx = 34;
      sprite.scale.set(labelPx * label.aspect * pixel, labelPx * pixel, 1);
      if (label.arc) label.arc.scale.setScalar(arcPx * pixel);
      sprite.position.copy(label.origin).addScaledVector(label.guide, ((label.arc ? arcPx : 16) + labelPx / 2 + 6) * pixel);
      continue;
    }
    const { midpoint, direction, aspect, radius } = label;
    const pixel = Math.max(camera.position.distanceTo(midpoint), 1) * slope;
    const labelPx = 22;
    sprite.scale.set(labelPx * aspect * pixel, labelPx * pixel, 1);
    routeLabelSide.copy(routeLabelUp).addScaledVector(direction, -routeLabelUp.dot(direction));
    if (routeLabelSide.lengthSq() < 1e-8) routeLabelSide.crossVectors(direction, routeLabelUp);
    routeLabelSide.normalize();
    sprite.position.copy(midpoint).addScaledVector(routeLabelSide, radius + (labelPx / 2 + 6) * pixel);
  }
}

function routeArrow(origin: THREE.Vector3, axis: RouteAxis, active: boolean) {
  const group = new THREE.Group();
  group.position.copy(origin);
  group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.direction);
  const material = new THREE.MeshBasicMaterial({ color: axis.color, depthTest: false, transparent: true, opacity: active ? 1 : .72 });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .62, 8), material);
  shaft.position.y = .46;
  shaft.userData.disposeMaterial = true;
  const head = new THREE.Mesh(new THREE.ConeGeometry(.12, .28, 12), material);
  head.position.y = .9;
  group.add(shaft, head);
  if (active) {
    const guide = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, 8, 6), material);
    group.add(guide);
  }
  for (const child of group.children) child.renderOrder = 9;
  routePreview.add(group);
  routeGizmos.push(group);
}

function refreshRoutePreview(cursor: THREE.Vector3 | null = null, snapped = false, pipeSnapAxis: THREE.Vector3 | null = null, drawAxis: RouteAxis | null = null) {
  clearRoutePreview();
  routePoints.forEach((point) => routeDot(point, routeMaterial, 16));
  for (let index = 1; index < routePoints.length; index++) {
    routeSegment(routePoints[index - 1], routePoints[index], routeMaterial);
    routeLengthLabel(routePoints[index - 1], routePoints[index], '#e25a12', 14);
  }
  if (routePoints.length) for (const axis of routeAxes) routeArrow(routePoints.at(-1), axis, drawAxis?.id === axis.id);
  if (cursor && routePoints.length) {
    const live = drawAxis ? routeAxisMaterials[drawAxis.id] : snapped ? routeSnapMaterial : routeLiveMaterial;
    routeSegment(routePoints.at(-1), cursor, live, 6);
    routeLengthLabel(routePoints.at(-1), cursor, drawAxis ? drawAxis.color : snapped ? '#2f6b45' : '#3f5946', 6);
    if (pipeSnapAxis) routeAngleMark(routePoints.at(-1), cursor, pipeSnapAxis);
  }
  if (cursor && snapped) routeDot(cursor, routeSnapMaterial, 24);
  updateRouteLabels();
}

function pipeAxis(element: THREE.Object3D) {
  const item = catalogById.get(element.userData.typeId);
  if (!item || item.kind !== 'pipe') return null;
  return new THREE.Vector3(1, 0, 0).applyQuaternion(element.quaternion).normalize();
}

function routePlaneHeight() {
  const value = $('#route-height').valueAsNumber;
  return Number.isFinite(value) && Math.abs(value) <= 20000 ? value : 200;
}

function routeNdc(event: RoutePointer) {
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  return ndc;
}

function axisUnderCursor(origin: THREE.Vector3, ndc: THREE.Vector2) {
  const originNdc = origin.clone().project(camera);
  const dx = ndc.x - originNdc.x;
  const dy = ndc.y - originNdc.y;
  const mousePx = Math.hypot(dx, dy) * renderer.domElement.clientHeight / 2;
  if (mousePx < 8) return null;
  let best = null;
  for (const axis of routeAxes) {
    const tip = origin.clone().addScaledVector(axis.direction, 1000).project(camera);
    let ax = tip.x - originNdc.x;
    let ay = tip.y - originNdc.y;
    const length = Math.hypot(ax, ay);
    if (length < 1e-4) continue;
    ax /= length;
    ay /= length;
    const cosine = Math.min(1, Math.abs((dx * ax + dy * ay) / Math.hypot(dx, dy)));
    const perpPx = mousePx * Math.sin(Math.acos(cosine));
    if (!best || perpPx < best.perpPx) best = { ...axis, perpPx, mousePx };
  }
  return best;
}

function pointOnAxis(origin: THREE.Vector3, direction: THREE.Vector3) {
  const rayDirection = raycaster.ray.direction;
  const offset = raycaster.ray.origin.clone().sub(origin);
  const parallel = rayDirection.dot(direction);
  const denominator = 1 - parallel * parallel;
  if (denominator < 1e-6) return null;
  const distance = (offset.dot(direction) - offset.dot(rayDirection) * parallel) / denominator;
  const point = origin.clone().addScaledVector(direction, distance);
  if (point.clone().sub(raycaster.ray.origin).dot(rayDirection) <= 0) return null;
  return point;
}

function routeDrawAxis(event: RoutePointer, ndc: THREE.Vector2) {
  if (!routePoints.length) {
    routeLockedAxis = null;
    return null;
  }
  const origin = routePoints.at(-1);
  const best = axisUnderCursor(origin, ndc);
  if (event.shiftKey) {
    if (!routeLockedAxis && best) routeLockedAxis = best;
    return routeLockedAxis;
  }
  routeLockedAxis = null;
  return best && best.perpPx < 16 ? best : null;
}

function routePointFromEvent(event: RoutePointer) {
  const ndc = routeNdc(event);
  const drawAxis = routeDrawAxis(event, ndc);
  let point = null;
  let distance = Infinity;
  const origin = routePoints.at(-1);
  if (drawAxis && origin) {
    point = pointOnAxis(origin, drawAxis.direction);
    if (point) distance = point.distanceTo(raycaster.ray.origin);
  }
  if (!point) {
    const height = routePlaneHeight();
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -height), hit)) {
      point = hit;
      distance = hit.distanceTo(raycaster.ray.origin);
    }
  }
  if (!drawAxis) {
    const meshHit = raycaster.intersectObjects(pipes, true)[0];
    if (meshHit && meshHit.distance <= distance) point = meshHit.point.clone();
  }
  if (!point || point.length() > 80000) return null;
  if (origin && origin.distanceTo(point) > 80000) return null;
  const snap = findAttachment(point, pipes, connections, { port: 260, body: 180 });
  if (snap) return { point: snap.point.clone(), snapped: true, axis: pipeAxis(snap.element), drawAxis };
  return { point, snapped: false, drawAxis };
}

function syncRoutePointer(shiftKey: boolean) {
  routePointer.shiftKey = shiftKey;
  if (!shiftKey) routeLockedAxis = null;
  const result = routePointFromEvent(routePointer);
  refreshRoutePreview(result?.point ?? null, result?.snapped, result?.axis ?? null, result?.drawAxis ?? null);
}

function pointsLabel(count: number) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} точка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} точки`;
  return `${count} точек`;
}

function updateRouteUi() {
  let length = 0;
  for (let index = 1; index < routePoints.length; index++) length += routePoints[index].distanceTo(routePoints[index - 1]);
  $('#route-meta').textContent = routePoints.length
    ? `${pointsLabel(routePoints.length)}, ${length >= 1000 ? `${(length / 1000).toFixed(1)} м` : `${Math.round(length)} мм`}`
    : 'Кликните первую точку линии';
  $('#route-build').disabled = routePoints.length < 2;
  $('#route-clear').disabled = !routePoints.length;
  $('#route-undo').disabled = !routePoints.length;
  $('#route-draw').classList.toggle('active', routeActive);
  $('#route-draw').textContent = routeActive ? 'Рисование включено' : 'Рисовать линию';
  $('#route-draw').setAttribute('aria-pressed', String(routeActive));
  $('#route-mode').textContent = routeActive ? `Ø${routeDiameter}` : 'выкл';
  document.querySelectorAll<HTMLButtonElement>('[data-route-diameter]').forEach((button) => button.classList.toggle('active', +button.dataset.routeDiameter === routeDiameter));
  routeHint.textContent = routeActive ? 'ЛКМ - точка, вдоль оси или Shift - фиксация оси, ПКМ - обзор' : routeHintDefault;
}

function setRouteActive(active: boolean) {
  routeActive = active;
  viewport.classList.toggle('routing', active);
  if (active) {
    orbit.mouseButtons.LEFT = null;
    orbit.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    select(null);
  } else {
    orbit.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    orbit.mouseButtons.RIGHT = THREE.MOUSE.PAN;
    syncTransform();
  }
  if (!active) {
    routeLockedAxis = null;
    refreshRoutePreview();
  }
  updateRouteUi();
}

function addRoutePoint(result: NonNullable<ReturnType<typeof routePointFromEvent>>) {
  if (routePoints.at(-1)?.distanceTo(result.point) < 80) { toast('Точка слишком близко к предыдущей'); return; }
  if (routePoints.length >= 40) { toast('Для одной линии достаточно 40 точек'); return; }
  routePoints.push(result.point.clone());
  $('#route-height').value = String(Math.round(result.point.y));
  updateRouteUi();
  refreshRoutePreview();
}

function undoRoutePoint() {
  routePoints.pop();
  updateRouteUi();
  refreshRoutePreview();
}

document.querySelectorAll<HTMLButtonElement>('[data-route-diameter]').forEach((button) => button.onclick = () => {
  routeDiameter = +button.dataset.routeDiameter;
  setRouteActive(true);
});
$('#route-draw').onclick = () => setRouteActive(!routeActive);
$('#route-undo').onclick = undoRoutePoint;
$('#route-clear').onclick = () => { routePoints = []; updateRouteUi(); refreshRoutePreview(); };
$('#route-build').onclick = () => {
  if (routePoints.length < 2) return;
  const before = captureState();
  try {
    const result = assembleRoute({
      points: routePoints,
      diameter: routeDiameter,
      elements: pipes,
      graph: connections,
      create: (typeId, length) => createElement(typeId, length, new THREE.Vector3(), new THREE.Quaternion(), getCatalogColor(), true),
      rebuild: rebuildBody,
    });
    routePoints = [];
    refreshRoutePreview();
    select(null);
    updateCount();
    updateRouteUi();
    recordEdit(before);
    toast(result.message);
  } catch (error) {
    restoreState(before);
    if (routeActive) select(null);
    toast(error.message || 'Не удалось построить канализацию');
  }
};
renderer.domElement.addEventListener('pointermove', (event) => {
  if (!routeActive) return;
  routePointer = { clientX: event.clientX, clientY: event.clientY, shiftKey: event.shiftKey };
  const result = routePointFromEvent(routePointer);
  refreshRoutePreview(result?.point ?? null, result?.snapped, result?.axis ?? null, result?.drawAxis ?? null);
});
renderer.domElement.addEventListener('contextmenu', (event) => { if (routeActive) event.preventDefault(); });
updateRouteUi();
createElement();
renderer.setAnimationLoop(() => { orbit.update(); updateRouteLabels(); renderer.render(scene, camera); });
return () => {
  lifetime.abort();
  clearTimeout(toastTimer);
  resizeObserver.disconnect();
  renderer.setAnimationLoop(null);
  transform.detach();
  transform.dispose();
  orbit.dispose();
  clearRoutePreview();
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Sprite) {
      if ('geometry' in object) object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  for (const material of [...materials, routeMaterial, routeLiveMaterial, routeSnapMaterial, ...Object.values(routeAxisMaterials)]) material.dispose();
  sun.shadow.dispose();
  renderer.dispose();
  renderer.domElement.remove();
  $('#position-fields').replaceChildren();
  $('#rotation-fields').replaceChildren();
  editorStore.setCommands(null, null);
  editorStore.updateElements([]);
};
}
