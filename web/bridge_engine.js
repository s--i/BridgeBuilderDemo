// Wasm host adapter. All editing and physics state lives in the module.
class WasmBridgeEngine {
  constructor(instance) {
    this.wasm = instance.exports;
    this.memory = this.wasm.memory;
    this.isWasm = true;
    this.level = {
      waterLevel: 120.0,
      trackY: 128.0,
      budget: 10000,
      leftLimit: 2000.0,
      rightLimit: 2100.0,
      terrain: new Float32Array(1024),
      terrainShading: new Float32Array(1024)
    };
    this.MIN_BEAM_LEN = 1.9;
    this.MAX_BEAM_LEN = 18.0;
    this.syncLevel();
  }

  loadLevelBinary(buffer) {
    const ptr = this.wasm.prepareFileBuffer(buffer.byteLength);
    if (!ptr) return false;
    new Uint8Array(this.memory.buffer).set(new Uint8Array(buffer), ptr);
    const ok = this.wasm.loadLevel(buffer.byteLength);
    if (ok) this.syncLevel();
    return ok;
  }

  loadBridgeBinary(buffer) {
    const ptr = this.wasm.prepareFileBuffer(buffer.byteLength);
    if (!ptr) return false;
    new Uint8Array(this.memory.buffer).set(new Uint8Array(buffer), ptr);
    const ok = this.wasm.loadBridge(buffer.byteLength);
    if (ok) this.syncLevel();
    return ok;
  }

  syncLevel() {
    this.level.waterLevel = this.wasm.getWaterLevel();
    this.level.trackY = this.wasm.getTrackY();
    this.level.budget = this.wasm.getTotalBudget();
    this.level.leftLimit = this.wasm.getLeftLimit();
    this.level.rightLimit = this.wasm.getRightLimit();
    for (let i = 0; i < 1024; i++) {
      this.level.terrain[i] = this.wasm.getTerrainHeight(i);
    }
    this.syncShading();
  }

  syncShading() {
    if (typeof BridgeLighting !== 'undefined' && this.level.terrain) {
      BridgeLighting.computeTerrainShading(
        this.level.terrain,
        this.level.waterLevel,
        this.simulationActive,
        this.level.terrainShading
      );
    }
  }

  get nodes() {
    const count = this.wasm.getNodeCount();
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({
        x: this.wasm.getNodeX(i),
        y: this.wasm.getNodeY(i),
        type: this.wasm.getNodeType(i)
      });
    }
    return list;
  }

  get beams() {
    const count = this.wasm.getBeamCount();
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({
        node1: this.wasm.getBeamNode1(i),
        node2: this.wasm.getBeamNode2(i),
        type: this.wasm.getBeamType(i),
        stress: this.wasm.getBeamStress(i),
        broken: this.wasm.isBeamBroken(i)
      });
    }
    return list;
  }

  get trainCars() {
    const count = this.wasm.getTrainCarCount();
    const list = [];
    for (let i = 0; i < count; i++) {
      list.push({
        x: this.wasm.getTrainCarX(i),
        y: this.wasm.getTrainCarY(i),
        angle: this.wasm.getTrainCarAngle ? this.wasm.getTrainCarAngle(i) : 0,
        type: this.wasm.getTrainCarType(i),
        wheelNodes: [0, 1, 2, 3].map(w => this.wasm.getTrainWheelNode(i, w))
      });
    }
    return list;
  }

  get simulationActive() { return this.wasm.isSimulationRunning(); }
  get trainActive() { return this.wasm.isTrainRunning(); }
  get paused() { return this.wasm.isPaused(); }
  get levelPassed() { return this.wasm.isLevelPassed(); }
  get bridgeCollapsed() { return this.wasm.isBridgeCollapsed(); }
  get trainFallen() { return this.wasm.isTrainFallen ? this.wasm.isTrainFallen() : false; }
  get brokenBeamCount() { return this.wasm.getBrokenBeamCount ? this.wasm.getBrokenBeamCount() : 0; }
  get trainCarCount() {
    return this.wasm && this.wasm.getConfiguredTrainCarCount ? this.wasm.getConfiguredTrainCarCount() : 4;
  }
  set trainCarCount(count) {
    if (this.wasm && this.wasm.setConfiguredTrainCarCount) {
      this.wasm.setConfiguredTrainCarCount(count);
    }
  }

  get editorSelection() { return this.wasm.getEditorSelection(); }
  get editorResult() { return this.wasm.getEditorResult(); }
  editorClick(x, y) { return this.wasm.editorClick(x, y); }
  editorDeleteAt(x, y) { this.wasm.editorDeleteAt(x, y); }
  editorCancel() { this.wasm.editorCancel(); }
  editorPreview(x, y) { return this.wasm.editorPreview(x, y); }
  editorSnap(value) { return this.wasm.editorSnap(value); }
  getEditorVisuals(x, y) {
    const hoveredNode = this.wasm.editorHoverNode(x, y);
    const hoveredBeam = this.wasm.editorHoverBeam(x, y);
    const type = this.wasm.editorPreviewType(x, y);
    return {
      hoveredNode,
      hoveredBeam,
      sourceNode: this.editorSelection,
      preview: type ? {
        from: this.editorSelection,
        x: hoveredNode >= 0 ? this.wasm.getNodeX(hoveredNode) : this.editorSnap(x),
        y: hoveredNode >= 0 ? this.wasm.getNodeY(hoveredNode) : this.editorSnap(y),
        type
      } : null
    };
  }
  editorTick() { this.wasm.editorTick(); }

  addNode(x, y) { return this.wasm.addNode(x, y); }
  addBeam(n1, n2, type = 0) { return this.wasm.addBeam(n1, n2, type); }
  deleteNode(idx) { return this.wasm.deleteNode(idx); }
  deleteBeam(idx) { return this.wasm.deleteBeam(idx); }
  resetSimulation() { this.wasm.resetSimulation(); this.syncShading(); }
  clearBridge() { this.wasm.clearBridge(); }
  startTest() { this.wasm.startTest(); this.syncShading(); }
  startTrain() { this.wasm.startTrain(); this.syncShading(); }
  togglePause() { return this.wasm.togglePause(); }
  setPaused(p) { this.wasm.setPaused(p); }
  step() { this.wasm.stepSimulation(); }
  getCost() {
    return this.wasm.getBridgeCost ? this.wasm.getBridgeCost() : (this.level.budget - this.wasm.getRemainingBudget());
  }
  getRemainingBudget() { return this.wasm.getRemainingBudget(); }
  getNodes() { return this.nodes; }
  getBeams() { return this.beams; }
  getTrainCars() { return this.trainCars; }

  generateGrid(viewX, viewY, halfWidth, leftLimit, rightLimit, showLimits = true) {
    if (!this.wasm.generateGrid) return 0;
    return this.wasm.generateGrid(viewX, viewY, halfWidth, leftLimit, rightLimit, showLimits);
  }

  getGridVertexData(vertexCount) {
    if (!this.wasm.getGridBuffer || vertexCount <= 0) return null;
    const ptr = this.wasm.getGridBuffer();
    // Fresh view into Wasm memory; gracefully accommodates any memory growth
    return new Float32Array(this.memory.buffer, ptr, vertexCount * 6);
  }

  exportBridgeBinary() {
    if (!this.wasm.exportBridge) return null;
    const len = this.wasm.exportBridge();
    if (len <= 0) return null;
    const ptr = this.wasm.getFileBufferPtr();
    return new Uint8Array(this.memory.buffer, ptr, len).slice().buffer;
  }
}

async function createBridgeEngine() {
  if (typeof window !== 'undefined' && window.BRIDGE_WASM_BASE64) {
    try {
      const binary = atob(window.BRIDGE_WASM_BASE64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

      const { instance } = await WebAssembly.instantiate(bytes.buffer, {
        env: {
          abort: (msg, file, line, col) => { throw new Error(`Wasm abort at ${line}:${col}`); }
        }
      });
      console.log("WebAssembly Bridge Engine loaded successfully!");
      return new WasmBridgeEngine(instance);
    } catch (err) {
      throw new Error(`Unable to load the WebAssembly engine: ${err.message}`);
    }
  }
  throw new Error("The bundled WebAssembly module is missing. Run npm run build.");
}

window.WasmBridgeEngine = WasmBridgeEngine;
window.createBridgeEngine = createBridgeEngine;
window.BridgeEngine = { create: createBridgeEngine };

