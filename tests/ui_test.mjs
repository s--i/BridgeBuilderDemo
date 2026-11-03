import fs from 'node:fs';
import vm from 'node:vm';

// Mock minimal browser globals for testing webgl_game logic
const mockElements = new Map();

function createElement(id, tag = 'DIV') {
  let _innerHTML = '';
  let _textContent = '';
  const el = {
    id,
    tagName: tag.toUpperCase(),
    style: {},
    attributes: {},
    children: [],
    value: '',
    disabled: false,
    tabIndex: 0,
    width: 640,
    height: 480,
    clientWidth: 640,
    clientHeight: 480,
    focus: () => {
      document.activeElement = el;
      if (el._listeners && el._listeners.focus) {
        for (const fn of el._listeners.focus) fn();
      }
    },
    blur: () => {
      if (document.activeElement === el) document.activeElement = null;
      if (el._listeners && el._listeners.blur) {
        for (const fn of el._listeners.blur) fn();
      }
    },
    get innerHTML() {
      return _innerHTML;
    },
    set innerHTML(val) {
      _innerHTML = String(val);
      if (val === '') {
        this.children = [];
      }
    },
    get textContent() {
      return _textContent;
    },
    set textContent(val) {
      _textContent = String(val);
      if (val === '') {
        this.children = [];
      }
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 640, height: 480 }),
    getContext: (type) => {
      if (type === '2d') {
        return {
          clearRect: () => {},
          save: () => {},
          restore: () => {},
          setTransform: () => {},
          beginPath: () => {},
          moveTo: () => {},
          lineTo: () => {},
          arc: () => {},
          stroke: () => {},
          setLineDash: () => {}
        };
      }
      return null;
    },
    addEventListener: (event, handler) => {
      el._listeners = el._listeners || {};
      el._listeners[event] = el._listeners[event] || [];
      el._listeners[event].push(handler);
    },
    click: () => {
      if (el.onclick) el.onclick({ preventDefault: () => {}, stopPropagation: () => {} });
      if (el._listeners && el._listeners.click) {
        for (const fn of el._listeners.click) fn({ preventDefault: () => {}, stopPropagation: () => {} });
      }
    },
    setAttribute: (name, val) => { el.attributes[name] = val; },
    getAttribute: (name) => el.attributes[name] !== undefined ? el.attributes[name] : null,
    appendChild: (child) => { el.children.push(child); },
    removeChild: (child) => {
      const idx = el.children.indexOf(child);
      if (idx !== -1) el.children.splice(idx, 1);
    }
  };
  mockElements.set(id, el);
  return el;
}

const documentListeners = new Map();
const document = {
  getElementById: (id) => mockElements.get(id) || createElement(id),
  createElement: (tag) => createElement(`tag-${Math.random()}`, tag),
  body: createElement('body', 'BODY'),
  activeElement: null,
  addEventListener: (event, handler) => {
    if (!documentListeners.has(event)) documentListeners.set(event, []);
    documentListeners.get(event).push(handler);
  }
};
document.getElementById('html-dialog-container').style.display = 'none';

const windowListeners = new Map();
const window = {
  innerWidth: 800,
  innerHeight: 600,
  devicePixelRatio: 1,
  location: { href: 'http://localhost' },
  addEventListener: (event, handler) => {
    if (!windowListeners.has(event)) windowListeners.set(event, []);
    windowListeners.get(event).push(handler);
  }
};

function sendKeyDown(props) {
  const listeners = windowListeners.get('keydown') || [];
  const event = {
    key: props.key || '',
    code: props.code || '',
    repeat: !!props.repeat,
    shiftKey: !!props.shiftKey,
    ctrlKey: !!props.ctrlKey,
    metaKey: !!props.metaKey,
    altKey: !!props.altKey,
    isComposing: !!props.isComposing,
    target: props.target || document.body,
    defaultPrevented: false,
    preventDefault: function() { this.defaultPrevented = true; },
    stopPropagation: () => {}
  };
  for (const fn of listeners) {
    fn(event);
  }
  return event;
}

function sendKeyUp(props) {
  const listeners = windowListeners.get('keyup') || [];
  const event = {
    key: props.key || '',
    code: props.code || '',
    repeat: !!props.repeat,
    shiftKey: !!props.shiftKey,
    ctrlKey: !!props.ctrlKey,
    metaKey: !!props.metaKey,
    altKey: !!props.altKey,
    isComposing: !!props.isComposing,
    target: props.target || document.body,
    defaultPrevented: false,
    preventDefault: function() { this.defaultPrevented = true; },
    stopPropagation: () => {}
  };
  for (const fn of listeners) {
    fn(event);
  }
  return event;
}

const storage = new Map();
const localStorage = {
  getItem: (k) => storage.get(k) || null,
  setItem: (k, v) => storage.set(k, String(v)),
  removeItem: (k) => storage.delete(k)
};

global.document = document;
global.window = window;
global.localStorage = localStorage;
global.atob = (str) => Buffer.from(str, 'base64').toString('binary');
global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
global.performance = { now: () => Date.now() };
global.requestAnimationFrame = (cb) => setTimeout(cb, 16);

// Load font_assets.js
vm.runInThisContext(fs.readFileSync('web/font_assets.js', 'utf8'));

// Verify font data
console.log('Font loaded:', window.BRIDGE_FONT.width, 'x', window.BRIDGE_FONT.height);
if (!window.BRIDGE_FONT.data || window.BRIDGE_FONT.width !== 256 || window.BRIDGE_FONT.height !== 128) {
  throw new Error('Invalid BRIDGE_FONT asset');
}

// Load assets.js
vm.runInThisContext(fs.readFileSync('web/assets.js', 'utf8'));
if (!window.BRIDGE_ASSETS || !window.BRIDGE_ASSETS.levels) {
  throw new Error('Invalid BRIDGE_ASSETS');
}

// Load lighting.js
vm.runInThisContext(fs.readFileSync('web/lighting.js', 'utf8'));

// Load editor_controls.js
vm.runInThisContext(fs.readFileSync('web/editor_controls.js', 'utf8'));
global.EditorControls = window.EditorControls;

// Mock WebGLRenderer with text inspection
class MockWebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderedCommands = [];
  }
  render(engine, viewX, viewY, zoom, stressView, textCommands, screenMode) {
    this.renderedCommands = textCommands || [];
    this.screenMode = screenMode;
  }
}
global.WebGLRenderer = MockWebGLRenderer;

// Load Wasm Module & instantiate mock engine
const wasmBuffer = fs.readFileSync('build/bridge.wasm');
const { instance } = await WebAssembly.instantiate(wasmBuffer, {
  env: { abort: () => { throw new Error('Wasm abort'); } }
});

vm.runInThisContext(fs.readFileSync('web/bridge_engine.js', 'utf8'));
window.createBridgeEngine = async () => new window.WasmBridgeEngine(instance);

// Now load webgl_game.js
// Replace top-level let/const with var so they attach to global in runInThisContext
const gameSrc = fs.readFileSync('web/webgl_game.js', 'utf8')
  .replace(/^(let|const) /gm, 'var ');
vm.runInThisContext(gameSrc);

// Give init() a tick to complete
await new Promise(resolve => setTimeout(resolve, 50));

console.log('=== TEST 1: Initial Screen is Home ===');
if (currentScreen !== 'home') throw new Error(`Expected currentScreen 'home', got '${currentScreen}'`);
const homeControls = getControls('home');
const homeLabels = homeControls.map(c => c.text);
console.log('Home controls:', homeLabels);
if (!homeLabels.includes('Bridge') || !homeLabels.includes('Builder') || !homeLabels.includes('Start Game') || !homeLabels.includes('Load Bridge') || !homeLabels.includes('Readme') || !homeLabels.includes('Exit')) {
  throw new Error('Home screen missing expected controls');
}
const exitCtrl = homeControls.find(c => c.id === 'btn-home-exit');
if (!exitCtrl || exitCtrl.y !== 368 || exitCtrl.action !== 'exit' || exitCtrl.shortcut !== 'E') {
  throw new Error('Home Exit control has incorrect properties');
}
// Test clicking Exit on Home navigates to GitHub repo
window.location.href = 'http://localhost';
dispatch('exit');
if (window.location.href !== 'https://github.com/s--i/BridgeBuilderDemo') {
  throw new Error(`Dispatching exit on home should set location to GitHub repo, got: ${window.location.href}`);
}
// Test pressing 'E' shortcut on Home navigates to GitHub repo
window.location.href = 'http://localhost';
sendKeyDown({ key: 'e' });
if (window.location.href !== 'https://github.com/s--i/BridgeBuilderDemo') {
  throw new Error(`Pressing 'e' on home should navigate to GitHub repo, got: ${window.location.href}`);
}
console.log('Test 1 Passed: Home screen verified.');

console.log('=== TEST 2: Navigation to Level Selection ===');
dispatch('start-game');
if (currentScreen !== 'levels') throw new Error(`Expected currentScreen 'levels', got '${currentScreen}'`);
const levelControls = getControls('levels');
const levelTexts = levelControls.map(c => c.text);
console.log('Level controls sample:', levelTexts.slice(0, 5));
// Authentic level menu: initially only Levels 1-7 are visible (8-15 hidden until unlocked)
if (!levelTexts.includes('Exit') || !levelTexts.includes('Level 1') || !levelTexts.includes('Level 7')) {
  throw new Error('Level selection missing expected controls (Exit, Level 1..7)');
}
if (levelTexts.some(t => t.includes('Level 8') || t.includes('Level 15'))) {
  throw new Error('Levels 8-15 should not appear until unlocked');
}
// Verify Level 1 is unlocked, Level 2 is locked initially
const lvl1 = levelControls.find(c => c.text.includes('Level 1'));
const lvl2 = levelControls.find(c => c.text.includes('Level 2'));
if (lvl1.disabled !== false) throw new Error('Level 1 should be enabled');
if (lvl2.disabled !== true) throw new Error('Level 2 should be disabled initially');

// Test that Levels 8-15 appear progressively as unlocked
gameProgress.unlockedLevel = 8;
const lvl8Controls = getControls('levels').map(c => c.text);
if (!lvl8Controls.some(t => t.includes('Level 8'))) throw new Error('Level 8 should appear when unlockedLevel is 8');
if (lvl8Controls.some(t => t.includes('Level 9'))) throw new Error('Level 9 should not appear when unlockedLevel is 8');

gameProgress.unlockedLevel = 15;
const allLvlControls = getControls('levels').map(c => c.text);
if (!allLvlControls.some(t => t.includes('Level 15'))) throw new Error('Level 15 should appear when unlockedLevel is 15');
gameProgress.unlockedLevel = 1;

console.log('Test 2 Passed: Level selection verified.');

console.log('=== TEST 3: Navigation to Readme & Exit to Home ===');
dispatch('exit');
if (currentScreen !== 'home') throw new Error('Exit did not return home');
dispatch('readme');
if (currentScreen !== 'readme') throw new Error('Failed to navigate to readme');
const readmeControls = getControls('readme');
if (!readmeControls.some(c => c.text === 'Exit')) throw new Error('Readme missing Exit');
if (!readmeControls.some(c => c.text.includes('How to play:'))) throw new Error('Readme missing body text');
if (!readmeControls.some(c => c.text.includes('go to www.glsetup.com'))) throw new Error('Readme missing authentic OpenGL drivers line');
if (readmeControls.some(c => c.text.includes('Browser controls:'))) throw new Error('Readme must not contain non-authentic synthetic "Browser controls" paragraph');
dispatch('exit');
if (currentScreen !== 'home') throw new Error('Exit from Readme did not return home');
console.log('Test 3 Passed: Readme verified.');

console.log('=== TEST 4: Editor Screen & Controls ===');
dispatch('start-game');
dispatch('select-level', { levelName: 'level01.lvl' });
if (currentScreen !== 'editor') throw new Error(`Expected currentScreen 'editor', got '${currentScreen}'`);
const editorControls = getControls('editor');
const editorIds = editorControls.map(c => c.id);
console.log('Editor control IDs:', editorIds);
const requiredEditorIds = ['btn-editor-exit', 'btn-editor-test', 'btn-editor-zoom-in', 'btn-editor-zoom-out', 'lbl-cost-title', 'lbl-budget-title', 'btn-editor-save', 'btn-editor-clear'];
for (const reqId of requiredEditorIds) {
  if (!editorIds.includes(reqId)) throw new Error(`Editor missing required control: ${reqId}`);
}

// Verify authentic Cost & Budget colors
const costTitle = editorControls.find(c => c.id === 'lbl-cost-title');
const budgetTitle = editorControls.find(c => c.id === 'lbl-budget-title');
const costVal = editorControls.find(c => c.id === 'lbl-cost-val');
const budgetVal = editorControls.find(c => c.id === 'lbl-budget-val');
const isWhite = (c) => c && c.color && c.color[0] === 1.0 && c.color[1] === 1.0 && c.color[2] === 1.0;
const isRed = (c) => c && c.color && c.color[0] === 1.0 && c.color[1] < 0.5;
if (!isWhite(costTitle) || !isWhite(budgetTitle)) {
  throw new Error('Cost and Budget titles must be white');
}
if (!isWhite(costVal) || !isWhite(budgetVal)) {
  throw new Error('Cost and Budget values must be white when under budget');
}

// Verify camera framing initial values
if (viewX !== 2048.0 || viewY !== 128.0 || zoom !== 5.0) {
  throw new Error(`Authentic camera framing mismatch: viewX=${viewX}, viewY=${viewY}, zoom=${zoom}`);
}
// Check coordinates from screenshot
const exitBtn = editorControls.find(c => c.id === 'btn-editor-exit');
const testBtn = editorControls.find(c => c.id === 'btn-editor-test');
const saveBtn = editorControls.find(c => c.id === 'btn-editor-save');
const clearBtn = editorControls.find(c => c.id === 'btn-editor-clear');
if (exitBtn.x !== 0 || exitBtn.y !== 0) throw new Error(`Exit at wrong pos: ${exitBtn.x}, ${exitBtn.y}`);
if (testBtn.x !== 576 || testBtn.y !== 0) throw new Error(`Test at wrong pos: ${testBtn.x}, ${testBtn.y}`);
if (saveBtn.x !== 320 || saveBtn.y !== 464) throw new Error(`Save at wrong pos: ${saveBtn.x}, ${saveBtn.y}`);
if (clearBtn.x !== 560 || clearBtn.y !== 464) throw new Error(`Clear at wrong pos: ${clearBtn.x}, ${clearBtn.y}`);
console.log('Test 4 Passed: Editor controls and layout verified.');

console.log('=== TEST 5: Test Bridge & Simulation Mode ===');
dispatch('test');
if (currentScreen !== 'simulation') throw new Error(`Expected 'simulation', got '${currentScreen}'`);
const simControls = getControls('simulation');
const simIds = simControls.map(c => c.id);
console.log('Simulation control IDs:', simIds);
const requiredSimIds = ['btn-sim-edit', 'btn-sim-slow', 'btn-sim-pause', 'btn-sim-train', 'btn-sim-zoom-in', 'btn-sim-zoom-out', 'btn-sim-stress'];
for (const reqId of requiredSimIds) {
  if (!simIds.includes(reqId)) throw new Error(`Simulation missing required control: ${reqId}`);
}
// Check coordinates
const simEdit = simControls.find(c => c.id === 'btn-sim-edit');
const simSlow = simControls.find(c => c.id === 'btn-sim-slow');
const simPause = simControls.find(c => c.id === 'btn-sim-pause');
const simTrain = simControls.find(c => c.id === 'btn-sim-train');
const simStress = simControls.find(c => c.id === 'btn-sim-stress');
if (simEdit.x !== 0 || simEdit.y !== 0) throw new Error(`Sim Edit pos wrong: ${simEdit.x}, ${simEdit.y}`);
if (simSlow.x !== 160 || simSlow.y !== 0) throw new Error(`Sim Slow pos wrong: ${simSlow.x}, ${simSlow.y}`);
if (simPause.x !== 320 || simPause.y !== 0) throw new Error(`Sim Pause pos wrong: ${simPause.x}, ${simPause.y}`);
if (simTrain.x !== 496 || simTrain.y !== 0) throw new Error(`Sim Train pos wrong: ${simTrain.x}, ${simTrain.y}`);
if (simStress.x !== 0 || simStress.y !== 464) throw new Error(`Sim Stress pos wrong: ${simStress.x}, ${simStress.y}`);
if (stressView !== false) throw new Error('stressView should be false by default in authentic mode');
if (simStress.active) throw new Error('Analyze stress button should be inactive by default');
console.log('Test 5 Passed: Simulation controls and layout verified.');

console.log('=== TEST 6: Slow Mode & Pause Mode ===');
dispatch('toggle-slow');
if (!isSlow) throw new Error('isSlow should be true');
let updatedSim = getControls('simulation');
let slowCtrl = updatedSim.find(c => c.id === 'btn-sim-slow');
if (!slowCtrl.active) throw new Error('Slow button should be active');

dispatch('toggle-pause');
if (!engine.paused) throw new Error('Engine should be paused');
updatedSim = getControls('simulation');
let pauseCtrl = updatedSim.find(c => c.id === 'btn-sim-pause');
if (!pauseCtrl.active) throw new Error('Pause button should be active');

dispatch('toggle-pause');
if (engine.paused) throw new Error('Engine should be unpaused');

dispatch('toggle-slow');
if (isSlow) throw new Error('isSlow should be false');
console.log('Test 6 Passed: Slow & Pause toggles verified.');

console.log('=== TEST 7: Edit restores pre-test design & resets Slow/Pause ===');
dispatch('toggle-slow');
dispatch('toggle-pause');
dispatch('edit');
if (currentScreen !== 'editor') throw new Error(`Expected 'editor', got '${currentScreen}'`);
if (isSlow) throw new Error('isSlow should be reset on returning to edit');
if (engine.paused) throw new Error('paused should be reset');
console.log('Test 7 Passed: Edit reset verified.');

console.log('=== TEST 8: Custom Bridge Import & Progression Isolation ===');
// Load 1stplace.brg (Level 11 contest winner)
const winnerB64 = window.BRIDGE_ASSETS.bridges['1stplace.brg'];
const winnerBuf = b64ToArrayBuffer(winnerB64);
const matched = identifyLevelForBridge(winnerBuf);
console.log('1stplace.brg matched level:', matched);
if (matched !== 'level11.lvl') throw new Error(`Expected level11.lvl, got ${matched}`);

// Now test a fake custom bridge that does NOT match any level
const customBuf = winnerBuf.slice(0);
// Corrupt the header so it cannot match
new Uint8Array(customBuf, 20, 10).fill(99);
const unmatched = identifyLevelForBridge(customBuf);
if (unmatched !== null) throw new Error(`Expected null matched level, got ${unmatched}`);
console.log('Test 8 Passed: Level matching & custom identification verified.');

console.log('=== TEST 9: [P1] Menu clicks & camera input restricted to gameplay ===');
navigate('home');
const initialViewX = viewX;
const initialZoom = zoom;
let editorClickCalled = false;
const origEditorClick = engine.editorClick.bind(engine);
engine.editorClick = (x, y) => {
  editorClickCalled = true;
  return origEditorClick(x, y);
};

// Pointer down on canvas while in 'home'
const glCanvasEl = mockElements.get('webgl-viewport');
if (glCanvasEl._listeners.pointerdown) {
  for (const fn of glCanvasEl._listeners.pointerdown) {
    fn({ button: 0, isPrimary: true, clientX: 300, clientY: 200, preventDefault: () => {} });
  }
}
if (editorClickCalled) throw new Error('[P1 Error] editorClick was called on home screen!');

// Wheel on canvas while in 'home'
if (glCanvasEl._listeners.wheel) {
  for (const fn of glCanvasEl._listeners.wheel) {
    fn({ deltaY: -100, preventDefault: () => {} });
  }
}
if (zoom !== initialZoom) throw new Error('[P1 Error] zoom changed on home screen!');

// Navigate to 'levels' and test
navigate('levels');
if (glCanvasEl._listeners.pointerdown) {
  for (const fn of glCanvasEl._listeners.pointerdown) {
    fn({ button: 0, isPrimary: true, clientX: 300, clientY: 200, preventDefault: () => {} });
  }
}
if (editorClickCalled) throw new Error('[P1 Error] editorClick was called on levels screen!');

// Navigate to 'editor' and verify editing DOES work
navigate('editor');
if (glCanvasEl._listeners.pointerdown) {
  for (const fn of glCanvasEl._listeners.pointerdown) {
    fn({ button: 0, isPrimary: true, clientX: 300, clientY: 200, preventDefault: () => {} });
  }
}
if (!editorClickCalled) throw new Error('editorClick should be called in editor!');
console.log('Test 9 Passed: Non-gameplay screens completely ignore editor and camera inputs.');

console.log('=== TEST 10: [P2] Completion buttons on replay and Level 15 ===');
loadLevelByName('level01.lvl');
dispatch('test');

// Mock levelPassed getter on engine
let mockPassed = true;
Object.defineProperty(engine, 'levelPassed', {
  get: () => mockPassed,
  configurable: true
});

// Run one frame step in simulation
frame(100);
frame(200);

const controlsContainer = mockElements.get('accessible-controls');
let nextLevelBtn = controlsContainer.children.find(c => c.id === 'btn-next-level');
if (!nextLevelBtn) throw new Error('[P2 Error] Next Level button not found on first completion!');

// Now test REPLAY of completed level 1
mockPassed = false;
dispatch('edit');
// In editor, next level button should NOT be in controlsContainer
if (controlsContainer.children.some(c => c.id === 'btn-next-level')) {
  throw new Error('Next Level button remained in controlsContainer after returning to edit!');
}
dispatch('test');
// Level 1 is already in gameProgress.completedLevels
if (!gameProgress.completedLevels.includes('level01.lvl')) throw new Error('Level 1 should be in completedLevels');
// Before bridge passes on replay, verify Next Level button is NOT present
if (controlsContainer.children.some(c => c.id === 'btn-next-level')) {
  throw new Error('Next Level button present before bridge crosses on replay!');
}

mockPassed = true;
frame(300);
frame(400);

nextLevelBtn = controlsContainer.children.find(c => c.id === 'btn-next-level');
if (!nextLevelBtn) throw new Error('[P2 Error] Next Level button missing on REPLAY of completed level!');
console.log('Next Level button present on replay!');

// Test Level 15 victory buttons
mockPassed = false;
loadLevelByName('level15.lvl');
dispatch('test');
if (controlsContainer.children.some(c => c.id === 'btn-victory-exit' || c.id === 'btn-victory-inspect')) {
  throw new Error('Victory buttons present before level 15 pass!');
}
mockPassed = true;
frame(500);
frame(600);

const exitGameBtn = controlsContainer.children.find(c => c.id === 'btn-victory-exit');
if (!exitGameBtn) throw new Error('[P2 Error] Exit Game button missing on Level 15 completion!');
if (controlsContainer.children.some(c => c.id === 'btn-victory-inspect')) {
  throw new Error('btn-victory-inspect should be removed in authentic recreation');
}

// Replay Level 15
mockPassed = false;
dispatch('edit');
if (controlsContainer.children.some(c => c.id === 'btn-victory-exit')) {
  throw new Error('Victory buttons remained in controlsContainer on edit!');
}
dispatch('test');
if (controlsContainer.children.some(c => c.id === 'btn-victory-exit')) {
  throw new Error('Victory buttons present before level 15 replay pass!');
}
mockPassed = true;
frame(700);
frame(800);

const exitGameBtnReplay = controlsContainer.children.find(c => c.id === 'btn-victory-exit');
if (!exitGameBtnReplay) throw new Error('[P2 Error] Victory button missing on Level 15 REPLAY!');
console.log('Test 10 Passed: Completion and victory buttons work on both initial pass and replay.');

console.log('=== TEST 11: [P2] Victory Exit with storage failure ===');
// We are currently in simulation on Level 15 with victory displayed
if (currentScreen !== 'simulation') throw new Error(`Expected currentScreen 'simulation', got '${currentScreen}'`);
if (!engine.simulationActive) throw new Error('Simulation should be active before exit test');

// Simulate localStorage failure
const origSetItem = localStorage.setItem;
localStorage.setItem = () => { throw new Error('QuotaExceededError'); };

const dialogContainer = document.getElementById('html-dialog-container');
const dialogTitle = document.getElementById('html-dialog-title');
const dialogActions = document.getElementById('html-dialog-actions');

dispatch('exit-to-home');
if (dialogContainer.style.display !== 'flex') throw new Error('[P2 Error] Storage failure dialog was not shown on exit-to-home!');
if (!dialogTitle.textContent.includes('Storage Unavailable')) throw new Error(`Unexpected dialog title: ${dialogTitle.textContent}`);
console.log('Dialog actions:', dialogActions.children.map(c => c.textContent));
const actionLabels = dialogActions.children.map(c => c.textContent);
if (!actionLabels.includes('Save .brg') || !actionLabels.includes('Leave Anyway') || !actionLabels.includes('Cancel')) {
  throw new Error('[P2 Error] Dialog missing expected actions');
}

// Verify simulation remains active while dialog is shown (deferred reset)
if (!engine.simulationActive) throw new Error('[P2 Error] Simulation was stopped prematurely before confirming exit!');
if (currentScreen !== 'simulation') throw new Error(`Screen should still be simulation, got '${currentScreen}'`);

// Test 'Save .brg' action from simulation dialog
let exportCalled = false;
const origExport = engine.exportBridgeBinary.bind(engine);
engine.exportBridgeBinary = () => {
  exportCalled = true;
  return origExport();
};
const saveBrgBtn = dialogActions.children.find(c => c.textContent === 'Save .brg');
saveBrgBtn.click();
if (!exportCalled) throw new Error('[P2 Error] "Save .brg" did nothing after victory Exit (exportBridgeBinary not called)!');
engine.exportBridgeBinary = origExport;

// Simulation must still be active after saving
if (!engine.simulationActive) throw new Error('Simulation should remain active after Save .brg');
if (currentScreen !== 'simulation') throw new Error('Screen changed after Save .brg');

// Click Cancel: verify stayed on simulation screen, dialog closed, simulation STILL ACTIVE
const cancelBtn = dialogActions.children.find(c => c.textContent === 'Cancel');
cancelBtn.click();
if (dialogContainer.style.display !== 'none') throw new Error('Dialog did not close on cancel');
if (currentScreen !== 'simulation') throw new Error(`Expected currentScreen 'simulation' after cancel, got '${currentScreen}'`);
if (!engine.simulationActive) throw new Error('[P2 Error] Cancel left simulation screen with stopped engine (simulationActive is 0)!');

// Now click exit again and Leave Anyway:
dispatch('exit-to-home');
if (dialogContainer.style.display !== 'flex') throw new Error('Dialog did not open on second exit-to-home');
const leaveBtn = dialogActions.children.find(c => c.textContent === 'Leave Anyway');
leaveBtn.click();
if (dialogContainer.style.display !== 'none') throw new Error('Dialog did not close on Leave Anyway');
if (currentScreen !== 'home') throw new Error('Leave Anyway should return home');
if (engine.simulationActive) throw new Error('Simulation should be stopped after Leave Anyway returns home');
console.log('Test 11 Passed: Victory exit properly prompts on storage failure, exports in simulation, and Cancel preserves running engine.');

// Restore localStorage
localStorage.setItem = origSetItem;

console.log('=== TEST 12: [P2] Victory message wrapping within 640 viewport ===');
const simControlsLvl15 = getControls('simulation');
const victoryLabels = simControlsLvl15.filter(c => c.id && c.id.startsWith('lbl-victory-'));
console.log(`Found ${victoryLabels.length} victory text lines:`);
let maxLineY = 0;
for (const line of victoryLabels) {
  const width = line.text.length * line.advance;
  const left = 320 - width / 2;
  const right = 320 + width / 2;
  console.log(`Line: [${left}, ${right}] (${width}px) "${line.text}"`);
  if (left < 0 || right > 640) {
    throw new Error(`[P2 Error] Victory line overflows 640px viewport: [${left}, ${right}] "${line.text}"`);
  }
  maxLineY = Math.max(maxLineY, line.y + line.size);
}
const exitControl = simControlsLvl15.find(c => c.id === 'btn-victory-exit');
if (exitControl.y < maxLineY) {
  throw new Error(`[P2 Error] Exit Game (${exitControl.y}) is not below victory text (${maxLineY})!`);
}
if (exitControl.align !== 'center') {
  throw new Error('Exit Game button should be centered');
}
console.log('Test 12 Passed: Victory text fits inside 640px viewport and buttons are placed below.');

console.log('=== TEST 13: Simulation Timing & Bit-for-Bit Physics Equality (Normal vs Slow) ===');
Object.defineProperty(engine, 'levelPassed', {
  get: function() { return this.wasm.isLevelPassed(); },
  configurable: true
});
loadLevelByName('level01.lvl');
navigate('editor');

// Build a real moving structural joint (non-anchor) connected by beams to anchors
// Node 0 is anchor at (2032, 128), Node 2 is anchor at (2032, 124)
engine.editorClick(2032, 128); // select anchor 0
engine.editorClick(2040, 124); // add structural node 4 at (2040, 124) and beam from 0 to 4
engine.editorClick(2040, 124); // select node 4
engine.editorClick(2032, 124); // add beam from 4 to anchor 2

if (engine.nodes.length !== 5) throw new Error(`Expected 5 nodes, got ${engine.nodes.length}`);
if (engine.nodes[4].type !== 1) throw new Error(`Expected node 4 to be structural joint (type 1), got ${engine.nodes[4].type}`);
const initialNode4Y = engine.nodes[4].y;

function advanceSteps(numSteps, isSlowMode = false) {
  const stepInterval = 1000 / 30;
  const frameDt = stepInterval / (isSlowMode ? 0.25 : 1.0);
  let t = (previousFrameTime !== null ? previousFrameTime : 0);
  for (let i = 0; i < numSteps; i++) {
    t += frameDt;
    frame(t);
  }
}

// Prime the frame timer
dispatch('test');
frame(0);

// Run 30 steps at normal speed (1000ms wall-clock)
isSlow = false;
simulationTime = 0;
let normalSteps = 0;
const origStep = engine.step.bind(engine);
engine.step = () => { normalSteps++; origStep(); };

advanceSteps(30, false);
console.log('Normal speed steps in 1000ms:', normalSteps);
if (normalSteps !== 30) throw new Error(`Expected 30 normal steps in 1000ms, got ${normalSteps}`);

// Snapshot state of all nodes after 30 normal steps
const normalNodes = [];
for (let i = 0; i < engine.nodes.length; i++) {
  normalNodes.push({
    x: engine.wasm.getNodeX(i),
    y: engine.wasm.getNodeY(i),
    vx: engine.wasm.getNodeVX(i),
    vy: engine.wasm.getNodeVY(i)
  });
}
console.log('Moving Node 4 after 30 normal steps:', normalNodes[4]);
// Verify node 4 actually moved under gravity and has non-zero velocity
if (normalNodes[4].y === initialNode4Y || normalNodes[4].vy === 0) {
  throw new Error(`Node 4 did not move under gravity! y: ${normalNodes[4].y}, initial: ${initialNode4Y}, vy: ${normalNodes[4].vy}`);
}

// Reset simulation to pre-test design
dispatch('edit');
dispatch('test');
frame(0);

// Test wall-clock slowdown factor: in 1000ms of wall-clock time at 0.25x speed,
// exactly 7 or 8 discrete physics steps should execute.
isSlow = true;
simulationTime = 0;
let slowSteps = 0;
engine.step = () => { slowSteps++; origStep(); };

let t = 0;
for (let i = 0; i < 30; i++) {
  t += 1000 / 30;
  frame(t);
}
console.log('Slow speed steps in 1000ms wall-clock:', slowSteps);
if (slowSteps < 7 || slowSteps > 8) throw new Error(`Expected 7 or 8 steps in 1000ms at 0.25x speed, got ${slowSteps}`);

// Reset slow test to run full 30 discrete steps
dispatch('edit');
dispatch('test');
frame(0);
isSlow = true;
simulationTime = 0;
let slowStepsFull = 0;
engine.step = () => { slowStepsFull++; origStep(); };

// Advance 30 steps in slow mode (takes 4000ms wall-clock)
advanceSteps(30, true);
console.log('Slow speed steps for 30 ticks (4000ms wall-clock):', slowStepsFull);
if (slowStepsFull !== 30) throw new Error(`Expected 30 slow steps in 4000ms, got ${slowStepsFull}`);

// Snapshot state of all nodes after 30 slow steps
const slowNodes = [];
for (let i = 0; i < engine.nodes.length; i++) {
  slowNodes.push({
    x: engine.wasm.getNodeX(i),
    y: engine.wasm.getNodeY(i),
    vx: engine.wasm.getNodeVX(i),
    vy: engine.wasm.getNodeVY(i)
  });
}
console.log('Moving Node 4 after 30 slow steps:', slowNodes[4]);

// Strict bit-for-bit comparison across all nodes
for (let i = 0; i < normalNodes.length; i++) {
  const n = normalNodes[i];
  const s = slowNodes[i];
  if (n.x !== s.x) {
    throw new Error(`Node ${i} X mismatch: normal ${n.x} !== slow ${s.x} (diff: ${n.x - s.x})`);
  }
  if (n.y !== s.y) {
    throw new Error(`Node ${i} Y mismatch: normal ${n.y} !== slow ${s.y} (diff: ${n.y - s.y})`);
  }
  if (n.vx !== s.vx) {
    throw new Error(`Node ${i} VX mismatch: normal ${n.vx} !== slow ${s.vx} (diff: ${n.vx - s.vx})`);
  }
  if (n.vy !== s.vy) {
    throw new Error(`Node ${i} VY mismatch: normal ${n.vy} !== slow ${s.vy} (diff: ${n.vy - s.vy})`);
  }
}

console.log('Bit-for-bit equality verified for all 5 nodes (positions and velocities match identically)!');
console.log('Test 13 Passed: Slow mode runs at exactly 0.25x wall-clock speed with bit-for-bit identical discrete physics.');

console.log('=== TEST 14: Keyboard Shortcut Mappings & Screen Restrictions ===');
// Start on Home
navigate('home');
if (currentScreen !== 'home') throw new Error(`Expected currentScreen 'home', got '${currentScreen}'`);

// Check accessible button attributes on Home
const accessibleEl = mockElements.get('accessible-controls');
const btnStart = accessibleEl.children.find(c => c.id === 'btn-start-game');
const btnLoad = accessibleEl.children.find(c => c.id === 'btn-load-bridge');
const btnReadme = accessibleEl.children.find(c => c.id === 'btn-readme');
const btnExit = accessibleEl.children.find(c => c.id === 'btn-home-exit');
if (!btnStart || btnStart.getAttribute('aria-keyshortcuts') !== 'S') throw new Error('Start Game missing aria-keyshortcuts="S"');
if (!btnLoad || btnLoad.getAttribute('aria-keyshortcuts') !== 'L') throw new Error('Load Bridge missing aria-keyshortcuts="L"');
if (!btnReadme || btnReadme.getAttribute('aria-keyshortcuts') !== 'R') throw new Error('Readme missing aria-keyshortcuts="R"');
if (!btnExit || btnExit.getAttribute('aria-keyshortcuts') !== 'E') throw new Error('Exit missing aria-keyshortcuts="E"');
if (btnStart.getAttribute('aria-label') !== 'Start Game') throw new Error('Start Game aria-label wrong');
if (btnLoad.getAttribute('aria-label') !== 'Load Bridge') throw new Error('Load Bridge aria-label wrong');
if (btnReadme.getAttribute('aria-label') !== 'Readme') throw new Error('Readme aria-label wrong');
if (btnExit.getAttribute('aria-label') !== 'Exit') throw new Error('Exit aria-label wrong');

// Clicking accessible Exit button navigates to GitHub repo
window.location.href = 'http://localhost';
btnExit.click();
if (window.location.href !== 'https://github.com/s--i/BridgeBuilderDemo') {
  throw new Error(`Clicking accessible Exit button should navigate to GitHub repo, got: ${window.location.href}`);
}

// Test 'S' on Home -> navigates to 'levels'
sendKeyDown({ key: 's' });
if (currentScreen !== 'levels') throw new Error(`Pressing 's' on Home did not navigate to levels, got '${currentScreen}'`);
// Escape returns home
sendKeyDown({ key: 'Escape' });
if (currentScreen !== 'home') throw new Error('Escape did not return to home from levels');

// Test Shift+S (uppercase) on Home -> navigates to 'levels'
sendKeyDown({ key: 'S', shiftKey: true });
if (currentScreen !== 'levels') throw new Error(`Pressing 'S' with Shift on Home did not navigate to levels, got '${currentScreen}'`);
sendKeyDown({ key: 'Escape' });

// Test 'R' on Home -> navigates to 'readme'
sendKeyDown({ key: 'r' });
if (currentScreen !== 'readme') throw new Error(`Pressing 'r' on Home did not navigate to readme, got '${currentScreen}'`);
sendKeyDown({ key: 'Escape' });
if (currentScreen !== 'home') throw new Error('Escape did not return to home from readme');

// Test 'L' on Home -> triggers fileImport.click()
let filePickerClicked = false;
const fileImportEl = mockElements.get('file-import');
const origFileClick = fileImportEl.click.bind(fileImportEl);
fileImportEl.click = () => { filePickerClicked = true; origFileClick(); };
sendKeyDown({ key: 'l' });
if (!filePickerClicked) throw new Error("Pressing 'l' on Home did not open file picker!");
fileImportEl.click = origFileClick;
if (currentScreen !== 'home') throw new Error("Pressing 'l' should stay on home screen");

// Test screen restrictions on Home: T, P, A should do nothing on Home
sendKeyDown({ key: 't' });
if (currentScreen !== 'home') throw new Error("Pressing 't' on Home should not do anything");
sendKeyDown({ key: 'p' });
if (engine.paused) throw new Error("Pressing 'p' on Home should not toggle pause");
const initialStress = stressView;
sendKeyDown({ key: 'a' });
if (stressView !== initialStress) throw new Error("Pressing 'a' on Home should not toggle stressView");
console.log('Home shortcuts & restrictions verified.');

// Navigate to Editor
loadLevelByName('level01.lvl');
navigate('editor');
if (currentScreen !== 'editor') throw new Error(`Expected editor, got ${currentScreen}`);

const btnTest = accessibleEl.children.find(c => c.id === 'btn-editor-test');
if (!btnTest || btnTest.getAttribute('aria-keyshortcuts') !== 'T') throw new Error('Test button missing aria-keyshortcuts="T"');
if (btnTest.getAttribute('aria-label') !== 'Test') throw new Error('Test button aria-label wrong');

// Test screen restrictions on Editor: S, P, A should do nothing on Editor
isSlow = false;
sendKeyDown({ key: 's' });
if (isSlow) throw new Error("Pressing 's' on Editor should not toggle isSlow");
if (currentScreen !== 'editor') throw new Error("Pressing 's' on Editor should not leave editor");
sendKeyDown({ key: 'p' });
if (engine.paused) throw new Error("Pressing 'p' on Editor should not toggle pause");
sendKeyDown({ key: 'a' });
if (stressView !== initialStress) throw new Error("Pressing 'a' on Editor should not toggle stressView");

// Test 'T' on Editor -> starts simulation
sendKeyDown({ key: 't' });
if (currentScreen !== 'simulation') throw new Error(`Pressing 't' on Editor should navigate to simulation, got '${currentScreen}'`);
if (!engine.simulationActive) throw new Error('Simulation should be active after pressing T');
console.log('Editor shortcuts & restrictions verified.');

// Simulation Screen shortcuts
const btnSlow = accessibleEl.children.find(c => c.id === 'btn-sim-slow');
const btnPause = accessibleEl.children.find(c => c.id === 'btn-sim-pause');
const btnTrain = accessibleEl.children.find(c => c.id === 'btn-sim-train');
const btnStress = accessibleEl.children.find(c => c.id === 'btn-sim-stress');
if (!btnSlow || btnSlow.getAttribute('aria-keyshortcuts') !== 'S') throw new Error('Slow missing aria-keyshortcuts="S"');
if (!btnPause || btnPause.getAttribute('aria-keyshortcuts') !== 'P') throw new Error('Pause missing aria-keyshortcuts="P"');
if (!btnTrain || btnTrain.getAttribute('aria-keyshortcuts') !== 'T') throw new Error('Run Train missing aria-keyshortcuts="T"');
if (!btnStress || btnStress.getAttribute('aria-keyshortcuts') !== 'A') throw new Error('Analyze Stress missing aria-keyshortcuts="A"');

// Test 'S' toggles slow motion
if (isSlow) throw new Error('isSlow should be false initially');
sendKeyDown({ key: 's' });
if (!isSlow) throw new Error("Pressing 's' in simulation should toggle isSlow to true");
sendKeyDown({ key: 'S', shiftKey: true });
if (isSlow) throw new Error("Pressing 'S' in simulation should toggle isSlow to false");

// Test 'P' toggles pause
if (engine.paused) throw new Error('paused should be false initially');
sendKeyDown({ key: 'p' });
if (!engine.paused) throw new Error("Pressing 'p' in simulation should pause engine");
sendKeyDown({ key: 'P' });
if (engine.paused) throw new Error("Pressing 'P' in simulation should unpause engine");

// Test 'A' toggles stressView
const prevStress = stressView;
sendKeyDown({ key: 'a' });
if (stressView === prevStress) throw new Error("Pressing 'a' in simulation should toggle stressView");
sendKeyDown({ key: 'A', shiftKey: true });
if (stressView !== prevStress) throw new Error("Pressing 'A' in simulation should toggle stressView back");

// Test screen restrictions on Simulation: L and R should do nothing
let simFileClicked = false;
fileImportEl.click = () => { simFileClicked = true; };
sendKeyDown({ key: 'l' });
if (simFileClicked) throw new Error("Pressing 'l' in simulation should not open file picker");
sendKeyDown({ key: 'r' });
if (currentScreen !== 'simulation') throw new Error("Pressing 'r' in simulation should not leave simulation");

// Test 'T' dispatches train
if (engine.trainActive) throw new Error('Train should not be active initially');
sendKeyDown({ key: 't' });
if (!engine.trainActive) throw new Error("Pressing 't' in simulation should dispatch train");

// Test one-time dispatch: button disappears and subsequent T presses do nothing
const simControlsAfterTrain = getControls('simulation');
if (simControlsAfterTrain.some(c => c.id === 'btn-sim-train')) {
  throw new Error('Run Train button should disappear after train is dispatched');
}
sendKeyDown({ key: 't' });
if (!engine.trainActive) throw new Error('Train should remain active');
console.log('Test 14 Passed: All shortcut mappings, screen restrictions, and one-time dispatch verified.');

console.log('=== TEST 15: Holding T Repeat Suppression & Transition Isolation ===');
// Return to editor
dispatch('edit');
if (currentScreen !== 'editor') throw new Error(`Expected editor, got ${currentScreen}`);
if (engine.simulationActive) throw new Error('Simulation should be inactive in editor');

// Press T once with repeat: false -> starts test
sendKeyDown({ key: 't', repeat: false });
if (currentScreen !== 'simulation') throw new Error(`Expected simulation, got ${currentScreen}`);
if (!engine.simulationActive) throw new Error('Simulation should be active');
if (engine.trainActive) throw new Error('Train should NOT be active upon entering simulation');

// Simulate holding T down by sending repeated keydowns with repeat: true
sendKeyDown({ key: 't', repeat: true });
sendKeyDown({ key: 't', repeat: true });
sendKeyDown({ key: 't', repeat: true });
if (engine.trainActive) throw new Error('[Holding T Error] Repeated T keydown dispatched the train while holding T!');

// Now release and press T again with repeat: false -> dispatches train
sendKeyDown({ key: 't', repeat: false });
if (!engine.trainActive) throw new Error('Train should be dispatched on fresh T keydown');
console.log('Test 15 Passed: Holding T starts testing only once and repeat suppression prevents premature train dispatch.');

console.log('=== TEST 16: Modifier, Editable-Field, and Dialog Guards ===');
navigate('home');
// Modifiers: Ctrl+S, Cmd+S, Alt+S should NOT trigger Start Game
sendKeyDown({ key: 's', ctrlKey: true });
if (currentScreen !== 'home') throw new Error('Ctrl+S should be ignored');
sendKeyDown({ key: 's', metaKey: true });
if (currentScreen !== 'home') throw new Error('Cmd+S should be ignored');
sendKeyDown({ key: 's', altKey: true });
if (currentScreen !== 'home') throw new Error('Alt+S should be ignored');
sendKeyDown({ key: 's', isComposing: true });
if (currentScreen !== 'home') throw new Error('Composition keydown should be ignored');

// Modified Escape: Ctrl+Escape, Cmd+Escape, Alt+Escape must be ignored and not call preventDefault
navigate('readme');
const ctrlEscEvt = sendKeyDown({ key: 'Escape', ctrlKey: true });
if (ctrlEscEvt.defaultPrevented) throw new Error('Ctrl+Escape should NOT call preventDefault()');
if (currentScreen !== 'readme') throw new Error('Ctrl+Escape should NOT navigate away from readme');

const metaEscEvt = sendKeyDown({ key: 'Escape', metaKey: true });
if (metaEscEvt.defaultPrevented) throw new Error('Cmd+Escape should NOT call preventDefault()');
if (currentScreen !== 'readme') throw new Error('Cmd+Escape should NOT navigate away from readme');

const altEscEvt = sendKeyDown({ key: 'Escape', altKey: true });
if (altEscEvt.defaultPrevented) throw new Error('Alt+Escape should NOT call preventDefault()');
if (currentScreen !== 'readme') throw new Error('Alt+Escape should NOT navigate away from readme');

// Modified Escape in editor: should not clear selection
loadLevelByName('level01.lvl');
navigate('editor');
engine.editorClick(2032, 128);
if (engine.editorSelection < 0) throw new Error('Failed selecting node');
const ctrlEscEdEvt = sendKeyDown({ key: 'Escape', ctrlKey: true });
if (ctrlEscEdEvt.defaultPrevented) throw new Error('Ctrl+Escape in editor should NOT call preventDefault()');
if (engine.editorSelection === -1) throw new Error('Ctrl+Escape in editor should NOT clear selection');

// Plain Escape in editor: cancels selection and calls preventDefault
const plainEscEdEvt = sendKeyDown({ key: 'Escape' });
if (!plainEscEdEvt.defaultPrevented) throw new Error('Plain Escape in editor should call preventDefault()');
if (engine.editorSelection !== -1) throw new Error('Plain Escape in editor should clear selection');

navigate('home');

// Editable fields: target in input, textarea, select, contentEditable
const mockInput = createElement('mock-input', 'INPUT');
sendKeyDown({ key: 's', target: mockInput });
if (currentScreen !== 'home') throw new Error('Keydown in <input> should be ignored');

const mockTextarea = createElement('mock-textarea', 'TEXTAREA');
sendKeyDown({ key: 's', target: mockTextarea });
if (currentScreen !== 'home') throw new Error('Keydown in <textarea> should be ignored');

const mockSelect = createElement('mock-select', 'SELECT');
sendKeyDown({ key: 's', target: mockSelect });
if (currentScreen !== 'home') throw new Error('Keydown in <select> should be ignored');

const mockEditable = createElement('mock-editable', 'DIV');
mockEditable.isContentEditable = true;
sendKeyDown({ key: 's', target: mockEditable });
if (currentScreen !== 'home') throw new Error('Keydown in contentEditable should be ignored');

// Dialog guard
showHtmlDialog({ title: 'Test Dialog', message: 'Testing dialog guard', actions: [] });
if (!isDialogOpen()) throw new Error('Dialog should be open');
sendKeyDown({ key: 's' });
if (currentScreen !== 'home') throw new Error('Shortcuts should be disabled when dialog is open');
sendKeyDown({ key: 'Escape' });
if (currentScreen !== 'home') throw new Error('Escape should not navigate when dialog is open');
hideHtmlDialog();
console.log('Test 16 Passed: Modifier, editable-field, and dialog guards verified.');

console.log('=== TEST 17: Button Focus & Space/Enter/Zoom/Escape Behavior ===');
navigate('editor');
// Button focus: when a button element is focused, Enter and Space are left to native button activation
const testBtnEl = createElement('test-btn', 'BUTTON');
document.activeElement = testBtnEl;

const spaceEvt = sendKeyDown({ key: ' ', code: 'Space' });
if (spaceEvt.defaultPrevented) throw new Error('Space with focused button should NOT call preventDefault()');
if (currentScreen !== 'editor') throw new Error('Space with focused button should NOT trigger game action');

const enterEvt = sendKeyDown({ key: 'Enter', code: 'Enter' });
if (enterEvt.defaultPrevented) throw new Error('Enter with focused button should NOT call preventDefault()');

// Clear focus
document.activeElement = null;

// Space alias without focus in editor -> triggers test
const spaceEditorEvt = sendKeyDown({ key: ' ', code: 'Space' });
if (!spaceEditorEvt.defaultPrevented) throw new Error('Space in editor should call preventDefault()');
if (currentScreen !== 'simulation') throw new Error('Space in editor should start test');

// Space alias in simulation -> dispatches train
if (engine.trainActive) throw new Error('Train should not be active yet');
const spaceSimEvt = sendKeyDown({ key: ' ', code: 'Space' });
if (!spaceSimEvt.defaultPrevented) throw new Error('Space in simulation should call preventDefault()');
if (!engine.trainActive) throw new Error('Space in simulation should dispatch train');

// Zoom behavior in editor
dispatch('edit');
centerCamera();
const initialZoomVal = zoom;
if (initialZoomVal !== 5.0) throw new Error(`Expected initial zoom 5.0, got ${initialZoomVal}`);
sendKeyDown({ key: 'z' });
const expectedZoomIn = 320.0 / 63.0; // ~5.079365
if (Math.abs(zoom - expectedZoomIn) > 0.001) {
  throw new Error(`Pressing 'z' should zoom from 5.0 to ~5.079, got ${zoom}`);
}
sendKeyUp({ key: 'z' });

const zoomedInVal = zoom;
sendKeyDown({ key: 'Z', shiftKey: true });
if (Math.abs(zoom - 5.0) > 0.001) {
  throw new Error(`Pressing 'Shift+Z' should zoom out from ~5.079 back to 5.0, got ${zoom}`);
}
sendKeyUp({ key: 'z' });
sendKeyUp({ key: 'Shift' });

// Escape behavior
// 1. Editor selection cancel
engine.editorClick(2032, 128);
if (engine.editorSelection < 0) throw new Error('Joint selection failed');
sendKeyDown({ key: 'Escape' });
if (engine.editorSelection !== -1) throw new Error('Escape in editor did not clear selection');

// 2. Readme Escape -> home
navigate('readme');
sendKeyDown({ key: 'Escape' });
if (currentScreen !== 'home') throw new Error('Escape in readme did not return home');

// 3. Levels Escape -> home
navigate('levels');
sendKeyDown({ key: 'Escape' });
if (currentScreen !== 'home') throw new Error('Escape in levels did not return home');
console.log('Test 17 Passed: Button focus and Space/Enter/Zoom/Escape behaviors verified.');

console.log('=== TEST 18: Real WebGLRenderer Mnemonic Vertex Color Inspection ===');
// Load real WebGLRenderer from web/webgl_renderer.js
const realRendererScope = {
  window: {},
  Float32Array,
  Uint8Array,
  atob: global.atob,
  Math
};
vm.runInNewContext(fs.readFileSync('web/webgl_renderer.js', 'utf8'), realRendererScope);
const RealWebGLRenderer = realRendererScope.window.WebGLRenderer;

const mockGl = {
  createShader: () => ({}),
  shaderSource: () => {},
  compileShader: () => {},
  getShaderParameter: () => true,
  getShaderInfoLog: () => '',
  createProgram: () => ({}),
  attachShader: () => {},
  linkProgram: () => {},
  getProgramParameter: () => true,
  getProgramInfoLog: () => '',
  useProgram: () => {},
  getAttribLocation: (p, name) => 1,
  getUniformLocation: (p, name) => ({}),
  uniform1i: () => {},
  createBuffer: () => ({}),
  bindBuffer: () => {},
  bufferData: () => {},
  bufferSubData: () => {},
  enableVertexAttribArray: () => {},
  disableVertexAttribArray: () => {},
  vertexAttribPointer: () => {},
  createTexture: () => ({}),
  bindTexture: () => {},
  activeTexture: () => {},
  pixelStorei: () => {},
  texImage2D: () => {},
  texParameteri: () => {},
  blendFunc: () => {},
  enable: () => {},
  disable: () => {},
  viewport: () => {},
  clearColor: () => {},
  clear: () => {},
  drawArrays: () => {},
  RGBA: 6408,
  UNSIGNED_BYTE: 5121,
  TEXTURE_2D: 3553,
  TEXTURE0: 33984,
  ARRAY_BUFFER: 34962,
  DYNAMIC_DRAW: 35048,
  STATIC_DRAW: 35044,
  FLOAT: 5126,
  TRIANGLES: 4,
  LINES: 1,
  SRC_ALPHA: 770,
  ONE_MINUS_SRC_ALPHA: 771,
  BLEND: 3042,
  TEXTURE_MIN_FILTER: 10241,
  TEXTURE_MAG_FILTER: 10240,
  LINEAR: 9729,
  TEXTURE_WRAP_S: 10242,
  TEXTURE_WRAP_T: 10243,
  CLAMP_TO_EDGE: 33071,
  UNPACK_ALIGNMENT: 3317
};

const mockCanvas = {
  width: 640,
  height: 480,
  getContext: (type) => mockGl
};

// Set window.BRIDGE_FONT in realRendererScope
realRendererScope.window.BRIDGE_FONT = window.BRIDGE_FONT;
const renderer = new RealWebGLRenderer(mockCanvas);

function verifyControlMnemonic(ctrl, expectedMnemonicChar, expectedMnemonicIdx) {
  renderer.renderText([ctrl]);
  const v = renderer.textVertexData;
  const text = ctrl.text;
  for (let i = 0; i < text.length; i++) {
    // 6 vertices per char; check vertex 0 color at offset i * 48 + 4..6
    const r = v[i * 48 + 4];
    const g = v[i * 48 + 5];
    const b = v[i * 48 + 6];

    if (i === expectedMnemonicIdx) {
      if (Math.abs(r - 1.0) > 1e-4 || Math.abs(g - 1.0) > 1e-4 || Math.abs(b - 1.0) > 1e-4) {
        throw new Error(`Mnemonic char '${text[i]}' (index ${i}) of "${text}" is not white! Got (${r}, ${g}, ${b})`);
      }
    } else {
      if (Math.abs(r - 0.63) > 0.05 || Math.abs(g - 0.63) > 0.05 || Math.abs(b - 0.63) > 0.05) {
        throw new Error(`Non-mnemonic char '${text[i]}' (index ${i}) of "${text}" is not grey! Got (${r}, ${g}, ${b})`);
      }
    }
  }
}

// 1. Home controls
navigate('home');
const homeCtrls = getControls('home');
const ctrlStart = homeCtrls.find(c => c.id === 'btn-start-game');
const ctrlLoad = homeCtrls.find(c => c.id === 'btn-load-bridge');
const ctrlReadme = homeCtrls.find(c => c.id === 'btn-readme');
const ctrlHomeExit = homeCtrls.find(c => c.id === 'btn-home-exit');
verifyControlMnemonic(ctrlStart, 'S', 0);
verifyControlMnemonic(ctrlLoad, 'L', 0);
verifyControlMnemonic(ctrlReadme, 'R', 0);
verifyControlMnemonic(ctrlHomeExit, 'E', 0);

// 2. Editor controls
loadLevelByName('level01.lvl');
navigate('editor');
const editorCtrls = getControls('editor');
const ctrlTest = editorCtrls.find(c => c.id === 'btn-editor-test');
verifyControlMnemonic(ctrlTest, 'T', 0);

// 3. Simulation controls
loadLevelByName('level01.lvl');
isSlow = false;
stressView = false;
dispatch('test');
const simCtrls = getControls('simulation');
const ctrlSlow = simCtrls.find(c => c.id === 'btn-sim-slow');
const ctrlPause = simCtrls.find(c => c.id === 'btn-sim-pause');
const ctrlTrain = simCtrls.find(c => c.id === 'btn-sim-train');
const ctrlStress = simCtrls.find(c => c.id === 'btn-sim-stress');
verifyControlMnemonic(ctrlSlow, 'S', 0);
verifyControlMnemonic(ctrlPause, 'P', 0);
verifyControlMnemonic(ctrlTrain, 'T', 4); // Run Train: index 4 is 'T'
verifyControlMnemonic(ctrlStress, 'A', 0);

// 4. Verify active toggle whole-label white highlighting (e.g. active stressView)
stressView = true;
const simCtrlsActive = getControls('simulation');
const activeStressCtrl = simCtrlsActive.find(c => c.id === 'btn-sim-stress');
renderer.renderText([activeStressCtrl]);
for (let i = 0; i < activeStressCtrl.text.length; i++) {
  const r = renderer.textVertexData[i * 48 + 4];
  if (Math.abs(r - 1.0) > 1e-4) {
    throw new Error(`Active toggle label char ${i} should be white!`);
  }
}
stressView = false;

// 5. Verify hovered / focused whole-label white highlighting
const hoveredCtrl = { ...ctrlTrain, color: [1.0, 1.0, 1.0, 1.0] };
renderer.renderText([hoveredCtrl]);
for (let i = 0; i < hoveredCtrl.text.length; i++) {
  const r = renderer.textVertexData[i * 48 + 4];
  if (Math.abs(r - 1.0) > 1e-4) {
    throw new Error(`Hovered label char ${i} should be white!`);
  }
}

// 5. Verify disabled label stays entirely dim
const disabledCtrl = { ...ctrlTrain, disabled: true, color: [0.32, 0.32, 0.32, 1.0] };
renderer.renderText([disabledCtrl]);
for (let i = 0; i < disabledCtrl.text.length; i++) {
  const r = renderer.textVertexData[i * 48 + 4];
  if (Math.abs(r - 0.32) > 0.05) {
    throw new Error(`Disabled label char ${i} should be dim (0.32), got ${r}!`);
  }
}
console.log('Test 18 Passed: Generated text vertex colors confirmed: only intended mnemonic glyph is white in normal state, whole-label white on hover, and dim when disabled.');

console.log('=== TEST 19: Editor preview follows pointer and camera without modifying the design ===');
loadLevelByName('level01.lvl', true);
navigate('editor');
engine.editorClick(2032, 128);
const pointerEvent = {
  clientX: 320 + (2040 - viewX) * zoom,
  clientY: 240 - (128 - viewY) * zoom,
  buttons: 0
};
for (const fn of glCanvasEl._listeners.pointermove) fn(pointerEvent);
if (getEditorVisuals()?.preview?.x !== 2040) throw new Error('Pointer did not reach Wasm preview');
const savedPreviewDesign = Buffer.from(engine.exportBridgeBinary());
zoom *= 2;
const cameraPreview = getEditorVisuals();
const expectedPoint = logicalToWorld(mouseLogicalX, mouseLogicalY);
if (cameraPreview?.preview?.x !== engine.editorSnap(expectedPoint.x) || cameraPreview.preview.x === 2040) {
  throw new Error('Stationary pointer preview did not follow zoom');
}
for (const fn of glCanvasEl._listeners.pointerleave) fn({});
if (getEditorVisuals() !== null) throw new Error('Preview remained after pointer left canvas');
if (!savedPreviewDesign.equals(Buffer.from(engine.exportBridgeBinary()))) throw new Error('Preview altered bridge');
if (engine.editorSelection !== 0) throw new Error('Leaving canvas cancelled source selection');
console.log('Test 19 Passed: Pointer leave hides preview, camera updates its endpoint, and selection/design are preserved.');

console.log('=== TEST 20: Authentic Fidelity Audit (Tick-gated scrolling, Zoom increments, Pure Red) ===');
loadLevelByName('level01.lvl', true);
navigate('editor');
centerCamera();

// 1. Verify Pure Red (1, 0, 0) on cost/budget warnings
const origGetCost = engine.getCost;
const isPureRed = (c) => c && c.color && c.color[0] === 1.0 && c.color[1] === 0.0 && c.color[2] === 0.0;
try {
  // Under budget: both white
  engine.getCost = () => engine.level.budget - 100;
  let ctrls = getControls('editor');
  let cVal = ctrls.find(c => c.id === 'lbl-cost-val');
  let bVal = ctrls.find(c => c.id === 'lbl-budget-val');
  if (!isWhite(cVal) || !isWhite(bVal)) {
    throw new Error('Both cost and budget values should be white when under budget');
  }

  // Exactly at budget: both pure red (1, 0, 0)
  engine.getCost = () => engine.level.budget;
  ctrls = getControls('editor');
  cVal = ctrls.find(c => c.id === 'lbl-cost-val');
  bVal = ctrls.find(c => c.id === 'lbl-budget-val');
  if (!isPureRed(cVal) || !isPureRed(bVal)) {
    throw new Error(`Both cost and budget must turn pure red (1, 0, 0) when cost == budget; got ${JSON.stringify(cVal.color)}`);
  }

  // Over budget: both pure red (1, 0, 0)
  engine.getCost = () => engine.level.budget + 500;
  ctrls = getControls('editor');
  cVal = ctrls.find(c => c.id === 'lbl-cost-val');
  bVal = ctrls.find(c => c.id === 'lbl-budget-val');
  if (!isPureRed(cVal) || !isPureRed(bVal)) {
    throw new Error(`Both cost and budget must be pure red (1, 0, 0) when over budget; got ${JSON.stringify(cVal.color)}`);
  }
} finally {
  engine.getCost = origGetCost;
}

// 2. Verify zoom increments (adjusting view half-width by 1 world unit)
centerCamera();
if (zoom !== 5.0) throw new Error(`Initial zoom must be 5.0, got ${zoom}`);
dispatch('zoom-in');
const expectedZIn = 320.0 / 63.0; // ~5.079365
if (Math.abs(zoom - expectedZIn) > 0.001) {
  throw new Error(`Zoom in should adjust halfW by 1.0 (from 64 to 63, zoom ~5.079), got ${zoom}`);
}
dispatch('zoom-out');
if (Math.abs(zoom - 5.0) > 0.001) {
  throw new Error(`Zoom out should return halfW to 64.0 (zoom 5.0), got ${zoom}`);
}

// 3. Verify held Z/Shift+Z tick-based repetition
centerCamera();
pointerOnCanvas = false;
let testTime = 10000;
frame(testTime); // prime the timer (elapsed = 0)
sendKeyDown({ key: 'z' }); // initial press: zooms halfW from 64 to 63
testTime += 1000 / 30; frame(testTime); // tick 0 finish: clears initial keydown flag
testTime += 1000 / 30; frame(testTime); // tick 1 while held: zooms 63 -> 62
testTime += 1000 / 30; frame(testTime); // tick 2 while held: zooms 62 -> 61
const expectedZHeld = 320.0 / 61.0;
if (Math.abs(zoom - expectedZHeld) > 0.001) {
  throw new Error(`Holding Z for 2 ticks should reach halfW=61 (zoom ${expectedZHeld}), got ${zoom}`);
}
sendKeyUp({ key: 'z' });
testTime += 1000 / 30; frame(testTime); // key released: no change
if (Math.abs(zoom - expectedZHeld) > 0.001) {
  throw new Error(`Releasing Z should stop zooming, got ${zoom}`);
}

// 4. Verify discrete tick-gated edge-scrolling:
// In 200ms, whether rendered at 30 Hz, 60 Hz, or 120 Hz, scrolling moves exactly the same distance (6 ticks * 2 units = 12 units)
navigate('editor');
centerCamera();
const startX30 = viewX;
pointerOnCanvas = true;
mouseLogicalX = 0;
mouseLogicalY = 240;

// Simulate 200ms at 30 Hz (6 frames of 1000/30 ms = 200ms)
testTime = 20000;
frame(testTime); // prime
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
const movedAt30Hz = startX30 - viewX;
if (Math.abs(movedAt30Hz - 12.0) > 0.1) {
  throw new Error(`Expected 12.0 units scrolled in 200ms at 30Hz, got ${movedAt30Hz}`);
}

// Reset and simulate 200ms at 60 Hz (12 frames of 1000/60 ms = 200ms)
navigate('editor');
centerCamera();
pointerOnCanvas = true;
mouseLogicalX = 0;
mouseLogicalY = 240;
const startX60 = viewX;
testTime = 25000;
frame(testTime); // prime
for (let i = 0; i < 12; i++) {
  testTime += 1000 / 60;
  frame(testTime);
}
const movedAt60Hz = startX60 - viewX;
if (Math.abs(movedAt60Hz - 12.0) > 0.1) {
  throw new Error(`Expected identical 12.0 units scrolled in 200ms at 60Hz, got ${movedAt60Hz}`);
}

// Reset and simulate 200ms at 120 Hz (24 frames of 1000/120 ms = 200ms)
navigate('editor');
centerCamera();
pointerOnCanvas = true;
mouseLogicalX = 0;
mouseLogicalY = 240;
const startX120 = viewX;
testTime = 30000;
frame(testTime); // prime
for (let i = 0; i < 24; i++) {
  testTime += 1000 / 120;
  frame(testTime);
}
const movedAt120Hz = startX120 - viewX;
if (Math.abs(movedAt120Hz - 12.0) > 0.1) {
  throw new Error(`Expected identical 12.0 units scrolled in 200ms at 120Hz, got ${movedAt120Hz}`);
}

// 5. Verify Slow mode slows scrolling to 7.5 Hz in simulation
navigate('simulation');
centerCamera();
pointerOnCanvas = true;
mouseLogicalX = 0;
mouseLogicalY = 240;
isSlow = true;
const simStartX = viewX;
testTime = 40000;
frame(testTime); // prime
// Over 200ms in slow mode (0.25x), only 50ms accumulate -> 1 tick = 2.0 units
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
const slowMoved = simStartX - viewX;
if (Math.abs(slowMoved - 2.0) > 0.1) {
  throw new Error(`Expected 2.0 units scrolled in 200ms in Slow mode (7.5 Hz), got ${slowMoved}`);
}

// 6. Verify Paused mode in simulation still edge-scrolls at discrete tick rate
isSlow = false;
if (!engine.paused) {
  dispatch('toggle-pause');
}
centerCamera();
pointerOnCanvas = true;
mouseLogicalX = 0;
mouseLogicalY = 240;
const pauseStartX = viewX;
previousFrameTime = null;
simulationTime = 0;
testTime = 50000;
frame(testTime); // prime
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
const pausedMoved = pauseStartX - viewX;
if (Math.abs(pausedMoved - 12.0) > 0.1) {
  throw new Error(`Expected 12.0 units scrolled in 200ms while paused in simulation, got ${pausedMoved}`);
}
if (engine.paused) {
  dispatch('toggle-pause');
}

// 7. Verify absence of failure banner additions
Object.defineProperty(engine, 'trainFallen', { get: () => true, configurable: true });
Object.defineProperty(engine, 'brokenBeamCount', { get: () => 3, configurable: true });
const auditSimCtrls = getControls('simulation');
if (auditSimCtrls.some(c => c.id === 'lbl-sim-fallen' || c.id === 'lbl-sim-broken')) {
  throw new Error('Failure banners (train fallen / broken members) should be removed in authentic recreation');
}

console.log('Test 20 Passed: Authentic fidelity audit verified.');

console.log('=== TEST 21: Letterbox / Outer-edge scrolling & Window boundary tracking ===');
navigate('editor');
centerCamera();

// 1. Left letterbox overrun scrolling
let startX = viewX;
pointerOnCanvas = false;
pointerInWindow = true;
mouseLogicalX = -120;
mouseLogicalY = 240;

if (getEditorVisuals() !== null) {
  throw new Error('Editor preview should be null when pointer is in the letterbox');
}

previousFrameTime = null;
editorTime = 0;
testTime = 60000;
frame(testTime); // prime
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
let scrolled = startX - viewX;
if (Math.abs(scrolled - 12.0) > 0.1) {
  throw new Error(`Expected 12.0 units scrolled left from left letterbox, got ${scrolled}`);
}

// 2. Right letterbox overrun scrolling
centerCamera();
startX = viewX;
pointerOnCanvas = false;
pointerInWindow = true;
mouseLogicalX = 760;
mouseLogicalY = 240;
previousFrameTime = null;
editorTime = 0;
testTime = 65000;
frame(testTime); // prime
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
scrolled = viewX - startX;
if (Math.abs(scrolled - 12.0) > 0.1) {
  throw new Error(`Expected 12.0 units scrolled right from right letterbox, got ${scrolled}`);
}

// 3. Top letterbox overrun scrolling
centerCamera();
let startY = viewY;
pointerOnCanvas = false;
pointerInWindow = true;
mouseLogicalX = 320;
mouseLogicalY = -80;
previousFrameTime = null;
editorTime = 0;
testTime = 70000;
frame(testTime); // prime
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
let scrolledY = viewY - startY;
if (Math.abs(scrolledY - 12.0) > 0.1) {
  throw new Error(`Expected 12.0 units scrolled up from top letterbox, got ${scrolledY}`);
}

// 4. Bottom letterbox overrun scrolling
centerCamera();
startY = viewY;
pointerOnCanvas = false;
pointerInWindow = true;
mouseLogicalX = 320;
mouseLogicalY = 560;
previousFrameTime = null;
editorTime = 0;
testTime = 75000;
frame(testTime); // prime
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
scrolledY = startY - viewY;
if (Math.abs(scrolledY - 12.0) > 0.1) {
  throw new Error(`Expected 12.0 units scrolled down from bottom letterbox, got ${scrolledY}`);
}

// 5. Diagonal corner overrun scrolling
centerCamera();
startX = viewX;
startY = viewY;
pointerOnCanvas = false;
pointerInWindow = true;
mouseLogicalX = -50;
mouseLogicalY = -50;
previousFrameTime = null;
editorTime = 0;
testTime = 80000;
frame(testTime); // prime
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
scrolled = startX - viewX;
scrolledY = viewY - startY;
if (Math.abs(scrolled - 12.0) > 0.1 || Math.abs(scrolledY - 12.0) > 0.1) {
  throw new Error(`Expected diagonal scrolling (12, 12), got (${scrolled}, ${scrolledY})`);
}

// 6. Leaving window stops edge scrolling
startX = viewX;
pointerOnCanvas = false;
pointerInWindow = false; // window blur / mouseleave
mouseLogicalX = -120;
mouseLogicalY = 240;
previousFrameTime = null;
editorTime = 0;
testTime = 85000;
frame(testTime); // prime
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
if (viewX !== startX) {
  throw new Error(`Scrolling should stop when pointer leaves the window, moved ${startX - viewX}`);
}

// 7. Clicks in letterbox do not mutate bridge
const beamCountBefore = engine.beams.length;
const nodeCountBefore = engine.nodes.length;
if (glCanvasEl._listeners.pointerdown) {
  for (const fn of glCanvasEl._listeners.pointerdown) {
    fn({ button: 0, isPrimary: true, clientX: -100, clientY: -100, preventDefault: () => {} });
  }
}
if (engine.beams.length !== beamCountBefore || engine.nodes.length !== nodeCountBefore) {
  throw new Error('Clicks in letterbox should not create nodes or beams');
}

// 8. Top inner edge margin on canvas (widescreen vertical scrolling)
centerCamera();
startY = viewY;
pointerOnCanvas = true;
pointerInWindow = true;
hoveredControlId = null;
mouseLogicalX = 320;
mouseLogicalY = 15; // within 20px top margin
previousFrameTime = null;
editorTime = 0;
testTime = 86000;
frame(testTime); // prime
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
scrolledY = viewY - startY;
if (Math.abs(scrolledY - 12.0) > 0.1) {
  throw new Error(`Expected 12.0 units scrolled up from top inner margin, got ${scrolledY}`);
}

// 9. Bottom inner edge margin on canvas
centerCamera();
startY = viewY;
pointerOnCanvas = true;
pointerInWindow = true;
hoveredControlId = null;
mouseLogicalX = 320;
mouseLogicalY = 465; // within 20px bottom margin (>= 460)
previousFrameTime = null;
editorTime = 0;
testTime = 87000;
frame(testTime); // prime
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
scrolledY = startY - viewY;
if (Math.abs(scrolledY - 12.0) > 0.1) {
  throw new Error(`Expected 12.0 units scrolled down from bottom inner margin, got ${scrolledY}`);
}

// 10. Button hover suppresses edge scrolling (safe clicking/hovering)
centerCamera();
startY = viewY;
startX = viewX;
pointerOnCanvas = true;
pointerInWindow = true;
hoveredControlId = 'btn-editor-exit'; // hovering a top button
mouseLogicalX = 10;
mouseLogicalY = 10;
previousFrameTime = null;
editorTime = 0;
testTime = 88000;
frame(testTime); // prime
for (let i = 0; i < 6; i++) {
  testTime += 1000 / 30;
  frame(testTime);
}
if (viewX !== startX || viewY !== startY) {
  throw new Error(`Hovering an interactive button must suppress edge scrolling, moved (${startX - viewX}, ${startY - viewY})`);
}
hoveredControlId = null;

console.log('Test 21 Passed: Letterbox overrun scrolling, corner diagonal scrolling, inner-margin vertical scrolling, and button hover suppression verified.');

console.log('=== TEST 22: Zoom Control Click & Hold Repetition ===');
navigate('editor');
centerCamera();
if (zoom !== 5.0) throw new Error(`Expected zoom 5.0, got ${zoom}`);

const accessibleContainer = mockElements.get('accessible-controls');
const btnZoomIn = accessibleContainer.children.find(c => c.id === 'btn-editor-zoom-in');
const btnZoomOut = accessibleContainer.children.find(c => c.id === 'btn-editor-zoom-out');
if (!btnZoomIn || !btnZoomOut) throw new Error('Editor zoom buttons not found in accessible controls');

// 1. Single click (pointerdown followed immediately by pointerup & click)
for (const fn of btnZoomIn._listeners.pointerdown) fn({ button: 0, stopPropagation: () => {} });
for (const fn of btnZoomIn._listeners.pointerup) fn({});
for (const fn of btnZoomIn._listeners.click) fn({ preventDefault: () => {}, stopPropagation: () => {} });

let expectedZoom = 320.0 / 63.0; // halfW stepped from 64 to 63
if (Math.abs(zoom - expectedZoom) > 0.001) {
  throw new Error(`Single click on Zoom In should reach halfW=63 (zoom ${expectedZoom}), got ${zoom}`);
}

// 2. Click and hold Zoom In across multiple ticks
for (const fn of btnZoomIn._listeners.pointerdown) fn({ button: 0, stopPropagation: () => {} });
// Initial press: halfW stepped 63 -> 62
expectedZoom = 320.0 / 62.0;
if (Math.abs(zoom - expectedZoom) > 0.001) {
  throw new Error(`Initial press on Zoom In should reach halfW=62, got ${zoom}`);
}

previousFrameTime = null;
editorTime = 0;
testTime = 90000;
frame(testTime); // prime
testTime += 1000 / 30; frame(testTime); // tick 0 finish: clears initial press flag
testTime += 1000 / 30; frame(testTime); // tick 1 while held: steps 62 -> 61
testTime += 1000 / 30; frame(testTime); // tick 2 while held: steps 61 -> 60
expectedZoom = 320.0 / 60.0;
if (Math.abs(zoom - expectedZoom) > 0.001) {
  throw new Error(`Holding Zoom In for 2 ticks should reach halfW=60, got ${zoom}`);
}

// Release hold: pointerup
for (const fn of btnZoomIn._listeners.pointerup) fn({});
for (const fn of btnZoomIn._listeners.click) fn({ preventDefault: () => {}, stopPropagation: () => {} });
testTime += 1000 / 30; frame(testTime);
if (Math.abs(zoom - expectedZoom) > 0.001) {
  throw new Error(`Releasing Zoom In should stop zooming, got ${zoom}`);
}

// 3. Click and hold Zoom Out across multiple ticks
for (const fn of btnZoomOut._listeners.pointerdown) fn({ button: 0, stopPropagation: () => {} });
// Initial press: halfW stepped 60 -> 61
expectedZoom = 320.0 / 61.0;
if (Math.abs(zoom - expectedZoom) > 0.001) {
  throw new Error(`Initial press on Zoom Out should reach halfW=61, got ${zoom}`);
}

testTime += 1000 / 30; frame(testTime); // tick 0 finish
testTime += 1000 / 30; frame(testTime); // tick 1: steps 61 -> 62
testTime += 1000 / 30; frame(testTime); // tick 2: steps 62 -> 63
expectedZoom = 320.0 / 63.0;
if (Math.abs(zoom - expectedZoom) > 0.001) {
  throw new Error(`Holding Zoom Out for 2 ticks should reach halfW=63, got ${zoom}`);
}

// Dragging cursor off the button (pointerleave) stops holding
for (const fn of btnZoomOut._listeners.pointerleave) fn({});
testTime += 1000 / 30; frame(testTime);
if (Math.abs(zoom - expectedZoom) > 0.001) {
  throw new Error(`Leaving Zoom Out button should stop zooming, got ${zoom}`);
}

// 4. Keyboard / Programmatic activation without pointerdown
for (const fn of btnZoomOut._listeners.click) fn({ preventDefault: () => {}, stopPropagation: () => {} });
expectedZoom = 320.0 / 64.0;
if (Math.abs(zoom - expectedZoom) > 0.001) {
  throw new Error(`Programmatic click on Zoom Out should step halfW to 64, got ${zoom}`);
}

// 5. Holding Zoom button in simulation mode
navigate('simulation');
centerCamera();
const simZoomIn = accessibleContainer.children.find(c => c.id === 'btn-sim-zoom-in');
if (!simZoomIn) throw new Error('Simulation zoom in button not found');

for (const fn of simZoomIn._listeners.pointerdown) fn({ button: 0, stopPropagation: () => {} });
// Initial press: halfW 64 -> 63
previousFrameTime = null;
simulationTime = 0;
testTime = 100000;
frame(testTime); // prime
testTime += 1000 / 30; frame(testTime); // tick 0 finish
testTime += 1000 / 30; frame(testTime); // tick 1: steps 63 -> 62
testTime += 1000 / 30; frame(testTime); // tick 2: steps 62 -> 61
expectedZoom = 320.0 / 61.0;
if (Math.abs(zoom - expectedZoom) > 0.001) {
  throw new Error(`Holding Zoom In in simulation should reach halfW=61, got ${zoom}`);
}
for (const fn of simZoomIn._listeners.pointerup) fn({});

console.log('Test 22 Passed: Click and hold repetition on Zoom In/Out buttons verified in editor and simulation.');

console.log('=== TEST 23: Authentic Editor Layout & 8-Car Train Held Modifier ===');
navigate('editor');
loadLevelByName('level01.lvl');
centerCamera();

// 1. Authentic Editor Layout:
// In bbdemo.exe, Cost and Budget are always drawn at (0, 448) and (0, 464),
// and Save at (320, 464) and Clear at (560, 464) are always unobstructed.
pointerOnCanvas = true;
pointerInWindow = true;
const anchorNode = engine.nodes[0];
if (anchorNode.type !== 2) throw new Error('Expected node 0 to be anchor');

// Hover anchor node
mouseLogicalX = (anchorNode.x - viewX) * zoom + 320.0;
mouseLogicalY = 240.0 - (anchorNode.y - viewY) * zoom;
let ctrls = getControls('editor');

if (!ctrls.some(c => c.id === 'lbl-cost-title') || !ctrls.some(c => c.id === 'lbl-budget-title')) {
  throw new Error('Authentic editor must display Cost and Budget when hovering anchor');
}
if (ctrls.some(c => c.id === 'lbl-hint-select') || ctrls.some(c => c.id === 'lbl-hint-delete')) {
  throw new Error('Editor should not have hover hint labels');
}
if (!ctrls.some(c => c.id === 'btn-editor-save' && c.x === 320 && c.y === 464)) {
  throw new Error('Save button at (320, 464) must be visible and unobstructed');
}

// Create a dynamic node
engine.editorClick(anchorNode.x, anchorNode.y);
const dynX = anchorNode.x + 8.0;
const dynY = anchorNode.y;
engine.editorClick(dynX, dynY);
engine.editorCancel(); // Clear selection

// Hover dynamic node
const dynamicNodeIdx = engine.nodes.findIndex(n => n.type === 1);
if (dynamicNodeIdx < 0) throw new Error('Dynamic node was not created');
const dynamicNode = engine.nodes[dynamicNodeIdx];
mouseLogicalX = (dynamicNode.x - viewX) * zoom + 320.0;
mouseLogicalY = 240.0 - (dynamicNode.y - viewY) * zoom;
ctrls = getControls('editor');

if (!ctrls.some(c => c.id === 'lbl-cost-title') || !ctrls.some(c => c.id === 'lbl-budget-title')) {
  throw new Error('Authentic editor must display Cost and Budget when hovering dynamic node');
}
if (ctrls.some(c => c.id === 'lbl-hint-select') || ctrls.some(c => c.id === 'lbl-hint-delete')) {
  throw new Error('Editor should not have hover hint labels');
}
if (!ctrls.some(c => c.id === 'btn-editor-save' && c.x === 320 && c.y === 464)) {
  throw new Error('Save button at (320, 464) must remain visible when hovering dynamic node');
}

// 2. 8-Car Heavy Train Easter Egg (H held when starting train)
loadLevelByName('level01.lvl');

// A solitary 'h' keydown does NOT set a persistent toggle or status toast
const prevMsg = statusMessage;
sendKeyDown({ key: 'h' });
sendKeyUp({ key: 'h' });
if (statusMessage !== prevMsg) {
  throw new Error(`Pressing 'h' alone should not show a persistent status toast, got: '${statusMessage}'`);
}

// Starting train normally without holding 'h' spawns standard 4 cars
dispatch('test');
dispatch('run-train');
if (engine.trainCars.length !== 4) {
  throw new Error(`Normal dispatch must spawn 4 cars, got: ${engine.trainCars.length}`);
}
dispatch('edit');

// Starting train with 'H' held down spawns 8 cars
dispatch('test');
sendKeyDown({ key: 'h' }); // Hold 'H'
dispatch('run-train');     // Start train while 'H' is held
if (engine.trainCars.length !== 8) {
  throw new Error(`Starting train with 'H' held must spawn 8 cars, got: ${engine.trainCars.length}`);
}
if (engine.trainCars[0].type !== 1) throw new Error('First car must be locomotive (type 1)');
for (let c = 1; c < 8; c++) {
  if (engine.trainCars[c].type !== 0) throw new Error(`Car ${c} must be freight car (type 0)`);
}

// Step simulation a few ticks with 8 cars
for (let i = 0; i < 15; i++) {
  engine.step();
}
if (engine.trainCars.length !== 8) throw new Error('8 cars must remain active during simulation');

// Release 'H' and return to editor
sendKeyUp({ key: 'h' });
dispatch('edit');

// Re-starting train without holding 'H' reverts to standard 4 cars
dispatch('test');
dispatch('run-train');
if (engine.trainCars.length !== 4) {
  throw new Error(`Re-starting train without 'H' held must spawn 4 cars, got: ${engine.trainCars.length}`);
}
dispatch('edit');

console.log('Test 23 Passed: Authentic editor layout and 8-car held modifier verified.');

console.log('ALL VERIFICATION TESTS COMPLETED SUCCESSFULLY!');
process.exit(0);
