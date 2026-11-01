import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const scope = vm.createContext({ window: {}, Float32Array, Uint8Array, Math });
for (const file of ['assets', 'bridge_engine', 'webgl_renderer']) {
  vm.runInContext(fs.readFileSync(`web/${file}.js`, 'utf8'), scope);
}
const { instance } = await WebAssembly.instantiate(fs.readFileSync('build/bridge.wasm'), {
  env: { abort() { throw new Error('Wasm abort'); } }
});
const engine = new scope.window.WasmBridgeEngine(instance);
const level = Buffer.from(scope.window.BRIDGE_ASSETS.levels['level01.lvl'], 'base64');
assert.ok(engine.loadLevelBinary(level));

// Read-only Wasm queries must use the same snapped endpoints/materials as clicks.
engine.editorClick(2032, 128);
const before = Buffer.from(engine.exportBridgeBinary());
const selected = engine.editorSelection;
const previousResult = engine.editorResult;
const deck = engine.getEditorVisuals(2040.8, 128.8);
assert.equal(deck.preview.type, 2);
assert.equal(deck.preview.x, 2040);
assert.equal(deck.preview.y, 128);
assert.equal(engine.getEditorVisuals(2040, 124).preview.type, 1);
assert.equal(engine.getEditorVisuals(2050, 128).preview, null, 'strict 18-unit cursor gate');
assert.equal(engine.getEditorVisuals(2032, 124).preview, null, 'anchor-to-anchor rejection');
assert.equal(engine.getEditorVisuals(NaN, NaN).preview, null);
assert.equal(engine.editorSelection, selected);
assert.equal(engine.editorResult, previousResult);
assert.deepEqual(Buffer.from(engine.exportBridgeBinary()), before, 'preview must not change the saved design');

engine.editorClick(2040, 124);
engine.editorCancel();
assert.equal(engine.getEditorVisuals(2040.9, 124.9).hoveredNode, 4, 'joint hover uses snapped coordinates');
assert.equal(engine.getEditorVisuals(2041, 124).hoveredNode, -1);
assert.equal(engine.getEditorVisuals(2036, 126).hoveredBeam, 0);
assert.equal(engine.getEditorVisuals(2036, 127.2).hoveredBeam, -1, 'member hover uses raw coordinates');
assert.equal(engine.getEditorVisuals(2040, 124).hoveredBeam, -1, 'joint hover takes precedence');
engine.editorClick(2032, 128);
assert.equal(engine.getEditorVisuals(2036, 126).hoveredBeam, -1, 'no member hover while building');
assert.equal(engine.getEditorVisuals(2040, 124).preview, null, 'duplicate member has no preview');

const renderer = Object.create(scope.window.WebGLRenderer.prototype);
const nodes = [{ x: 0, y: 0, type: 1 }, { x: 8, y: 0, type: 1 }];
const beams = [{ node1: 0, node2: 1, type: 1 }];
assert.equal(renderer.buildEditorFeedback(nodes, beams, 0), 112);
const vertex = (i) => Array.from(renderer.editorFeedbackData.slice(i * 6, i * 6 + 6));
assert.deepEqual(vertex(0), [-0.25, 0.5, 0, 1, 0, 0.25]);
assert.deepEqual(vertex(1), [0.25, 0.5, 0, 1, 0, 0.25]);
const alphas = [0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25];
for (let pass = 0; pass < 7; pass++) {
  assert.equal(vertex(pass * 16)[5], alphas[pass]);
  assert.deepEqual(vertex(pass * 16 + 15), vertex(pass * 16), 'octagon must close');
}
assert.ok(Math.abs(vertex(96)[1] - 0.8) < 0.000001, 'outer half-size is 0.8 world units');
assert.equal(renderer.buildEditorFeedback(nodes, beams, -1, { hoveredNode: 0 }), 112);
assert.deepEqual(vertex(0), [-0.25, 0.5, 1, 1, 1, 0.125]);
assert.equal(renderer.buildEditorFeedback(nodes, beams, -1, { hoveredBeam: 0 }), 28);
assert.deepEqual(vertex(0), [0, -0.25, 0.5, 0.5, 0.5, 0.125]);
assert.deepEqual(vertex(1), [8, -0.25, 0.5, 0.5, 0.5, 0.125]);
renderer.buildEditorFeedback(nodes, beams, -1, { hoveredBeam: 0, deleting: true });
assert.deepEqual(vertex(0), [0, -0.25, 1, 1, 1, 0.25]);
assert.equal(renderer.buildEditorBeams(nodes, [], { from: 0, x: 8, y: 0, type: 2 }), 2);
assert.deepEqual(Array.from(renderer.editorLinesData.slice(0, 12)),
  [0, 0, 1, 1, 1, 1, 8, 0, 1, 1, 1, 1]);
assert.equal(renderer.buildEditorBeams(nodes, [], null), 0, 'invalid preview draws no line');

// Exercise actual render dispatch: preview is under water/terrain, feedback is
// after scene geometry but before text, and simulation has neither editor pass.
const draws = [];
let bound = null;
renderer.gl = {
  ARRAY_BUFFER: 1, DYNAMIC_DRAW: 2, FLOAT: 3, LINES: 4, TRIANGLES: 5, COLOR_BUFFER_BIT: 6,
  viewport() {}, clearColor() {}, clear() {}, useProgram() {}, uniformMatrix4fv() {},
  createBuffer() { return {}; }, bindBuffer(target, buffer) { bound = buffer; },
  bufferData() {}, bufferSubData() {}, enableVertexAttribArray() {}, vertexAttribPointer() {},
  drawArrays(mode, start, count) { draws.push({ buffer: bound, mode, count }); }
};
Object.assign(renderer, {
  canvas: { width: 800, height: 600 }, program: {},
  attribs: { position: 0, color: 1 }, uniforms: { viewProjection: {} },
  vertexStride: 24, maxVertices: 120000, vertexData: new Float32Array(120000 * 6),
  vbo: 'scene', gridVbo: 'grid', editorLinesVbo: 'beams', editorFeedbackVbo: 'feedback',
  beamHalfThickness: 0.4,
  renderText() { draws.push({ buffer: 'text' }); }
});
renderer.render(engine, 2048, 120, 5, false, [{ text: 'Test' }], 'editor', engine.getEditorVisuals(2040, 128));
assert.deepEqual(draws.map(d => d.buffer), ['grid', 'beams', 'scene', 'feedback', 'text']);
assert.equal(draws[1].count, 4, 'one real member and one temporary preview');
engine.startTest();
assert.equal(engine.getEditorVisuals(2040, 124).hoveredNode, -1);
assert.equal(engine.getEditorVisuals(2036, 126).hoveredBeam, -1);
assert.equal(engine.getEditorVisuals(2040, 128).preview, null);
draws.length = 0;
renderer.render(engine, 2048, 120, 5, false, [{ text: 'Edit' }], 'simulation');
assert.deepEqual(draws.map(d => d.buffer), ['scene', 'text']);
console.log('Editor visual tests passed: Wasm picking/preview immutability, recovered geometry/colors, and render ordering.');
