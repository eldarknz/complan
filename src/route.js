import * as THREE from 'three';
import { catalogById } from './catalog.js';
import { connectionPose, getPorts } from './elements.js';
import { findPort } from './connections.js';

const ELBOW_ANGLES = [15, 30, 45, 67, 87];
const TEE_ANGLES = [45, 67, 87];

export function insertionDepth(diameter) {
  return diameter === 110 ? 60 : 30;
}

export function stockLengths(diameter) {
  return catalogById.get(`pipe-${diameter}`)?.lengths?.slice() ?? [];
}

export function elbowReach(diameter, angle) {
  const radians = THREE.MathUtils.degToRad(angle);
  return diameter * .7 + diameter * Math.tan(radians / 2);
}

export function chooseElbows(deflection) {
  if (!(deflection >= 7)) return [];
  const single = ELBOW_ANGLES.map((angle) => ({ angles: [angle], error: Math.abs(angle - deflection) }))
    .reduce((best, item) => item.error < best.error ? item : best);
  let pair = null;
  for (const first of ELBOW_ANGLES) {
    for (const second of ELBOW_ANGLES) {
      const error = Math.abs(first + second - deflection);
      const closer = !pair || error < pair.error || (error === pair.error && (first > pair.angles[0] || (first === pair.angles[0] && second > pair.angles[1])));
      if (closer) pair = { angles: [first, second], error };
    }
  }
  if (single.error <= 6) return single.angles;
  return pair && pair.error < single.error ? pair.angles : single.angles;
}

function nearestStock(value, diameter) {
  const stock = stockLengths(diameter);
  if (!stock.length || !(value > 0)) return null;
  return stock.reduce((best, length) => Math.abs(length - value) < Math.abs(best - value) ? length : best);
}

export function fitPipeLengths(target, diameter) {
  const stock = stockLengths(diameter).slice().sort((left, right) => right - left);
  if (!stock.length || !(target > 0)) return [];
  const lengths = [];
  let remaining = target;
  while (remaining > 0) {
    const next = stock.find((length) => length <= remaining);
    if (!next) break;
    lengths.push(next);
    remaining -= next;
  }
  return lengths;
}

export function simplifyRoute(points, minLength = 80, minTurn = 7) {
  const cleaned = [];
  for (const point of points) {
    const next = point.clone();
    if (!cleaned.length || cleaned.at(-1).distanceTo(next) >= minLength) cleaned.push(next);
  }
  if (cleaned.length < 3) return cleaned;
  const simplified = [cleaned[0]];
  for (let index = 1; index < cleaned.length - 1; index++) {
    const incoming = cleaned[index].clone().sub(simplified.at(-1)).normalize();
    const outgoing = cleaned[index + 1].clone().sub(cleaned[index]).normalize();
    if (THREE.MathUtils.radToDeg(incoming.angleTo(outgoing)) >= minTurn) simplified.push(cleaned[index]);
  }
  simplified.push(cleaned.at(-1));
  return simplified;
}

function segmentPlan(points) {
  const lengths = [];
  const directions = [];
  for (let index = 0; index < points.length - 1; index++) {
    const delta = points[index + 1].clone().sub(points[index]);
    const length = delta.length();
    if (length < 1) continue;
    lengths.push(Math.min(length, 100000));
    directions.push(delta.multiplyScalar(1 / length));
  }
  const turns = [];
  for (let index = 0; index < directions.length - 1; index++) {
    const normal = directions[index].clone().cross(directions[index + 1]);
    const deflection = THREE.MathUtils.radToDeg(directions[index].angleTo(directions[index + 1]));
    const angles = normal.lengthSq() < 1e-8 ? [] : chooseElbows(deflection);
    turns.push({ angles, normal: angles.length ? normal.normalize() : null });
  }
  turns.push({ angles: [], normal: null });
  return { lengths, directions, turns };
}

function fallback(message) {
  const error = new Error(message);
  error.routeFallback = true;
  return error;
}

export function findAttachment(point, elements, graph, thresholds = { port: 220, body: 140 }) {
  let bestPort = null;
  let bestBody = null;
  for (const element of elements) {
    const item = catalogById.get(element.userData.typeId);
    if (!item || item.accessory) continue;
    for (const port of getPorts(item, element.userData.length)) {
      if (graph.at(element, port.id)) continue;
      const world = port.position.clone().applyQuaternion(element.quaternion).add(element.position);
      const distance = world.distanceTo(point);
      if (distance <= thresholds.port && (!bestPort || distance < bestPort.distance)) bestPort = { kind: 'port', element, port, distance, point: world };
    }
    if (item.kind !== 'pipe' || item.plain || item.fixed) continue;
    const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(element.quaternion);
    const along = point.clone().sub(element.position).dot(axis);
    if (along < 200 || along > element.userData.length - 200) continue;
    const projected = element.position.clone().addScaledVector(axis, along);
    const distance = projected.distanceTo(point);
    if (distance <= thresholds.body && (!bestBody || distance < bestBody.distance)) bestBody = { kind: 'body', element, distance, point: projected, along, axis };
  }
  if (bestPort && (!bestBody || bestPort.distance <= bestBody.distance + 40)) return bestPort;
  return bestBody;
}

function axisOf(element) {
  return new THREE.Vector3(1, 0, 0).applyQuaternion(element.quaternion).normalize();
}

function offAxisAngle(axis, direction) {
  if (direction.lengthSq() < 1) return 0;
  const deflection = THREE.MathUtils.radToDeg(axis.angleTo(direction.clone().normalize()));
  return Math.min(deflection, 180 - deflection);
}

function pipeRun(element) {
  const item = catalogById.get(element.userData.typeId);
  return item?.kind === 'pipe' && !item.plain && !item.fixed ? item : null;
}

function portWorld(element, portId) {
  const port = findPort(element, portId);
  return {
    position: port.position.clone().applyQuaternion(element.quaternion).add(element.position),
    direction: port.direction.clone().applyQuaternion(element.quaternion).normalize(),
  };
}

function basisQuaternion(direction, upHint) {
  const x = direction.clone().normalize();
  let y = upHint.clone().addScaledVector(x, -upHint.dot(x));
  if (y.lengthSq() < 1e-8) {
    const up = Math.abs(x.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    y = up.addScaledVector(x, -up.dot(x));
  }
  y.normalize();
  const z = x.clone().cross(y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

function rollToAim(source, sourcePortId, targetItem, targetPortId, localDirection, desiredWorld) {
  const sourcePort = findPort(source, sourcePortId);
  const pose = connectionPose(source, sourcePort, targetItem, targetItem.length, targetPortId, 0);
  if (!pose) return 0;
  const axis = sourcePort.direction.clone().applyQuaternion(source.quaternion).normalize();
  const project = (vector) => vector.clone().addScaledVector(axis, -vector.dot(axis));
  const from = project(localDirection.clone().applyQuaternion(pose.quaternion));
  const to = project(desiredWorld);
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return 0;
  from.normalize();
  to.normalize();
  return THREE.MathUtils.radToDeg(Math.atan2(from.clone().cross(to).dot(axis), from.dot(to)));
}

function connect(graph, source, sourcePort, target, aim = null) {
  const item = catalogById.get(target.userData.typeId);
  const targetPort = findPort(source, sourcePort).socket ? 'in' : 'out';
  const exitPort = targetPort === 'in' ? 'out' : 'in';
  const exit = getPorts(item, target.userData.length).find((port) => port.id === exitPort);
  const roll = aim ? rollToAim(source, sourcePort, item, targetPort, exit.direction, aim) : 0;
  graph.join(source, sourcePort, target, targetPort, roll);
  return exitPort;
}

function restoreTwist(element, portId, quaternionBefore, graph) {
  const axis = portWorld(element, portId).direction;
  const delta = quaternionBefore.clone().multiply(element.quaternion.clone().invert()).normalize();
  const angle = THREE.MathUtils.radToDeg(2 * Math.atan2(new THREE.Vector3(delta.x, delta.y, delta.z).dot(axis), delta.w));
  if (Number.isFinite(angle) && Math.abs(angle) > .05) graph.twist(element, portId, angle);
}

function chooseTee(main, branch, deflection) {
  let best = null;
  for (const angle of TEE_ANGLES) {
    const item = catalogById.get(`tee-${main}-${branch}-${angle}`);
    if (!item) continue;
    const error = Math.abs(angle - deflection);
    if (!best || error < best.error) best = { item, angle, error };
  }
  return best;
}

function otherEnd(edge, element) {
  return edge.a === element ? { element: edge.b, port: edge.bp } : { element: edge.a, port: edge.ap };
}

function insertTee(pipe, along, desired, branchDiameter, graph, make, rebuild) {
  const item = catalogById.get(pipe.userData.typeId);
  if (!item || item.kind !== 'pipe' || item.plain || item.fixed) throw fallback('Ответвление ставится только на прямую трубу. Линия построена отдельно');
  const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(pipe.quaternion).normalize();
  if (desired.length() < 20) throw fallback('Подведите линию к трубе более длинным отрезком');
  const deflection = THREE.MathUtils.radToDeg(axis.angleTo(desired.clone().normalize()));
  const tee = chooseTee(item.diameter, branchDiameter, deflection);
  if (!tee) throw fallback(`Нет тройника для отвода Ø${branchDiameter} от трубы Ø${item.diameter}. Линия построена отдельно`);
  if (pipe.userData.length < tee.item.length + 150) throw fallback('Труба слишком короткая для тройника. Линия построена отдельно');
  const branch = getPorts(tee.item).find((port) => port.id === 'branch');
  const depth = insertionDepth(item.diameter);
  const upstreamStock = stockLengths(item.diameter).filter((length) => length <= pipe.userData.length - 50);
  const idealUpstream = along - branch.position.x + depth;
  const upstream = upstreamStock.reduce((best, length) => best == null || Math.abs(length - idealUpstream) < Math.abs(best - idealUpstream) ? length : best, null);
  if (!upstream) throw fallback('Не хватает длины трубы для тройника. Линия построена отдельно');
  const downstreamNeed = pipe.userData.length - upstream - tee.item.length + depth * 2;
  const downstream = downstreamNeed >= 80 ? nearestStock(downstreamNeed, item.diameter) : null;
  const partnerEdge = graph.at(pipe, 'out');
  const partner = partnerEdge ? otherEnd(partnerEdge, pipe) : null;
  const saved = partner ? partner.element.quaternion.clone() : null;
  if (partnerEdge) graph.disconnect(pipe, 'out');
  pipe.userData.length = upstream;
  rebuild(pipe);
  const fitting = make(tee.item.id, tee.item.length);
  const roll = rollToAim(pipe, 'out', tee.item, 'in', branch.direction, desired);
  graph.join(pipe, 'out', fitting, 'in', roll);
  if (downstream) {
    const tail = make(`pipe-${item.diameter}`, downstream);
    graph.join(fitting, 'out', tail, 'in');
    if (partner) {
      graph.join(tail, 'out', partner.element, partner.port);
      restoreTwist(partner.element, partner.port, saved, graph);
    }
  } else if (partner) {
    graph.join(fitting, 'out', partner.element, partner.port);
    restoreTwist(partner.element, partner.port, saved, graph);
  }
  return fitting;
}

function attachToPort(element, port, routeDiameter, graph, make) {
  const sourceDiameter = port.diameter;
  let current = element;
  let currentPort = port.id;
  const open = () => ({ element: current, port: currentPort });
  if (sourceDiameter === routeDiameter) return open();
  const reducer = catalogById.get('reducer-110-50');
  if (!reducer || ![50, 110].includes(sourceDiameter) || ![50, 110].includes(routeDiameter)) {
    throw fallback('Нет перехода между этими диаметрами. Линия построена отдельно');
  }
  if (sourceDiameter === 110 && routeDiameter === 50) {
    if (!port.socket) {
      const coupling = catalogById.get('coupling-110');
      const fitting = make(coupling.id, coupling.length);
      graph.join(current, currentPort, fitting, 'in');
      current = fitting;
      currentPort = 'out';
    }
    const fitting = make(reducer.id, reducer.length);
    graph.join(current, currentPort, fitting, 'in');
    return { element: fitting, port: 'out' };
  }
  if (port.socket) throw fallback('Переход на Ø110 ставится на гладкий конец Ø50. Линия построена отдельно');
  const fitting = make(reducer.id, reducer.length);
  graph.join(current, currentPort, fitting, 'out');
  const coupling = catalogById.get('coupling-110');
  const sleeve = make(coupling.id, coupling.length);
  graph.join(fitting, 'in', sleeve, 'in');
  return { element: sleeve, port: 'out' };
}

function describe(elements) {
  const counts = new Map();
  for (const element of elements) {
    const item = catalogById.get(element.userData.typeId);
    const name = item.kind === 'pipe' ? `труба Ø${item.diameter}` : item.name;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => count > 1 ? `${name} x ${count}` : name).join(', ');
}

export function assembleRoute({ points, diameter, elements, graph, create, rebuild }) {
  const route = simplifyRoute(points.map((point) => point.clone()));
  if (![50, 110].includes(diameter)) throw new Error('Автоподбор поддерживает только Ø50 и Ø110');
  if (route.length < 2) throw new Error('Нужны хотя бы две точки, расстояние между ними от 80 мм');
  const startHit = findAttachment(route[0], elements, graph);
  const endHit = findAttachment(route.at(-1), elements, graph);
  let ordered = route;
  let hit = null;
  if (startHit || endHit) {
    if (endHit && (!startHit || endHit.distance < startHit.distance)) {
      ordered = route.slice().reverse();
      hit = endHit;
    } else hit = startHit;
  }
  if (hit) ordered[0].copy(hit.point);
  const created = [];
  const make = (typeId, length) => {
    const element = create(typeId, length ?? catalogById.get(typeId).length);
    created.push(element);
    return element;
  };
  const notes = [];
  let anchor = null;
  const approach = ordered[1].clone().sub(ordered[0]);
  const angledIntoPipe = hit?.kind === 'port' && pipeRun(hit.element) && offAxisAngle(axisOf(hit.element), approach) > 18;
  if (hit && (hit.kind === 'body' || angledIntoPipe)) {
    try {
      const along = hit.kind === 'body'
        ? hit.along
        : THREE.MathUtils.clamp(hit.point.clone().sub(hit.element.position).dot(axisOf(hit.element)), 0, hit.element.userData.length);
      anchor = { element: insertTee(hit.element, along, approach, diameter, graph, make, rebuild), port: 'branch' };
    } catch (error) {
      if (!error.routeFallback) throw error;
      if (!angledIntoPipe) {
        notes.push(error.message);
        hit = null;
      }
    }
  }
  if (!anchor && hit?.kind === 'port') {
    try {
      anchor = attachToPort(hit.element, hit.port, diameter, graph, make);
    } catch (error) {
      if (!error.routeFallback) throw error;
      notes.push(error.message);
      hit = null;
    }
  }
  const plan = segmentPlan(ordered);
  if (!plan.lengths.length) throw new Error('Линия слишком короткая');
  let heading = anchor ? portWorld(anchor.element, anchor.port).direction : plan.directions[0].clone();
  const align = new THREE.Quaternion().setFromUnitVectors(plan.directions[0], heading);
  if (anchor && THREE.MathUtils.radToDeg(plan.directions[0].angleTo(heading)) > 18) notes.push('Первый отрезок выровнен по оси существующей детали');
  for (const turn of plan.turns) if (turn.normal) turn.normal.applyQuaternion(align);
  let consumed = 0;
  if (anchor) consumed = portWorld(anchor.element, anchor.port).position.sub(ordered[0]).dot(heading);
  let last = anchor?.element ?? null;
  let lastPort = anchor?.port ?? null;
  const placeElbows = (turn) => {
    if (!turn.angles.length || !turn.normal) return 0;
    const before = last ? portWorld(last, lastPort).position.clone() : ordered[0].clone();
    const incoming = heading.clone();
    for (const angle of turn.angles) {
      const item = catalogById.get(`elbow-${diameter}-${angle}`);
      const aim = heading.clone().applyAxisAngle(turn.normal, THREE.MathUtils.degToRad(angle)).normalize();
      if (!last) {
        const elbow = make(item.id, item.length);
        elbow.position.copy(ordered[0]);
        elbow.quaternion.copy(basisQuaternion(heading, aim));
        last = elbow;
        lastPort = 'out';
      } else {
        const elbow = make(item.id, item.length);
        lastPort = connect(graph, last, lastPort, elbow, aim);
        last = elbow;
      }
      heading = portWorld(last, lastPort).direction;
    }
    const reserve = elbowReach(diameter, turn.angles[0]) - insertionDepth(diameter);
    const corner = before.addScaledVector(incoming, Math.max(reserve, 0));
    return portWorld(last, lastPort).position.sub(corner).dot(heading);
  };
  for (let index = 0; index < plan.lengths.length; index++) {
    const turn = plan.turns[index];
    const reserve = turn.angles.length ? elbowReach(diameter, turn.angles[0]) - insertionDepth(diameter) : 0;
    const target = plan.lengths[index] - consumed - reserve;
    const lengths = fitPipeLengths(Math.max(target, 0), diameter);
    if (!last && !lengths.length && !turn.angles.length) {
      lengths.push(stockLengths(diameter)[0]);
    }
    if (!last && lengths.length) {
      const pipe = make(`pipe-${diameter}`, lengths.shift());
      pipe.position.copy(ordered[0]);
      pipe.quaternion.copy(basisQuaternion(heading, new THREE.Vector3(0, 1, 0)));
      last = pipe;
      lastPort = 'out';
    }
    for (const length of lengths) {
      const pipe = make(`pipe-${diameter}`, length);
      lastPort = connect(graph, last, lastPort, pipe);
      last = pipe;
    }
    consumed = placeElbows(turn);
  }
  if (!created.length) throw new Error('По этой линии не нашлось деталей каталога');
  if (startHit && endHit && hit && (startHit.element !== endHit.element || startHit.kind !== endHit.kind || startHit.port?.id !== endHit.port?.id)) notes.push('Второй конец оставлен свободным');
  const message = [`Канализация Ø${diameter}: ${describe(created)}`, ...notes].filter(Boolean).join('. ');
  return { created, message };
}
