// Editor behavior reconstructed from 0x00401aa4 and its node/member helpers.
import { Node, Beam, LevelData, NODE_TYPE_ANCHOR, NODE_TYPE_DYNAMIC,
  BEAM_TYPE_DECK, BEAM_TYPE_TRUSS, BEAM_COST, MIN_BEAM_LEN, MAX_BEAM_LEN, GRAVITY } from './types';
import { PhysicsEngine } from './physics';

// Zero means a legal connection. Nonzero values also drive preview feedback.
export const EDIT_OK: i32 = 0;
export const EDIT_NO_START: i32 = 1;
export const EDIT_LENGTH: i32 = 2;
export const EDIT_BUDGET: i32 = 3;
export const EDIT_DUPLICATE: i32 = 4;
export const EDIT_CONNECTION_LIMIT: i32 = 5;
export const EDIT_NODE_ON_MEMBER: i32 = 6;
export const EDIT_TERRAIN: i32 = 7;
export const EDIT_ANCHORS: i32 = 8;
export const EDIT_NODE_TOO_CLOSE: i32 = 9;
export const EDIT_LOCKED: i32 = 10;

export function snapCoordinate(value: f32): f32 {
  // 0x00401d5b: floor(world * 0.5 + 0.5) * 2, including negative values.
  return <f32>(Math.floor(<f64>value * 0.5 + 0.5) * 2);
}

// 0x00404dbc: within one unit of the segment, projection inside endpoints.
function touchesSegment(x: f32, y: f32, a: Node, bx: f32, by: f32): bool {
  let dx: f64 = <f64>bx - a.x, dy: f64 = <f64>by - a.y;
  let px: f64 = <f64>x - a.x, py: f64 = <f64>y - a.y;
  let length2 = dx * dx + dy * dy;
  if (length2 == 0) return px * px + py * py <= 1;
  let dot = px * dx + py * dy;
  if (dot < 0 || dot > length2) return false;
  let cross = px * dy - py * dx;
  return cross * cross <= length2;
}

export class BridgeEditor {
  selected: i32 = -1;
  lastResult: i32 = EDIT_OK;
  private level: LevelData;
  private nodes: Array<Node>;
  private beams: Array<Beam>;
  private physics: PhysicsEngine;

  constructor(level: LevelData, nodes: Array<Node>, beams: Array<Beam>, physics: PhysicsEngine) {
    this.level = level; this.nodes = nodes; this.beams = beams; this.physics = physics;
  }

  cancel(): void { this.selected = -1; this.lastResult = EDIT_OK; }

  pickNode(x: f32, y: f32): i32 {
    let found = -1;
    // Original start selection uses an axis-aligned two-unit box, last match.
    for (let i = 0; i < this.nodes.length; i++) {
      if (Mathf.abs(this.nodes[i].x - x) < 2 && Mathf.abs(this.nodes[i].y - y) < 2) found = i;
    }
    return found;
  }

  private endpoint(x: f32, y: f32): i32 {
    let found = -1;
    for (let i = 0; i < this.nodes.length; i++) {
      let dx: f64 = <f64>this.nodes[i].x - x, dy: f64 = <f64>this.nodes[i].y - y;
      if (dx * dx + dy * dy < 1) found = i;
    }
    return found;
  }

  // 0x00401d5b..0x00401df0: hover uses the snapped cursor and a <1 radius,
  // not the wider box used to start a click selection.
  hoverNode(x: f32, y: f32): i32 {
    if (this.physics.simulationActive || !isFinite(x) || !isFinite(y)) return -1;
    return this.endpoint(snapCoordinate(x), snapCoordinate(y));
  }

  // 0x00401ef8..0x00401fc6: member hover uses the unsnapped cursor,
  // only when neither a source nor a hovered joint exists; last match wins.
  hoverBeam(x: f32, y: f32): i32 {
    if (this.physics.simulationActive || this.selected >= 0 ||
        !isFinite(x) || !isFinite(y) || this.hoverNode(x, y) >= 0) return -1;
    let found = -1;
    for (let i = 0; i < this.beams.length; i++) {
      let b = this.beams[i], a = this.nodes[b.node1], n = this.nodes[b.node2];
      if (touchesSegment(x, y, a, n.x, n.y)) found = i;
    }
    return found;
  }

  private memberType(ay: f32, by: f32): i32 {
    return Mathf.abs(ay - this.level.trackY) < 1 && Mathf.abs(by - this.level.trackY) < 1
      ? BEAM_TYPE_DECK : BEAM_TYPE_TRUSS;
  }

  // The EXE temporarily appends a valid member before building its render cache,
  // then rolls it back. Expose the same preview without mutating the design.
  previewType(x: f32, y: f32): i32 {
    if (this.preview(x, y) != EDIT_OK) return 0;
    let sx = snapCoordinate(x), sy = snapCoordinate(y);
    let to = this.endpoint(sx, sy);
    return this.memberType(this.nodes[this.selected].y, to >= 0 ? this.nodes[to].y : sy);
  }

  private nodeError(x: f32, y: f32): i32 {
    if (!isFinite(x) || !isFinite(y) || this.nodes.length >= 10000) return EDIT_TERRAIN;
    if (this.endpoint(x, y) >= 0) return EDIT_NODE_TOO_CLOSE;
    for (let i = 0; i < this.beams.length; i++) {
      let b = this.beams[i], a = this.nodes[b.node1], n = this.nodes[b.node2];
      if (touchesSegment(x, y, a, n.x, n.y)) return EDIT_NODE_ON_MEMBER;
    }
    let col = (<i32>x) >> 2;
    if (col < 0 || col >= 1023) return EDIT_TERRAIN; // Safe domain of the terrain array.
    let ground = this.level.terrain[col] + (this.level.terrain[col + 1] - this.level.terrain[col]) * (x - <f32>(col * 4)) / 4;
    // 0x00408ac0 rejects intersection with the vertical segment [y, y+16].
    if (ground >= y && ground <= y + 16) return EDIT_TERRAIN;
    return EDIT_OK;
  }

  private beamError(from: i32, to: i32, x: f32, y: f32): i32 {
    if (from < 0 || from >= this.nodes.length || to >= this.nodes.length) return EDIT_NO_START;
    if (from == to) return EDIT_LENGTH;
    let a = this.nodes[from];
    if (to >= 0) {
      let b = this.nodes[to]; x = b.x; y = b.y;
      if (a.type == NODE_TYPE_ANCHOR && b.type == NODE_TYPE_ANCHOR) return EDIT_ANCHORS;
    }
    let dx: f64 = <f64>x - a.x, dy: f64 = <f64>y - a.y;
    let length: f32 = <f32>Math.sqrt(dx * dx + dy * dy);
    if (length < MIN_BEAM_LEN || length > MAX_BEAM_LEN) return EDIT_LENGTH;
    if (this.level.budget - this.beams.length * BEAM_COST <= 0) return EDIT_BUDGET;
    let degreeA = 0, degreeB = 0;
    for (let i = 0; i < this.beams.length; i++) {
      let b = this.beams[i];
      if ((b.node1 == from && b.node2 == to) || (b.node2 == from && b.node1 == to)) return EDIT_DUPLICATE;
      if (b.node1 == from || b.node2 == from) degreeA++;
      if (to >= 0 && (b.node1 == to || b.node2 == to)) degreeB++;
    }
    if (degreeA >= 9 || degreeB >= 9) return EDIT_CONNECTION_LIMIT;
    for (let i = 0; i < this.nodes.length; i++) {
      if (i != from && i != to && touchesSegment(this.nodes[i].x, this.nodes[i].y, a, x, y)) return EDIT_NODE_ON_MEMBER;
    }
    return EDIT_OK;
  }

  preview(x: f32, y: f32): i32 {
    if (this.physics.simulationActive) return EDIT_LOCKED;
    if (this.selected < 0 || this.selected >= this.nodes.length) return EDIT_NO_START;
    x = snapCoordinate(x); y = snapCoordinate(y);
    let a = this.nodes[this.selected];
    let dx: f64 = <f64>x - a.x, dy: f64 = <f64>y - a.y;
    // The editor's cursor gate is strict <18, though the helper accepts <=18.
    if (dx * dx + dy * dy >= 324) return EDIT_LENGTH;
    let to = this.endpoint(x, y);
    if (to == -1) {
      let error = this.nodeError(x, y);
      if (error != EDIT_OK) return error;
    }
    return this.beamError(this.selected, to, x, y);
  }

  click(x: f32, y: f32): i32 {
    if (this.physics.simulationActive) { this.lastResult = EDIT_LOCKED; return this.selected; }
    if (!isFinite(x) || !isFinite(y)) return this.selected;
    if (this.selected == -1) {
      this.selected = this.pickNode(x, y);
      this.lastResult = this.selected == -1 ? EDIT_NO_START : EDIT_OK;
      return this.selected;
    }
    let error = this.preview(x, y);
    this.lastResult = error;
    let sx = snapCoordinate(x), sy = snapCoordinate(y);
    let to = this.endpoint(sx, sy);
    if (error != EDIT_OK) {
      // Match the original endpoint-selection branches, without stray nodes.
      let a = this.nodes[this.selected];
      let dx: f64 = <f64>sx - a.x, dy: f64 = <f64>sy - a.y;
      if (dx * dx + dy * dy >= 324) this.selected = this.pickNode(sx, sy);
      else if (to >= 0 && error != EDIT_BUDGET) this.selected = to;
      return this.selected;
    }
    if (to == -1) to = this.appendNode(sx, sy);
    this.appendBeam(this.selected, to, 0);
    this.selected = to;
    return to;
  }

  private appendNode(x: f32, y: f32): i32 {
    let n = new Node();
    n.type = NODE_TYPE_DYNAMIC;
    n.x = n.origX = n.previousX = x;
    n.y = n.origY = n.previousY = y;
    n.z = n.origZ = n.previousZ = 0.0;
    n.vx = n.vy = n.vz = 0.0;
    n.savedVX = n.savedVY = n.savedVZ = 0.0;
    n.mass = 1.0;
    n.drag = 0.995;
    n.gravity = GRAVITY;
    n.bounce = 1.4;
    n.depth = 0.4;
    n.lifetime = 10000;
    n.active = 1;
    n.r = 0.5;
    n.g = 0.5;
    n.b = 0.5;
    this.nodes.push(n);
    return this.nodes.length - 1;
  }

  private appendBeam(from: i32, to: i32, type: i32): i32 {
    let a = this.nodes[from], n = this.nodes[to];
    let dx: f64 = <f64>n.x - a.x, dy: f64 = <f64>n.y - a.y;
    let b = new Beam(); b.node1 = from; b.node2 = to;
    b.restLen = <f32>Math.sqrt(dx * dx + dy * dy);
    b.type = type == BEAM_TYPE_TRUSS || type == BEAM_TYPE_DECK ? type :
      this.memberType(a.y, n.y);
    this.beams.push(b);
    return this.beams.length - 1;
  }

  addNode(x: f32, y: f32): i32 {
    if (this.physics.simulationActive) return -1;
    this.lastResult = this.nodeError(x, y);
    return this.lastResult == EDIT_OK ? this.appendNode(x, y) : -1;
  }

  addBeam(from: i32, to: i32, type: i32): i32 {
    if (this.physics.simulationActive || to < 0 || to >= this.nodes.length) return -1;
    this.lastResult = this.beamError(from, to, this.nodes[to].x, this.nodes[to].y);
    return this.lastResult == EDIT_OK ? this.appendBeam(from, to, type) : -1;
  }

  private removeBeam(index: i32): void {
    let b = this.beams[index];
    let a = b.node1, n = b.node2;
    let tail = this.beams.pop();
    if (index < this.beams.length) this.beams[index] = tail;
    for (let k = 0; k < 2; k++) {
      let node = k == 0 ? a : n, connected = false;
      for (let j = 0; j < this.beams.length; j++) {
        let other = this.beams[j];
        if (other.node1 == node || other.node2 == node) connected = true;
      }
      if (!connected && this.nodes[node].type != NODE_TYPE_ANCHOR) this.nodes[node].lifetime = 1;
    }
  }

  private removeNode(index: i32): void {
    for (let j = 0; j < this.beams.length;) {
      if (this.beams[j].node1 == index || this.beams[j].node2 == index) this.removeBeam(j);
      else j++;
    }
    let last = this.nodes.length - 1, tail = this.nodes.pop();
    if (index < this.nodes.length) this.nodes[index] = tail;
    for (let j = 0; j < this.beams.length; j++) {
      if (this.beams[j].node1 == last) this.beams[j].node1 = index;
      if (this.beams[j].node2 == last) this.beams[j].node2 = index;
    }
    if (this.selected == index) this.selected = -1;
    else if (this.selected == last) this.selected = index;
  }

  deleteNode(index: i32): bool {
    if (this.physics.simulationActive || index < 0 || index >= this.nodes.length || this.nodes[index].type == NODE_TYPE_ANCHOR) return false;
    this.removeNode(index); return true;
  }

  deleteBeam(index: i32): bool {
    if (this.physics.simulationActive || index < 0 || index >= this.beams.length) return false;
    this.removeBeam(index); return true;
  }

  deleteAt(x: f32, y: f32): void {
    if (this.physics.simulationActive) return;
    if (this.selected >= 0) { this.cancel(); return; }
    let node = this.pickNode(x, y);
    if (node >= 0) { this.deleteNode(node); return; }
    let found = -1;
    for (let i = 0; i < this.beams.length; i++) {
      let b = this.beams[i], a = this.nodes[b.node1], n = this.nodes[b.node2];
      if (touchesSegment(x, y, a, n.x, n.y)) found = i;
    }
    if (found >= 0) this.removeBeam(found);
  }

  tick(): void {
    if (this.physics.simulationActive) return;
    // Original editor calls the same 30 Hz lifetime cleanup as simulation.
    let i = 0;
    while (i < this.nodes.length) {
      let n = this.nodes[i];
      if (n.lifetime < 10000) n.lifetime--;
      if (n.lifetime < 0) this.removeNode(i);
      else i++;
    }
  }
}
