// Original packed records: node 0x5c bytes, beam 0x18 bytes.
import {
  LevelData, Node, Beam,
  NODE_TYPE_DYNAMIC, NODE_TYPE_ANCHOR,
  BEAM_TYPE_TRUSS, BEAM_TYPE_DECK
} from "./types";

function readLevel(ptr: usize, level: LevelData, nodes: Array<Node>, count: i32): void {
  level.waterLevel = load<f32>(ptr);
  level.trackY = load<f32>(ptr + 4);
  level.budget = load<i32>(ptr + 8);
  level.leftLimit = load<f32>(ptr + 12);
  level.rightLimit = load<f32>(ptr + 16);
  for (let i = 0; i < 1024; i++) level.terrain[i] = load<f32>(ptr + 20 + <usize>(i * 4));
  nodes.length = 0;
  for (let i = 0; i < count; i++) {
    let p = ptr + 4120 + <usize>(i * 92);
    let n = new Node();
    n.type = load<i32>(p);
    n.x = n.origX = load<f32>(p + 4);
    n.y = n.origY = load<f32>(p + 8);
    n.z = n.origZ = load<f32>(p + 12);
    n.previousX = load<f32>(p + 16);
    n.previousY = load<f32>(p + 20);
    n.previousZ = load<f32>(p + 24);
    n.vx = load<f32>(p + 28);
    n.vy = load<f32>(p + 32);
    n.vz = load<f32>(p + 36);
    n.savedVX = load<f32>(p + 40);
    n.savedVY = load<f32>(p + 44);
    n.savedVZ = load<f32>(p + 48);
    n.mass = load<f32>(p + 52);
    n.drag = load<f32>(p + 56);
    n.gravity = load<f32>(p + 60);
    n.bounce = load<f32>(p + 64);
    n.depth = load<f32>(p + 68);
    n.lifetime = load<i32>(p + 72);
    n.active = load<i32>(p + 76);
    n.r = load<f32>(p + 80);
    n.g = load<f32>(p + 84);
    n.b = load<f32>(p + 88);
    nodes.push(n);
  }
}

function validLevelHeader(ptr: usize): bool {
  let waterLevel = load<f32>(ptr);
  let trackY = load<f32>(ptr + 4);
  let budget = load<i32>(ptr + 8);
  let leftLimit = load<f32>(ptr + 12);
  let rightLimit = load<f32>(ptr + 16);

  if (!isFinite(waterLevel) || !isFinite(trackY)) return false;
  if (!isFinite(leftLimit) || !isFinite(rightLimit)) return false;
  if (leftLimit >= rightLimit) return false;
  if (budget < 0) return false;

  for (let i = 0; i < 1024; i++) {
    let h = load<f32>(ptr + 20 + <usize>(i * 4));
    if (!isFinite(h)) return false;
  }
  return true;
}

function validNodes(headerPtr: usize, count: i32, isLevelFile: bool): bool {
  for (let i = 0; i < count; i++) {
    let p = headerPtr + 4120 + <usize>(i * 92);
    let type = load<i32>(p);
    if (isLevelFile) {
      if (type != NODE_TYPE_ANCHOR) return false;
    } else {
      if (type != NODE_TYPE_DYNAMIC && type != NODE_TYPE_ANCHOR) return false;
    }
    for (let offset = 4; offset <= 68; offset += 4) {
      if (!isFinite(load<f32>(p + <usize>offset))) return false;
    }
    if (load<f32>(p + 52) <= 0.0) return false;
    if (load<f32>(p + 56) < 0.0) return false;
    for (let offset = 80; offset <= 88; offset += 4) {
      if (!isFinite(load<f32>(p + <usize>offset))) return false;
    }
  }
  return true;
}

export function parseLevelBinary(ptr: usize, len: i32, level: LevelData, nodes: Array<Node>): bool {
  if (len < 4120) return false;
  if (!validLevelHeader(ptr)) return false;
  let count = load<i32>(ptr + 4116);
  if (count < 0 || count > 10000 || count > (len - 4120) / 92) return false;
  if (!validNodes(ptr, count, true)) return false;
  readLevel(ptr, level, nodes, count);
  return true;
}

export function parseBridgeBinary(ptr: usize, len: i32, level: LevelData, nodes: Array<Node>, beams: Array<Beam>): bool {
  if (len < 4128 || load<i32>(ptr) != 1) return false;
  if (!validLevelHeader(ptr + 4)) return false;
  let count = load<i32>(ptr + 4120);
  if (count < 0 || count > 10000 || count > (len - 4128) / 92) return false;
  let offset = 4124 + count * 92;
  let beamCount = load<i32>(ptr + <usize>offset);
  if (beamCount < 0 || beamCount > (len - offset - 4) / 24) return false;
  if (!validNodes(ptr + 4, count, false)) return false;
  // Check the complete file before changing the current level.
  for (let i = 0; i < beamCount; i++) {
    let p = ptr + <usize>(offset + 4 + i * 24);
    let a = load<i32>(p + 4), b = load<i32>(p + 8);
    let type = load<i32>(p + 12);
    let length = load<f32>(p + 16);
    let stress = load<f32>(p + 20);
    if (a < 0 || b < 0 || a >= count || b >= count || a == b) return false;
    if (type != BEAM_TYPE_TRUSS && type != BEAM_TYPE_DECK) return false;
    if (!isFinite(length) || length <= 0.0) return false;
    if (!isFinite(stress)) return false;
  }
  readLevel(ptr + 4, level, nodes, count);
  beams.length = 0;
  for (let i = 0; i < beamCount; i++) {
    let p = ptr + <usize>(offset + 4 + i * 24);
    let b = new Beam();
    b.node1 = load<i32>(p + 4);
    b.node2 = load<i32>(p + 8);
    b.type = load<i32>(p + 12); // 0x00593854, not the unused first word
    b.restLen = load<f32>(p + 16);
    b.stress = load<f32>(p + 20);
    beams.push(b);
  }
  return true;
}
