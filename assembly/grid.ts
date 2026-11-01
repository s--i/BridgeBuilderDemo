// AssemblyScript implementation of original bridge.exe editor background grid & limit lines.
// Source: FUN_00401aa4 instructions 0040202d - 00402391.
// Faithful reproduction of:
// - Camera span arithmetic: span = (round(halfWidth + 4.0) >> 2) * 4
// - Snapped coordinates: snapX = (round(viewX) >> 2) * 4, snapY = (round(viewY) >> 2) * 4
// - Signed integer loop step (+4 units) and bitmask classification:
//   - & 0x0f == 0 -> major 16-unit grid line: (0.2, 0.2, 0.2, 1.0)
//   - & 0x3f == 0 -> super 64-unit grid line: (0.0, 0.0, 0.0, 1.0)
//   - default -> minor 4-unit grid line: (0.075, 0.075, 0.075, 1.0)
//   - intermediate 2-unit sub-grid line at +2 units: (0.1, 0.1, 0.1, 1.0)
// - Boundary limit vertical lines:
//   - Left limit: red (1.0, 0.1, 0.1, 1.0) from y = 256.0 to y = 0.0
//   - Right limit: blue (0.1, 0.1, 1.0, 1.0) from y = 256.0 to y = 0.0

// Floats per vertex: x, y, r, g, b, a (6 floats)
export const FLOATS_PER_VERTEX: i32 = 6;

let gridBufferCapacity: i32 = 131072; // Initial capacity in bytes (32,768 floats)
let gridBuffer: ArrayBuffer = new ArrayBuffer(gridBufferCapacity);
let gridVertexCount: i32 = 0;

function ensureBufferCapacity(requiredBytes: i32): void {
  if (requiredBytes > gridBufferCapacity) {
    let newCap = gridBufferCapacity * 2;
    if (newCap < requiredBytes) newCap = requiredBytes + 65536;
    gridBuffer = new ArrayBuffer(newCap);
    gridBufferCapacity = newCap;
  }
}

export function getGridBufferPtr(): usize {
  return changetype<usize>(gridBuffer);
}

export function getGridVertexCount(): i32 {
  return gridVertexCount;
}

// Generates line vertices (GL_LINES format, 2 vertices per segment, 6 floats per vertex).
// Returns vertexCount.
export function generateEditorGrid(
  viewX: f32,
  viewY: f32,
  halfWidth: f32,
  leftLimit: f32,
  rightLimit: f32,
  showLimits: bool
): i32 {
  // Original truncation helper 0040c96a: FADD [41814c] (4.0); truncate to int; SAR 2; LEA EBX, [ECX*4]
  let halfSpan: i32 = <i32>(halfWidth + 4.0);
  let span: i32 = (halfSpan >> 2) * 4;
  let snapX: i32 = (<i32>viewX >> 2) * 4;
  let snapY: i32 = (<i32>viewY >> 2) * 4;

  let minX: f32 = <f32>(snapX - span);
  let maxX: f32 = <f32>(snapX + span);
  let minY: f32 = <f32>(snapY - span);
  let maxY: f32 = <f32>(snapY + span);

  // Each step from -span to < span produces:
  // Loop 1 (horizontal): 2 lines (4 vertices)
  // Loop 2 (vertical): 2 lines (4 vertices)
  // Plus up to 2 limit lines (4 vertices)
  let steps: i32 = span > 0 ? (span * 2) / 4 : 0;
  let totalVertices: i32 = steps * 8 + (showLimits ? 4 : 0);
  ensureBufferCapacity(totalVertices * FLOATS_PER_VERTEX * 4);

  let ptr: usize = changetype<usize>(gridBuffer);
  let vIdx: i32 = 0;

  // Helper macro-like closure to write one vertex
  // Inlined for maximum execution speed
  // Loop 1: Horizontal lines (varying Y, from minX to maxX)
  // FUN_00401aa4 lines 004020b1 - 004021c6
  for (let offset: i32 = -span; offset < span; offset += 4) {
    let yInt: i32 = snapY + offset;
    let y: f32 = <f32>yInt;

    // Line classification
    let r: f32 = 0.075;
    let g: f32 = 0.075;
    let b: f32 = 0.075;

    // 004020ea: TEST AL, 0x0f
    if ((yInt & 0x0f) == 0) {
      r = 0.2;
      g = 0.2;
      b = 0.2;
    }
    // 0040210f: TEST AL, 0x3f
    if ((yInt & 0x3f) == 0) {
      r = 0.0;
      g = 0.0;
      b = 0.0;
    }

    // Main horizontal line: (minX, y) to (maxX, y)
    let bOff = <usize>(vIdx * FLOATS_PER_VERTEX * 4);
    store<f32>(ptr + bOff,      minX);
    store<f32>(ptr + bOff + 4,  y);
    store<f32>(ptr + bOff + 8,  r);
    store<f32>(ptr + bOff + 12, g);
    store<f32>(ptr + bOff + 16, b);
    store<f32>(ptr + bOff + 20, 1.0);

    store<f32>(ptr + bOff + 24, maxX);
    store<f32>(ptr + bOff + 28, y);
    store<f32>(ptr + bOff + 32, r);
    store<f32>(ptr + bOff + 36, g);
    store<f32>(ptr + bOff + 40, b);
    store<f32>(ptr + bOff + 44, 1.0);
    vIdx += 2;

    // Intermediate 2-unit sub-grid line at y + 2: (minX, y + 2) to (maxX, y + 2)
    // 00402171 - 004021b6: Color (0.1, 0.1, 0.1, 1.0)
    let ySub: f32 = <f32>(yInt + 2);
    let subOff = <usize>(vIdx * FLOATS_PER_VERTEX * 4);
    store<f32>(ptr + subOff,      minX);
    store<f32>(ptr + subOff + 4,  ySub);
    store<f32>(ptr + subOff + 8,  0.1);
    store<f32>(ptr + subOff + 12, 0.1);
    store<f32>(ptr + subOff + 16, 0.1);
    store<f32>(ptr + subOff + 20, 1.0);

    store<f32>(ptr + subOff + 24, maxX);
    store<f32>(ptr + subOff + 28, ySub);
    store<f32>(ptr + subOff + 32, 0.1);
    store<f32>(ptr + subOff + 36, 0.1);
    store<f32>(ptr + subOff + 40, 0.1);
    store<f32>(ptr + subOff + 44, 1.0);
    vIdx += 2;
  }

  // Loop 2: Vertical lines (varying X, from minY to maxY)
  // FUN_00401aa4 lines 004021d6 - 004022f1
  for (let offset: i32 = -span; offset < span; offset += 4) {
    let xInt: i32 = snapX + offset;
    let x: f32 = <f32>xInt;

    // Line classification
    let r: f32 = 0.075;
    let g: f32 = 0.075;
    let b: f32 = 0.075;

    // 00402215: TEST AL, 0x0f
    if ((xInt & 0x0f) == 0) {
      r = 0.2;
      g = 0.2;
      b = 0.2;
    }
    // 0040223a: TEST AL, 0x3f
    if ((xInt & 0x3f) == 0) {
      r = 0.0;
      g = 0.0;
      b = 0.0;
    }

    // Main vertical line: (x, minY) to (x, maxY)
    let bOff = <usize>(vIdx * FLOATS_PER_VERTEX * 4);
    store<f32>(ptr + bOff,      x);
    store<f32>(ptr + bOff + 4,  minY);
    store<f32>(ptr + bOff + 8,  r);
    store<f32>(ptr + bOff + 12, g);
    store<f32>(ptr + bOff + 16, b);
    store<f32>(ptr + bOff + 20, 1.0);

    store<f32>(ptr + bOff + 24, x);
    store<f32>(ptr + bOff + 28, maxY);
    store<f32>(ptr + bOff + 32, r);
    store<f32>(ptr + bOff + 36, g);
    store<f32>(ptr + bOff + 40, b);
    store<f32>(ptr + bOff + 44, 1.0);
    vIdx += 2;

    // Intermediate 2-unit sub-grid line at x + 2: (x + 2, minY) to (x + 2, maxY)
    // 0040229c - 004022e1: Color (0.1, 0.1, 0.1, 1.0)
    let xSub: f32 = <f32>(xInt + 2);
    let subOff = <usize>(vIdx * FLOATS_PER_VERTEX * 4);
    store<f32>(ptr + subOff,      xSub);
    store<f32>(ptr + subOff + 4,  minY);
    store<f32>(ptr + subOff + 8,  0.1);
    store<f32>(ptr + subOff + 12, 0.1);
    store<f32>(ptr + subOff + 16, 0.1);
    store<f32>(ptr + subOff + 20, 1.0);

    store<f32>(ptr + subOff + 24, xSub);
    store<f32>(ptr + subOff + 28, maxY);
    store<f32>(ptr + subOff + 32, 0.1);
    store<f32>(ptr + subOff + 36, 0.1);
    store<f32>(ptr + subOff + 40, 0.1);
    store<f32>(ptr + subOff + 44, 1.0);
    vIdx += 2;
  }

  // Build boundary limit vertical lines (00402304 - 00402390)
  if (showLimits) {
    // Left limit line: Red (1.0, 0.1, 0.1, 1.0) from y = 256.0 to y = 0.0
    let lOff = <usize>(vIdx * FLOATS_PER_VERTEX * 4);
    store<f32>(ptr + lOff,      leftLimit);
    store<f32>(ptr + lOff + 4,  256.0);
    store<f32>(ptr + lOff + 8,  1.0);
    store<f32>(ptr + lOff + 12, 0.1);
    store<f32>(ptr + lOff + 16, 0.1);
    store<f32>(ptr + lOff + 20, 1.0);

    store<f32>(ptr + lOff + 24, leftLimit);
    store<f32>(ptr + lOff + 28, 0.0);
    store<f32>(ptr + lOff + 32, 1.0);
    store<f32>(ptr + lOff + 36, 0.1);
    store<f32>(ptr + lOff + 40, 0.1);
    store<f32>(ptr + lOff + 44, 1.0);
    vIdx += 2;

    // Right limit line: Blue (0.1, 0.1, 1.0, 1.0) from y = 256.0 to y = 0.0
    let rOff = <usize>(vIdx * FLOATS_PER_VERTEX * 4);
    store<f32>(ptr + rOff,      rightLimit);
    store<f32>(ptr + rOff + 4,  256.0);
    store<f32>(ptr + rOff + 8,  0.1);
    store<f32>(ptr + rOff + 12, 0.1);
    store<f32>(ptr + rOff + 16, 1.0);
    store<f32>(ptr + rOff + 20, 1.0);

    store<f32>(ptr + rOff + 24, rightLimit);
    store<f32>(ptr + rOff + 28, 0.0);
    store<f32>(ptr + rOff + 32, 0.1);
    store<f32>(ptr + rOff + 36, 0.1);
    store<f32>(ptr + rOff + 40, 1.0);
    store<f32>(ptr + rOff + 44, 1.0);
    vIdx += 2;
  }

  gridVertexCount = vIdx;
  return vIdx;
}
