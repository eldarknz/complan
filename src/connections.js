import * as THREE from 'three';
import { catalogById } from './catalog.js';
import { getPorts, compatiblePorts, connectionPose } from './elements.js';

export const elementPorts = (element) => getPorts(catalogById.get(element.userData.typeId), element.userData.length);
export const findPort = (element, id) => elementPorts(element).find((port) => port.id === id);
export const poseOf = (element) => ({ position: element.position.clone(), quaternion: element.quaternion.clone() });

export function nearestConnection(moving, elements, graph, threshold = 90) {
  const assembly = graph.component(moving);
  let best = null;
  for (const member of assembly) {
    for (const input of elementPorts(member)) {
      if (graph.at(member, input.id)) continue;
      const actual = input.position.clone().applyQuaternion(member.quaternion).add(member.position);
      for (const source of elements) {
        if (assembly.has(source)) continue;
        for (const port of elementPorts(source)) {
          if (graph.at(source, port.id) || !compatiblePorts(port, input)) continue;
          const direction = port.direction.clone().applyQuaternion(source.quaternion);
          const destination = port.position.clone().applyQuaternion(source.quaternion).add(source.position)
            .addScaledVector(direction, -(port.socket ? port.depth : input.depth));
          const distance = destination.distanceTo(actual);
          if (distance <= threshold && (!best || distance < best.distance)) best = { source, port, target: member, input, distance, destination };
        }
      }
    }
  }
  return best;
}

export class Connections {
  edges = [];

  at(element, portId) {
    return this.edges.find((edge) => (edge.a === element && edge.ap === portId) || (edge.b === element && edge.bp === portId));
  }

  component(element, excludedEdge = null) {
    const result = new Set([element]);
    for (const current of result) {
      for (const edge of this.edges) {
        if (edge === excludedEdge) continue;
        if (edge.a === current) result.add(edge.b);
        if (edge.b === current) result.add(edge.a);
      }
    }
    return result;
  }

  canJoin(a, ap, b, bp) {
    return a !== b && !this.at(a, ap) && !this.at(b, bp) && !this.component(a).has(b) && compatiblePorts(findPort(a, ap), findPort(b, bp));
  }

  moveWith(element, previous, members = this.component(element)) {
    const rotation = element.quaternion.clone().multiply(previous.quaternion.clone().invert());
    for (const other of members) {
      if (other === element) continue;
      other.position.sub(previous.position).applyQuaternion(rotation).add(element.position);
      other.quaternion.premultiply(rotation).normalize();
    }
  }

  join(a, ap, b, bp, roll = 0) {
    if (!this.canJoin(a, ap, b, bp)) throw new Error('Точки заняты, несовместимы или уже принадлежат одной сборке');
    const pose = connectionPose(a, findPort(a, ap), catalogById.get(b.userData.typeId), b.userData.length, bp, roll);
    if (!pose) throw new Error('Неверные параметры стыковки');
    const previous = poseOf(b);
    b.position.copy(pose.position);
    b.quaternion.copy(pose.quaternion);
    this.moveWith(b, previous);
    this.edges.push({ a, ap, b, bp });
    return pose;
  }

  disconnect(element, portId) {
    const edge = this.at(element, portId);
    if (edge) this.edges.splice(this.edges.indexOf(edge), 1);
  }

  remove(element) {
    this.edges = this.edges.filter((edge) => edge.a !== element && edge.b !== element);
  }

  reflow(root) {
    const visited = new Set([root]);
    const queue = [root];
    for (const current of queue) {
      for (const edge of this.edges) {
        if (edge.a !== current && edge.b !== current) continue;
        const next = edge.a === current ? edge.b : edge.a;
        if (visited.has(next)) continue;
        const port = findPort(current, edge.a === current ? edge.ap : edge.bp);
        const input = findPort(next, edge.a === current ? edge.bp : edge.ap);
        const direction = port.direction.clone().applyQuaternion(current.quaternion);
        next.position.copy(port.position).applyQuaternion(current.quaternion).add(current.position)
          .addScaledVector(direction, -(port.socket ? port.depth : input.depth))
          .sub(input.position.clone().applyQuaternion(next.quaternion));
        visited.add(next); queue.push(next);
      }
    }
  }

  twist(element, portId, degrees) {
    const edge = this.at(element, portId);
    if (!edge || !Number.isFinite(degrees)) return false;
    const port = findPort(element, portId);
    const direction = port.direction.clone().applyQuaternion(element.quaternion);
    const pivot = port.position.clone().applyQuaternion(element.quaternion).add(element.position);
    const rotation = new THREE.Quaternion().setFromAxisAngle(direction, THREE.MathUtils.degToRad(degrees));
    for (const member of this.component(element, edge)) {
      member.position.sub(pivot).applyQuaternion(rotation).add(pivot);
      member.quaternion.premultiply(rotation).normalize();
    }
    return true;
  }
}
