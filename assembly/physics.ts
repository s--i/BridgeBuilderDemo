// Behavioral translation of bridge.exe. Routine addresses identify the evidence.
// f32 storage is retained; x87 intermediate precision is not yet emulated.
import { Node, Beam, TrainCar, LevelData, NODE_TYPE_ANCHOR, NODE_TYPE_TRAIN,
  BEAM_TYPE_DECK, BEAM_TYPE_TRAIN, DAMPING, STIFFNESS, STRESS_SCALE,
  SNAP_THRESHOLD, TRACTION_FORCE } from "./types";

class Contact {
  x: f32 = 0;
  y: f32 = 0;
  nx: f32 = 0;
  ny: f32 = 0;
}

// 0x00404bc8: segment intersection, normal facing the first ray endpoint.
function intersect(ax: f32, ay: f32, bx: f32, by: f32,
  cx: f32, cy: f32, dx: f32, dy: f32, out: Contact): bool {
  let ex = dx - cx, ey = dy - cy;
  let length = Mathf.sqrt(ex * ex + ey * ey);
  if (length == 0) return false; // Degenerate-input guard, not an original rule.
  let nx = -ey / length, ny = ex / length;
  let da = (ax - cx) * nx + (ay - cy) * ny;
  let db = (bx - cx) * nx + (by - cy) * ny;
  if ((da > 0 && db > 0) || (da < 0 && db < 0) || da == db) return false;
  if (da < 0) { nx = -nx; ny = -ny; }
  let t = da / (da - db);
  let x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
  if ((x - cx) * ex + (y - cy) * ey < 0 || (x - dx) * -ex + (y - dy) * -ey < 0) return false;
  out.x = x; out.y = y; out.nx = nx; out.ny = ny;
  return true;
}

export class PhysicsEngine {
  level: LevelData;
  nodes: Array<Node>;
  beams: Array<Beam>;
  trainCars: Array<TrainCar> = new Array<TrainCar>();
  simulationActive: bool = false;
  trainActive: bool = false;
  paused: bool = false;
  levelPassed: bool = false;
  bridgeCollapsed: bool = false;
  trainFallen: bool = false;
  brokenBeamCount: i32 = 0;
  originalNodes: Array<Node> = new Array<Node>();
  originalBeams: Array<Beam> = new Array<Beam>();
  hasSnapshot: bool = false;
  private contact: Contact = new Contact();

  constructor(level: LevelData, nodes: Array<Node>, beams: Array<Beam>) {
    this.level = level; this.nodes = nodes; this.beams = beams;
  }

  // Called after a new file replaces the arrays; don't restore an older design.
  loaded(): void {
    this.hasSnapshot = false;
    this.originalNodes.length = 0; this.originalBeams.length = 0;
    this.clearStatus();
  }

  designBeamCount(): i32 {
    return this.hasSnapshot ? this.originalBeams.length : this.beams.length;
  }

  private clearStatus(): void {
    this.simulationActive = false; this.trainActive = false; this.paused = false;
    this.levelPassed = false; this.bridgeCollapsed = false; this.trainFallen = false;
    this.brokenBeamCount = 0; this.trainCars.length = 0;
  }

  startTest(): void {
    if (this.simulationActive) return;
    if (!this.hasSnapshot) {
      this.originalNodes.length = 0; this.originalBeams.length = 0;
      for (let i = 0; i < this.nodes.length; i++) this.originalNodes.push(copyNode(this.nodes[i]));
      for (let i = 0; i < this.beams.length; i++) this.originalBeams.push(copyBeam(this.beams[i]));
      this.hasSnapshot = true;
    }
    this.simulationActive = true;
    this.trainActive = false;
    this.paused = false;
    this.levelPassed = false;
    this.bridgeCollapsed = false;
    this.trainFallen = false;
  }

  togglePause(): bool {
    if (!this.simulationActive) return false;
    this.paused = !this.paused;
    return this.paused;
  }

  reset(): void {
    if (this.hasSnapshot) {
      this.nodes.length = 0; this.beams.length = 0;
      for (let i = 0; i < this.originalNodes.length; i++) this.nodes.push(copyNode(this.originalNodes[i]));
      for (let i = 0; i < this.originalBeams.length; i++) this.beams.push(copyBeam(this.originalBeams[i]));
    }
    this.hasSnapshot = false;
    this.clearStatus();
  }

  spawnTrain(): void {
    if (this.trainActive) return;
    if (!this.hasSnapshot) {
      this.originalNodes.length = 0; this.originalBeams.length = 0;
      for (let i = 0; i < this.nodes.length; i++) this.originalNodes.push(copyNode(this.nodes[i]));
      for (let i = 0; i < this.beams.length; i++) this.originalBeams.push(copyBeam(this.beams[i]));
      this.hasSnapshot = true;
    }
    this.simulationActive = true;
    this.trainActive = true;
    this.paused = false;
    this.trainFallen = false;
    // 0x00403030 / 0x00407c78: ordinary four-car mode, locomotive first.
    for (let c = 0; c < 4; c++) {
      let car = new TrainCar();
      car.type = c == 0 ? 1 : 0;
      car.x = this.level.leftLimit - 16 - <f32>(c * 12);
      car.y = 130.1;
      for (let w = 0; w < 4; w++) {
        let n = new Node();
        n.type = NODE_TYPE_TRAIN; n.mass = 2;
        n.x = n.origX = car.x + ((w == 0 || w == 3) ? <f32>-4 : <f32>4);
        n.y = n.origY = car.y + (w < 2 ? <f32>-2 : <f32>2);
        car.wheelNodes[w] = this.nodes.length;
        this.nodes.push(n);
      }
      // Keep the original insertion order: it matters after swap-removal.
      for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++)
        this.addTrainBeam(car.wheelNodes[a], car.wheelNodes[b]);
      this.trainCars.push(car);
      if (c > 0) {
        let n = new Node();
        n.type = NODE_TYPE_TRAIN; n.mass = 1;
        n.x = n.origX = car.x + 6; n.y = n.origY = 130.1;
        let index = this.nodes.length;
        this.nodes.push(n);
        let previous = this.trainCars[c - 1];
        this.addTrainBeam(previous.wheelNodes[3], index);
        this.addTrainBeam(previous.wheelNodes[0], index);
        this.addTrainBeam(index, car.wheelNodes[2]);
        this.addTrainBeam(index, car.wheelNodes[1]);
      }
    }
  }

  private addTrainBeam(a: i32, b: i32): void {
    let na = this.nodes[a], nb = this.nodes[b];
    let dx = nb.x - na.x, dy = nb.y - na.y;
    let beam = new Beam();
    beam.node1 = a; beam.node2 = b; beam.type = BEAM_TYPE_TRAIN;
    beam.restLen = Mathf.sqrt(dx * dx + dy * dy);
    this.beams.push(beam);
  }

  step(): void {
    if (!this.simulationActive || this.paused) return;
    for (let i = 0; i < 8; i++) this.relaxSprings();
    this.checkStressAndSnapping();
    if (this.trainActive) {
      this.updateTrain();
    }
    this.integrateAndCollide();
    this.cleanupNodes();
  }

  private saveVelocities(): void {
    for (let i = 0; i < this.nodes.length; i++) {
      let n = this.nodes[i];
      n.savedVX = n.vx; n.savedVY = n.vy; n.savedVZ = n.vz;
    }
  }

  private relaxSprings(): void {
    // 0x00408018 copies every velocity before processing any member.
    this.saveVelocities();
    for (let i = 0; i < this.beams.length; i++) {
      let b = this.beams[i], a = this.nodes[b.node1], n = this.nodes[b.node2];
      let dx = (n.savedVX * DAMPING + (n.x - a.x)) - a.savedVX * DAMPING;
      let dy = (n.savedVY * DAMPING + (n.y - a.y)) - a.savedVY * DAMPING;
      let dz = (n.savedVZ * DAMPING + (n.z - a.z)) - a.savedVZ * DAMPING;
      let length: f32 = <f32>Math.sqrt((<f64>dy * dy + <f64>dx * dx) + <f64>dz * dz);
      if (length == 0 || a.mass + n.mass <= 0) continue;
      // Disassembly 0x00408145..0x00408221: normalize into f32 scratch,
      // compute double-constant weights, then round each velocity store.
      let reciprocal: f64 = 1 / <f64>length;
      dx = <f32>(dx * reciprocal); dy = <f32>(dy * reciprocal); dz = <f32>(dz * reciprocal);
      let extension: f32 = length - b.restLen;
      let inverseTotal: f64 = 1 / (<f64>a.mass + n.mass);
      let wa: f32 = <f32>(n.mass * STIFFNESS * inverseTotal);
      let wb: f32 = <f32>(STIFFNESS * a.mass * inverseTotal);
      let ix: f64 = <f64>dx * extension, iy: f64 = <f64>dy * extension;
      let iz: f64 = <f64>dz * extension;
      a.vx = <f32>(a.vx + ix * wa); a.vy = <f32>(a.vy + iy * wa); a.vz = <f32>(a.vz + iz * wa);
      n.vx = <f32>(n.vx - ix * wb); n.vy = <f32>(n.vy - iy * wb); n.vz = <f32>(n.vz - wb * iz);
    }
  }

  private checkStressAndSnapping(): void {
    // 0x0040823c uses predicted separation, then removes by swapping the tail.
    for (let i = 0; i < this.beams.length; i++) {
      let b = this.beams[i], a = this.nodes[b.node1], n = this.nodes[b.node2];
      let dx = (n.vx * DAMPING + (n.x - a.x)) - a.vx * DAMPING;
      let dy = (n.vy * DAMPING + (n.y - a.y)) - a.vy * DAMPING;
      let dz = (n.vz * DAMPING + (n.z - a.z)) - a.vz * DAMPING;
      let length: f32 = <f32>Math.sqrt((<f64>dy * dy + <f64>dx * dx) + <f64>dz * dz);
      let extension: f32 = Mathf.abs(length - b.restLen);
      b.stress = Mathf.min(1, <f32>(Math.abs(<f64>length - b.restLen) * STRESS_SCALE));
      if (extension > SNAP_THRESHOLD) {
        if (b.type != BEAM_TYPE_TRAIN) {
          this.brokenBeamCount++;
        }
        this.removeBeam(i);
        // Original advances i: the swapped member is assessed next tick.
      }
    }
  }

  private removeBeam(index: i32): void {
    let beam = this.beams[index];
    for (let endpoint = 0; endpoint < 2; endpoint++) {
      let node = endpoint == 0 ? beam.node1 : beam.node2;
      let connected = false;
      for (let i = 0; i < this.beams.length; i++) {
        if (i != index && (this.beams[i].node1 == node || this.beams[i].node2 == node)) connected = true;
      }
      if (!connected && this.nodes[node].type != NODE_TYPE_ANCHOR) this.nodes[node].lifetime = 1;
    }
    let last = this.beams.pop();
    if (index < this.beams.length) this.beams[index] = last;
  }

  private updateTrain(): void {
    let allAcross = this.trainCars.length > 0;
    for (let c = 0; c < this.trainCars.length; c++) {
      let car = this.trainCars[c];
      let valid = true;
      for (let w = 0; w < 4; w++) if (car.wheelNodes[w] < 0) valid = false;
      if (!valid) { this.trainFallen = true; this.bridgeCollapsed = true; allAcross = false; continue; }
      car.x = 0; car.y = 0; car.vx = 0; car.vy = 0;
      for (let w = 0; w < 4; w++) {
        let n = this.nodes[car.wheelNodes[w]];
        car.x += n.x; car.y += n.y; car.vx += n.vx; car.vy += n.vy;
      }
      car.x /= 4; car.y /= 4; car.vx /= 4; car.vy /= 4;
      let a = this.nodes[car.wheelNodes[0]], b = this.nodes[car.wheelNodes[1]];
      let dx = b.x - a.x, dy = b.y - a.y;
      let length = Mathf.sqrt(dx * dx + dy * dy);
      car.angle = Mathf.atan2(dy, dx);
      if (car.type == 1 && car.x < this.level.rightLimit + 64 && length > 0) {
        let tx: f32 = <f32>(<f64>(dx / length) * TRACTION_FORCE) * <f32>this.trainCars.length;
        let ty: f32 = <f32>(<f64>(dy / length) * TRACTION_FORCE) * <f32>this.trainCars.length;
        for (let w = 0; w < 4; w++) {
          let n = this.nodes[car.wheelNodes[w]]; n.vx += tx; n.vy += ty;
        }
      }
      if (car.x < this.level.rightLimit) allAcross = false;
      // Host feedback only; original completion checks car centers, not this flag.
      if (car.y < this.level.waterLevel - 2) {
        this.trainFallen = true;
        this.bridgeCollapsed = true;
      }
    }
    if (allAcross) this.levelPassed = true;
  }

  private integrateAndCollide(): void {
    // 0x00408398: gravity, per-node damping, water damping, snapshot, movement.
    for (let i = 0; i < this.nodes.length; i++) {
      let n = this.nodes[i];
      n.vy -= n.gravity;
      n.vx *= n.drag; n.vy *= n.drag;
      if (n.y < this.level.waterLevel) { n.vx = <f32>(<f64>n.vx * 0.85); n.vy = <f32>(<f64>n.vy * 0.85); }
    }
    this.saveVelocities();
    for (let i = 0; i < this.nodes.length; i++) {
      let n = this.nodes[i];
      n.previousX = n.x; n.previousY = n.y; n.previousZ = n.z;
      n.x += n.vx; n.y += n.vy; n.z += n.vz;
    }
    let hit = this.contact;
    for (let i = 0; i < this.nodes.length; i++) {
      let n = this.nodes[i];
      if (n.type == NODE_TYPE_ANCHOR) continue;
      // Terrain spans samples at multiples of four. Original uses integer conversion.
      let col = (<i32>n.x) >> 2;
      if (col < 0 || col >= 1023) continue;
      if (intersect(n.x, n.y + 16, n.x, n.y, <f32>(col * 4), this.level.terrain[col],
          <f32>((col + 1) * 4), this.level.terrain[col + 1], hit)) {
        let dx = hit.x - n.x, dy = hit.y - n.y;
        let depth = Mathf.sqrt(dx * dx + dy * dy);
        // 0x0040940c with friction=0 keeps only the normal component.
        let cx = n.savedVX * <f32>1.4 - depth * hit.nx * <f32>0.1;
        let cy = n.savedVY * <f32>1.4 - depth * hit.ny * <f32>0.1;
        let impulse = cx * hit.nx + cy * hit.ny;
        if (impulse < 0) { n.vx -= impulse * hit.nx; n.vy -= impulse * hit.ny; }
      }
    }
    // Original order: deck members, cars, then each of the car's four nodes.
    for (let i = 0; i < this.beams.length; i++) {
      let beam = this.beams[i];
      if (beam.type != BEAM_TYPE_DECK) continue;
      let a = this.nodes[beam.node1], b = this.nodes[beam.node2];
      for (let c = 0; c < this.trainCars.length; c++) {
        let car = this.trainCars[c];
        for (let w = 0; w < 4; w++) {
          if (car.wheelNodes[w] < 0) continue;
          let n = this.nodes[car.wheelNodes[w]];
          if (!intersect(car.x, car.y, n.x, n.y, a.x, a.y, b.x, b.y, hit)) continue;
          let dx = hit.x - a.x, dy = hit.y - a.y;
          let da = Mathf.sqrt(dx * dx + dy * dy);
          dx = hit.x - b.x; dy = hit.y - b.y;
          let db = Mathf.sqrt(dx * dx + dy * dy);
          if (da + db == 0) continue;
          let wa = db / (da + db), wb = da / (da + db);
          let wheelNormal = n.savedVX * hit.nx + n.savedVY * hit.ny;
          let vx = a.savedVX * wa + b.savedVX * wb;
          let vy = a.savedVY * wa + b.savedVY * wb;
          dx = hit.x - n.x; dy = hit.y - n.y;
          let depth = Mathf.sqrt(dx * dx + dy * dy);
          vx += depth * hit.nx * <f32>0.1; vy += depth * hit.ny * <f32>0.1;
          let deckNormal = vx * hit.nx + vy * hit.ny;
          let ix = (wheelNormal - deckNormal) * hit.nx;
          let iy = (wheelNormal - deckNormal) * hit.ny;
          let fraction = n.mass / (a.mass * wa + b.mass * wb + n.mass);
          n.vx -= ix * (1 - fraction); n.vy -= iy * (1 - fraction);
          a.vx += ix * wa * fraction; a.vy += iy * wa * fraction;
          b.vx += ix * wb * fraction; b.vy += iy * wb * fraction;
        }
      }
    }
  }

  private cleanupNodes(): void {
    // 0x00408a50 / 0x00408ea4: countdown and tail-swap deletion.
    let i = 0;
    while (i < this.nodes.length) {
      let n = this.nodes[i];
      if (n.lifetime < 10000) n.lifetime--;
      if (n.lifetime >= 0) { i++; continue; }
      for (let j = 0; j < this.beams.length;) {
        if (this.beams[j].node1 == i || this.beams[j].node2 == i) this.removeBeam(j);
        else j++;
      }
      let lastIndex = this.nodes.length - 1;
      let tail = this.nodes.pop();
      if (i < this.nodes.length) this.nodes[i] = tail;
      for (let j = 0; j < this.beams.length; j++) {
        if (this.beams[j].node1 == lastIndex) this.beams[j].node1 = i;
        if (this.beams[j].node2 == lastIndex) this.beams[j].node2 = i;
      }
      for (let c = 0; c < this.trainCars.length; c++) for (let w = 0; w < 4; w++) {
        let car = this.trainCars[c];
        if (car.wheelNodes[w] == i) car.wheelNodes[w] = -1;
        else if (car.wheelNodes[w] == lastIndex) car.wheelNodes[w] = i;
      }
    }
  }
}

function copyNode(source: Node): Node {
  let copy = new Node();
  copy.type = source.type;
  copy.x = source.x;
  copy.y = source.y;
  copy.z = source.z;
  copy.vx = source.vx;
  copy.vy = source.vy;
  copy.vz = source.vz;
  copy.origX = source.origX;
  copy.origY = source.origY;
  copy.origZ = source.origZ;
  copy.previousX = source.previousX;
  copy.previousY = source.previousY;
  copy.previousZ = source.previousZ;
  copy.savedVX = source.savedVX;
  copy.savedVY = source.savedVY;
  copy.savedVZ = source.savedVZ;
  copy.mass = source.mass;
  copy.drag = source.drag;
  copy.gravity = source.gravity;
  copy.bounce = source.bounce;
  copy.depth = source.depth;
  copy.lifetime = source.lifetime;
  copy.active = source.active;
  copy.r = source.r;
  copy.g = source.g;
  copy.b = source.b;
  return copy;
}

function copyBeam(source: Beam): Beam {
  let copy = new Beam();
  copy.node1 = source.node1;
  copy.node2 = source.node2;
  copy.type = source.type;
  copy.restLen = source.restLen;
  copy.stress = source.stress;
  copy.broken = source.broken;
  return copy;
}
