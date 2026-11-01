// AssemblyScript WebAssembly Entry Point for Bridge Builder
// Exports bridge editing, level loading, simulation stepping, and shared rendering buffers

import {
  LevelData, Node, Beam,
  NODE_TYPE_ANCHOR, NODE_TYPE_TRAIN, BEAM_TYPE_TRAIN, BEAM_COST
} from "./types";
import { parseLevelBinary, parseBridgeBinary } from "./level";
import { PhysicsEngine } from "./physics";
import { BridgeEditor, snapCoordinate } from "./editor";
import { generateEditorGrid, getGridBufferPtr, getGridVertexCount } from "./grid";

// Global engine state
const level = new LevelData();
const nodes = new Array<Node>();
const beams = new Array<Beam>();
const physics = new PhysicsEngine(level, nodes, beams);
const editor = new BridgeEditor(level, nodes, beams, physics);

// Buffer for passing file data from JavaScript into WebAssembly
let memoryBufferSize: i32 = 65536;
let memoryBuffer: ArrayBuffer = new ArrayBuffer(memoryBufferSize);

// Grow before JS obtains a view; memory growth can detach its previous buffer.
export function prepareFileBuffer(length: i32): usize {
  if (length < 0 || length > 4 * 1024 * 1024) return 0;
  if (length > memoryBufferSize) {
    memoryBuffer = new ArrayBuffer(length);
    memoryBufferSize = length;
  }
  return changetype<usize>(memoryBuffer);
}

export function getFileBufferPtr(): usize {
  return changetype<usize>(memoryBuffer);
}

export function loadLevel(length: i32): bool {
  if (length < 0 || length > memoryBufferSize) return false;
  let ok = parseLevelBinary(changetype<usize>(memoryBuffer), length, level, nodes);
  if (ok) {
    beams.length = 0;
    physics.loaded();
    editor.cancel();
  }
  return ok;
}

export function loadBridge(length: i32): bool {
  if (length < 0 || length > memoryBufferSize) return false;
  let ok = parseBridgeBinary(changetype<usize>(memoryBuffer), length, level, nodes, beams);
  if (ok) {
    physics.loaded();
    editor.cancel();
  }
  return ok;
}

export function resetSimulation(): void {
  editor.cancel();
  physics.reset();
}

export function startTest(): void {
  if (!physics.simulationActive) {
    editor.cancel();
    physics.startTest();
  }
}

export function startTrain(): void {
  if (!physics.trainActive) {
    editor.cancel();
    physics.spawnTrain();
  }
}

export function togglePause(): bool {
  return physics.togglePause();
}

export function setPaused(p: bool): void {
  physics.paused = p;
}

export function stepSimulation(): void {
  physics.step();
}

// Browser gestures and legacy programmatic entry points share the Wasm rules.
export function editorClick(x: f32, y: f32): i32 {
  return editor.click(x, y);
}
export function editorDeleteAt(x: f32, y: f32): void {
  editor.deleteAt(x, y);
}
export function editorCancel(): void { editor.cancel(); }
export function editorTick(): void { editor.tick(); }
export function getEditorSelection(): i32 { return editor.selected; }
export function getEditorResult(): i32 { return editor.lastResult; }
export function editorPreview(x: f32, y: f32): i32 { return editor.preview(x, y); }
export function editorHoverNode(x: f32, y: f32): i32 { return editor.hoverNode(x, y); }
export function editorHoverBeam(x: f32, y: f32): i32 { return editor.hoverBeam(x, y); }
export function editorPreviewType(x: f32, y: f32): i32 { return editor.previewType(x, y); }
export function editorSnap(value: f32): f32 { return snapCoordinate(value); }
export function addNode(x: f32, y: f32): i32 { return editor.addNode(x, y); }
export function addBeam(a: i32, b: i32, type: i32): i32 {
  return editor.addBeam(a, b, type);
}
export function deleteNode(index: i32): bool {
  return editor.deleteNode(index);
}
export function deleteBeam(index: i32): bool {
  return editor.deleteBeam(index);
}

// Rendering Accessors for Browser Host

export function getNodeCount(): i32 { return nodes.length; }
export function getNodeX(i: i32): f32 { return nodes[i].x; }
export function getNodeY(i: i32): f32 { return nodes[i].y; }
export function getNodeType(i: i32): i32 { return nodes[i].type; }

export function getBeamCount(): i32 { return beams.length; }
export function getBeamNode1(i: i32): i32 { return beams[i].node1; }
export function getBeamNode2(i: i32): i32 { return beams[i].node2; }
export function getBeamType(i: i32): i32 { return beams[i].type; }
export function getBeamStress(i: i32): f32 { return beams[i].stress; }
export function isBeamBroken(i: i32): bool { return beams[i].broken; }
export function getBeamLight1(i: i32): f32 { return 1.0; }
export function getBeamLight2(i: i32): f32 { return 1.0; }

export function getTerrainHeight(col: i32): f32 {
  if (col < 0 || col >= 1024) return 0.0;
  return level.terrain[col];
}

export function getTerrainShade(col: i32): f32 {
  return 0.2;
}

export function computeTerrainLighting(isSimulating: bool): void {
  // Legacy stub: lighting is now handled by the dedicated rendering module
}

export function getWaterLevel(): f32 { return level.waterLevel; }
export function getTrackY(): f32 { return level.trackY; }
export function getLeftLimit(): f32 { return level.leftLimit; }
export function getRightLimit(): f32 { return level.rightLimit; }
export function getTotalBudget(): i32 { return level.budget; }

export function getRemainingBudget(): i32 {
  // Simulation breakage and train braces don't change the editor's budget.
  return level.budget - physics.designBeamCount() * BEAM_COST;
}

export function getBridgeCost(): i32 {
  return physics.designBeamCount() * BEAM_COST;
}

export function isSimulationRunning(): bool { return physics.simulationActive; }
export function isTrainRunning(): bool { return physics.trainActive; }
export function isPaused(): bool { return physics.paused; }
export function isLevelPassed(): bool { return physics.levelPassed; }
export function isBridgeCollapsed(): bool { return physics.bridgeCollapsed; }
export function isTrainFallen(): bool { return physics.trainFallen; }

export function getTrainCarCount(): i32 { return physics.trainCars.length; }
export function getTrainCarX(i: i32): f32 { return physics.trainCars[i].x; }
export function getTrainCarY(i: i32): f32 { return physics.trainCars[i].y; }
export function getTrainCarAngle(i: i32): f32 { return physics.trainCars[i].angle; }
export function getTrainCarType(i: i32): i32 { return physics.trainCars[i].type; }

export function getNodeVX(i: i32): f32 { return nodes[i].vx; }
export function getNodeVY(i: i32): f32 { return nodes[i].vy; }
export function getNodeMass(i: i32): f32 { return nodes[i].mass; }
export function getBrokenBeamCount(): i32 { return physics.brokenBeamCount; }

export function clearBridge(): void {
  editor.cancel();
  physics.reset();
  beams.length = 0;
  for (let i = nodes.length - 1; i >= 0; i--) {
    if (nodes[i].type != NODE_TYPE_ANCHOR) nodes.splice(i, 1);
  }
}
export function getTrainWheelNode(car: i32, wheel: i32): i32 {
  return physics.trainCars[car].wheelNodes[wheel];
}

// Editor Background Grid (Wasm Rendering Module)
export function generateGrid(viewX: f32, viewY: f32, halfWidth: f32, leftLimit: f32, rightLimit: f32, showLimits: bool): i32 {
  return generateEditorGrid(viewX, viewY, halfWidth, leftLimit, rightLimit, showLimits);
}
export function getGridBuffer(): usize {
  return getGridBufferPtr();
}
export function getGridVertices(): i32 {
  return getGridVertexCount();
}

// Export current bridge design in official .brg format (4128 + N*92 + M*24 bytes)
export function exportBridge(): i32 {
  let sourceNodes = physics.hasSnapshot ? physics.originalNodes : nodes;
  let sourceBeams = physics.hasSnapshot ? physics.originalBeams : beams;

  let nodeMap = new StaticArray<i32>(sourceNodes.length);
  let nodeCount = 0;
  for (let i = 0; i < sourceNodes.length; i++) {
    if (sourceNodes[i].type != NODE_TYPE_TRAIN) {
      nodeMap[i] = nodeCount;
      nodeCount++;
    } else {
      nodeMap[i] = -1;
    }
  }

  let beamCount = 0;
  for (let i = 0; i < sourceBeams.length; i++) {
    let b = sourceBeams[i];
    if (b.type != BEAM_TYPE_TRAIN &&
        b.node1 >= 0 && b.node1 < sourceNodes.length && nodeMap[b.node1] >= 0 &&
        b.node2 >= 0 && b.node2 < sourceNodes.length && nodeMap[b.node2] >= 0 &&
        nodeMap[b.node1] != nodeMap[b.node2]) {
      beamCount++;
    }
  }

  let totalSize = 4128 + nodeCount * 92 + beamCount * 24;
  let ptr = prepareFileBuffer(totalSize);
  if (!ptr) return 0;

  // Version 1
  store<i32>(ptr, 1);

  // Level header (matching readLevel)
  store<f32>(ptr + 4, level.waterLevel);
  store<f32>(ptr + 8, level.trackY);
  store<i32>(ptr + 12, level.budget);
  store<f32>(ptr + 16, level.leftLimit);
  store<f32>(ptr + 20, level.rightLimit);
  for (let i = 0; i < 1024; i++) {
    store<f32>(ptr + 24 + <usize>(i * 4), level.terrain[i]);
  }

  // Node count
  store<i32>(ptr + 4120, nodeCount);

  // Nodes
  let outNodeIdx = 0;
  for (let i = 0; i < sourceNodes.length; i++) {
    if (nodeMap[i] < 0) continue;
    let n = sourceNodes[i];
    let np = ptr + 4124 + <usize>(outNodeIdx * 92);
    store<i32>(np, n.type);
    store<f32>(np + 4, n.origX != 0.0 ? n.origX : n.x);
    store<f32>(np + 8, n.origY != 0.0 ? n.origY : n.y);
    store<f32>(np + 12, n.origZ);
    store<f32>(np + 16, n.origX != 0.0 ? n.origX : n.x);
    store<f32>(np + 20, n.origY != 0.0 ? n.origY : n.y);
    store<f32>(np + 24, n.origZ);
    store<f32>(np + 28, 0.0);
    store<f32>(np + 32, 0.0);
    store<f32>(np + 36, 0.0);
    store<f32>(np + 40, 0.0);
    store<f32>(np + 44, 0.0);
    store<f32>(np + 48, 0.0);
    store<f32>(np + 52, n.mass);
    store<f32>(np + 56, n.drag);
    store<f32>(np + 60, n.gravity);
    store<f32>(np + 64, n.bounce);
    store<f32>(np + 68, n.depth);
    store<i32>(np + 72, n.lifetime);
    store<i32>(np + 76, n.active);
    store<f32>(np + 80, n.r);
    store<f32>(np + 84, n.g);
    store<f32>(np + 88, n.b);
    outNodeIdx++;
  }

  // Beam count & Beams
  let offset = 4124 + nodeCount * 92;
  store<i32>(ptr + <usize>offset, beamCount);
  let outBeamIdx = 0;
  for (let i = 0; i < sourceBeams.length; i++) {
    let b = sourceBeams[i];
    if (b.type == BEAM_TYPE_TRAIN) continue;
    if (b.node1 < 0 || b.node1 >= sourceNodes.length || nodeMap[b.node1] < 0) continue;
    if (b.node2 < 0 || b.node2 >= sourceNodes.length || nodeMap[b.node2] < 0) continue;
    let mapped1 = nodeMap[b.node1];
    let mapped2 = nodeMap[b.node2];
    if (mapped1 == mapped2) continue;

    let bp = ptr + <usize>(offset + 4 + outBeamIdx * 24);
    store<i32>(bp, 0);
    store<i32>(bp + 4, mapped1);
    store<i32>(bp + 8, mapped2);
    store<i32>(bp + 12, b.type);
    store<f32>(bp + 16, b.restLen);
    store<f32>(bp + 20, isFinite(b.stress) ? b.stress : 0.0);
    outBeamIdx++;
  }

  return totalSize;
}

