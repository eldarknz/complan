import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import './style.css';
import './catalog.css';
import './connections.css';
import { catalog, catalogById } from './catalog.js';
import { buildElement, getPorts, compatiblePorts, disposeElement } from './elements.js';
import { parseProject, parseConnections, serializeProject } from './project.js';
import { initializeInterface, updateBillOfMaterials } from './interface.js';
import { Connections, elementPorts, findPort, poseOf, nearestConnection } from './connections.js';
import { CommandHistory } from './history.js';

const $ = (selector) => document.querySelector(selector);
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
});
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

const pipes = [];
const connections = new Connections();
let lastPose = null;
let snapCandidate = null;
const snapPaused = new WeakSet();
let translatedDuringDrag = false;
const portMarkers = new THREE.Group();
scene.add(portMarkers);
let selected = null;
let nextId = 1;
let outline;
const radians = THREE.MathUtils.degToRad;
const degrees = THREE.MathUtils.radToDeg;
const history = new CommandHistory(10);
let dragBefore = null;
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
  const port = jointRotationPort();
  for (const input of document.querySelectorAll('#rotation-fields input')) input.disabled = !!port;
  $('#reset-rotation').disabled = !!port;
  $('#rotation-fields').title = port ? 'Для поворота вокруг стыка используйте кольцо или поле «Повернуть на» выше.' : '';
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

function restoreState(state) {
  select(null);
  [...pipes].forEach(removePipe);
  state.project.elements.forEach((entry, index) => {
    const element = createElement(entry.typeId, entry.length, new THREE.Vector3().fromArray(entry.position), new THREE.Quaternion().fromArray(entry.quaternion));
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

function recordEdit(before) {
  history.record(before, captureState());
  updateHistoryButtons();
}

function travelHistory(direction) {
  if (transform.dragging) return;
  const state = direction === 'undo' ? history.undo() : history.redo();
  if (!state) return;
  restoreState(state);
  updateHistoryButtons();
  toast(direction === 'undo' ? 'Действие отменено' : 'Действие повторено');
}
$('#undo').onclick = () => travelHistory('undo');
$('#redo').onclick = () => travelHistory('redo');

function createElement(typeId = 'pipe-110', length = catalogById.get(typeId).length, position = new THREE.Vector3(0, 100, 0), quaternion = new THREE.Quaternion()) {
  const pipe = buildElement(typeId, length);
  pipe.userData.id = nextId++;
  pipe.position.copy(position);
  pipe.quaternion.copy(quaternion);
  scene.add(pipe);
  pipes.push(pipe);
  select(pipe);
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
  for (const marker of [...portMarkers.children]) { marker.geometry.dispose(); marker.material.dispose(); portMarkers.remove(marker); }
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

function select(pipe) {
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
  const presets = $('#length').closest('section').querySelector('.presets');
  presets.hidden = item.kind !== 'pipe' || !!item.fixed;
  presets.replaceChildren(...(item.lengths || []).map((length) => {
    const button = document.createElement('button'); button.textContent = length; button.dataset.length = length;
    button.onclick = () => changeLength(length); return button;
  }));
  $('#length').value = selected.userData.length;
  for (const axis of ['x', 'y', 'z']) {
    $(`#position-${axis}`).value = +selected.position[axis].toFixed(1);
    $(`#rotation-${axis}`).value = +degrees(selected.rotation[axis]).toFixed(1);
  }
  document.querySelectorAll('[data-length]').forEach((button) => button.classList.toggle('active', +button.dataset.length === selected.userData.length));
}

for (const kind of ['position', 'rotation']) {
  for (const axis of ['x', 'y', 'z']) {
    const label = document.createElement('label');
    label.className = 'axis-input';
    label.innerHTML = `<span>${axis.toUpperCase()}</span><input id="${kind}-${axis}" type="number" step="${kind === 'position' ? 10 : 5}" aria-label="${kind === 'position' ? 'Положение' : 'Поворот'} ${axis.toUpperCase()}" />`;
    $(`#${kind}-fields`).append(label);
    label.querySelector('input').addEventListener('change', (event) => {
      if (!selected) return;
      const value = event.target.valueAsNumber;
      if (!Number.isFinite(value) || Math.abs(value) > (kind === 'position' ? 1000000 : 36000)) { updateFields(); return; }
      const before = captureState();
      selected[kind][axis] = kind === 'rotation' ? radians(value) : value;
      applyAssemblyMove();
      updateFields(); updateOutline();
      syncTransform();
      recordEdit(before);
    });
  }
}

function changeLength(value) {
  if (!selected || catalogById.get(selected.userData.typeId).kind !== 'pipe' || catalogById.get(selected.userData.typeId).fixed) return;
  if (!Number.isFinite(value) || value < 150 || value > 6000) { toast('Допустимая длина: от 150 до 6000 мм'); updateFields(); return; }
  const before = captureState();
  selected.userData.length = value;
  disposeElement(selected);
  selected.clear();
  const replacement = buildElement(selected.userData.typeId, value);
  [...replacement.children].forEach((child) => selected.add(child));
  connections.reflow(selected);
  updateFields(); updateConnections(); updateOutline(); updateCount();
  recordEdit(before);
}
$('#length').addEventListener('change', (event) => changeLength(event.target.valueAsNumber));
document.querySelectorAll('[data-length]').forEach((button) => button.addEventListener('click', () => changeLength(+button.dataset.length)));
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
for (const [id, angle] of [['twist-minus', -15], ['twist-plus', 15], ['twist-quarter', 90]]) {
  $(`#${id}`).onclick = () => {
    if (!selected) return;
    connections.twist(selected, $('#port-select').value, angle);
    lastPose = poseOf(selected); updateFields(); updateOutline(); syncTransform();
  };
}
$('#snap-enabled').onchange = () => { snapCandidate = null; updatePortMarkers(); };
$('#duplicate').onclick = () => { if (selected) createElement(selected.userData.typeId, selected.userData.length, selected.position.clone().add(new THREE.Vector3(0, 0, 180)), selected.quaternion.clone()); };
function removePipe(pipe) {
  connections.remove(pipe);
  scene.remove(pipe);
  disposeElement(pipe);
  pipes.splice(pipes.indexOf(pipe), 1);
}
$('#delete').onclick = () => { if (!selected) return; removePipe(selected); select(pipes.at(-1) || null); updateCount(); };
$('#reset-rotation').onclick = () => { if (selected && !jointRotationPort()) { selected.rotation.set(0, 0, 0); applyAssemblyMove(); updateFields(); updateOutline(); syncTransform(); } };
function setMode(mode) {
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
  document.querySelectorAll('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
}
$('#focus').onclick = () => focus();
document.querySelectorAll('[data-view]').forEach((button) => button.onclick = () => focus(button.dataset.view));
window.addEventListener('keydown', (event) => {
  const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target.isContentEditable;
  if (!editing && (event.metaKey || event.ctrlKey) && !event.altKey && (event.code === 'KeyZ' || ['z', 'я'].includes(event.key.toLowerCase()))) {
    event.preventDefault();
    travelHistory(event.shiftKey ? 'redo' : 'undo');
    return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.ctrlKey || event.metaKey || event.altKey) return;
  const key = event.key.toLowerCase();
  if (key === 'w' || key === 'ц') setMode('translate');
  if (key === 'e' || key === 'у') setMode('rotate');
  if (key === 'f' || key === 'а') focus();
  if (key === 'delete' || key === 'backspace') { event.preventDefault(); $('#delete').click(); }
  if (key === 'escape') select(null);
});
const raycaster = new THREE.Raycaster();
let pointerStart;
renderer.domElement.addEventListener('pointerdown', (event) => { pointerStart = { x: event.clientX, y: event.clientY, gizmo: !!transform.axis }; });
renderer.domElement.addEventListener('pointerup', (event) => {
  if (event.button !== 0 || !pointerStart || pointerStart.gizmo || transform.dragging || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4) return;
  const rect = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  const marker = raycaster.intersectObjects(portMarkers.children)[0];
  if (marker?.object.userData.portId) { $('#port-select').value = marker.object.userData.portId; updateTargets(); return; }
  const hit = raycaster.intersectObjects(pipes, true)[0];
  if (hit) select(hit.object.parent); else select(null);
});
let toastTimer;
function toast(message) {
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
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2e6) throw new Error();
    const data = JSON.parse(await file.text());
    const entries = parseProject(data);
    const edges = parseConnections(data, entries);
    const before = captureState();
    select(null);
    [...pipes].forEach(removePipe);
    nextId = 1;
    entries.forEach((entry) => createElement(entry.typeId, entry.length, new THREE.Vector3().fromArray(entry.position), new THREE.Quaternion().fromArray(entry.quaternion).normalize()));
    connections.edges = edges.map((edge) => ({ a: pipes[edge.a], ap: edge.ap, b: pipes[edge.b], bp: edge.bp }));
    select(pipes.at(-1) || null);
    updateCount(); focus(); toast('Проект открыт');
    recordEdit(before);
  } catch { toast('Не удалось открыть: некорректный файл проекта'); }
  event.target.value = '';
};
new ResizeObserver(() => {
  const { width, height } = viewport.getBoundingClientRect();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}).observe(viewport);
for (const id of ['connect', 'disconnect', 'detach-element', 'twist-minus', 'twist-plus', 'twist-quarter', 'apply-joint-angle', 'duplicate', 'delete', 'reset-rotation']) {
  const button = $(`#${id}`);
  const action = button.onclick;
  button.onclick = (event) => {
    const before = captureState();
    action(event);
    recordEdit(before);
  };
}
createElement();
renderer.setAnimationLoop(() => { orbit.update(); renderer.render(scene, camera); });
