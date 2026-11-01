// AssemblyScript Bridge Builder Types and Constants
// Reverse-engineered from Bridge Builder (bridge.exe)

// Node types
export const NODE_TYPE_DYNAMIC: i32 = 1;
export const NODE_TYPE_ANCHOR: i32 = 2;
export const NODE_TYPE_TRAIN: i32 = 3;

// Beam member types
export const BEAM_TYPE_TRUSS: i32 = 1;
export const BEAM_TYPE_DECK: i32 = 2;
export const BEAM_TYPE_TRAIN: i32 = 3;

// Physical Constants from DGROUP
export const GRAVITY: f32 = 0.010888887569308281; // Node initializer, bits 0x3c32674e
export const DAMPING: f32 = 0.5;             // VA 0x00418564
export const STIFFNESS: f64 = 0.499;         // VA 0x0041856c
export const STRESS_SCALE: f32 = 8.0;        // VA 0x0041857c
export const SNAP_THRESHOLD: f64 = 0.12;     // VA 0x00418584
export const MAX_BEAM_LEN: f32 = 18.0;       // VA 0x0041813c
export const MIN_BEAM_LEN: f32 = 1.9;        // VA 0x004185b4
export const TRACTION_FORCE: f64 = 0.003;// VA 0x00418544
export const CONTACT_RADIUS: f32 = 4.0;      // VA 0x004185ac
export const BEAM_COST: i32 = 100;           // $100 per beam member

export class Node {
  type: i32 = NODE_TYPE_DYNAMIC;
  x: f32 = 0.0;
  y: f32 = 0.0;
  z: f32 = 0.0;
  vx: f32 = 0.0;
  vy: f32 = 0.0;
  vz: f32 = 0.0;
  origX: f32 = 0.0;
  origY: f32 = 0.0;
  origZ: f32 = 0.0;
  // +0x10 is previous position in the original; orig* is our editor snapshot.
  previousX: f32 = 0.0;
  previousY: f32 = 0.0;
  previousZ: f32 = 0.0;
  // +0x28: velocity snapshot used by each relaxation/contact pass.
  savedVX: f32 = 0.0;
  savedVY: f32 = 0.0;
  savedVZ: f32 = 0.0;
  mass: f32 = 1.0;          // +0x34, not inverse mass
  drag: f32 = 0.995;        // +0x38
  gravity: f32 = GRAVITY;   // +0x3c
  bounce: f32 = 1.4;        // +0x40 (collision bounce factor)
  depth: f32 = 0.4;         // +0x44 (collision depth stiffness)
  lifetime: i32 = 10000;    // +0x48
  active: i32 = 1;          // +0x4c
  r: f32 = 0.5;             // +0x50 (color / visual shade R)
  g: f32 = 0.5;             // +0x54 (color / visual shade G)
  b: f32 = 0.5;             // +0x58 (color / visual shade B)
}

export class Beam {
  node1: i32 = 0;
  node2: i32 = 0;
  type: i32 = BEAM_TYPE_TRUSS;
  restLen: f32 = 0.0;
  stress: f32 = 0.0;
  broken: bool = false;
}

export class TrainCar {
  type: i32 = 0; // 1 = locomotive, 0 = car
  wheelNodes: StaticArray<i32> = new StaticArray<i32>(4);
  x: f32 = 0.0;
  y: f32 = 0.0;
  angle: f32 = 0.0;
  vx: f32 = 0.0;
  vy: f32 = 0.0;
}

export class LevelData {
  waterLevel: f32 = 120.0;
  trackY: f32 = 128.0;
  budget: i32 = 10000;
  leftLimit: f32 = 2000.0;
  rightLimit: f32 = 2100.0;
  terrain: StaticArray<f32> = new StaticArray<f32>(1024);
}
