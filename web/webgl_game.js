// Bridge Builder 2000 - Authentic WebGL Game Controller
// Logical resolution: 640 x 480 (4:3 aspect ratio)

const glCanvas = document.getElementById('webgl-viewport');
const accessibleControls = document.getElementById('accessible-controls');
const fileImport = document.getElementById('file-import');

let engine = null;
let glRenderer = null;

// Screen states: 'home' | 'levels' | 'readme' | 'editor' | 'simulation'
let currentScreen = 'home';

// Camera & View (Logical coordinates)
let viewX = 2048.0, viewY = 128.0, zoom = 5.0;
let stressView = false;
let isSlow = false;
let levelPassedReported = false;
let isZHeld = false;
let isShiftHeld = false;
let zoomSteppedThisTick = false;
let heldZoomAction = null;
let pointerDownTargetAction = null;

// Mouse coordinates
let mouseLogicalX = 0, mouseLogicalY = 0;
let pointerOnCanvas = false, mouseButtons = 0;
let pointerInWindow = false;

// Interactive control states
let hoveredControlId = null;
let focusedControlId = null;
let statusMessage = null;
let statusExpiresAt = 0;

// Campaign level set
const CAMPAIGN_LEVELS = new Set(
  Array.from({ length: 15 }, (_, i) => `level${String(i + 1).padStart(2, '0')}.lvl`)
);

let currentLevelName = 'level01.lvl';
let isCampaignLevel = true;

const STORAGE_PROGRESS_KEY = 'bridge_builder_progress_v1';
const STORAGE_DESIGN_PREFIX = 'bridge_builder_design_';

// Base64 helpers
function b64ToArrayBuffer(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function getLevelNumber(name) {
  const match = (name || '').match(/level(\d+)/i);
  return match ? parseInt(match[1], 10) : 1;
}

// Storage helpers
function loadProgress() {
  try {
    const raw = localStorage.getItem(STORAGE_PROGRESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.completedLevels)) {
        return {
          completedLevels: parsed.completedLevels,
          unlockedLevel: typeof parsed.unlockedLevel === 'number' ? parsed.unlockedLevel : 1
        };
      }
    }
  } catch (e) {
    console.warn('Failed to read progress from localStorage:', e);
  }
  return { completedLevels: [], unlockedLevel: 1 };
}

function saveProgress(progress) {
  try {
    localStorage.setItem(STORAGE_PROGRESS_KEY, JSON.stringify(progress));
    return true;
  } catch (e) {
    console.warn('Failed to save progress to localStorage:', e);
    return false;
  }
}

let gameProgress = loadProgress();

function getSavedDesign(levelName) {
  try {
    return localStorage.getItem(STORAGE_DESIGN_PREFIX + levelName);
  } catch (e) {
    return null;
  }
}

function setSavedDesign(levelName, b64) {
  try {
    localStorage.setItem(STORAGE_DESIGN_PREFIX + levelName, b64);
    return true;
  } catch (e) {
    return false;
  }
}

function removeSavedDesign(levelName) {
  try {
    localStorage.removeItem(STORAGE_DESIGN_PREFIX + levelName);
    return true;
  } catch (e) {
    return false;
  }
}

function trySaveCurrentDesign() {
  if (!engine || !currentLevelName) return true;
  try {
    const buf = engine.exportBridgeBinary();
    if (buf) {
      const b64 = arrayBufferToBase64(buf);
      return setSavedDesign(currentLevelName, b64);
    }
    return false;
  } catch (e) {
    console.warn('Autosave failed:', e);
    return false;
  }
}

// Coordinate conversions
function logicalToWorld(lx, ly) {
  return {
    x: viewX + (lx - 320.0) / zoom,
    y: viewY - (ly - 240.0) / zoom
  };
}

function clampCamera() {
  zoom = Math.max(2.0, Math.min(10.0, zoom));
  if (!engine) return;
  const halfW = 320.0 / zoom;
  const halfH = halfW * 0.75;
  const minX = engine.level.leftLimit;
  const maxX = engine.level.rightLimit;
  const clampLeft = minX + halfW - 64.0;
  const clampRight = maxX - halfW + 64.0;
  if (clampLeft <= clampRight) {
    viewX = Math.max(clampLeft, Math.min(clampRight, viewX));
  } else {
    viewX = (minX + maxX) * 0.5;
  }
  const clampBottom = halfH;
  const clampTop = 256.0 - halfH;
  if (clampBottom <= clampTop) {
    viewY = Math.max(clampBottom, Math.min(clampTop, viewY));
  } else {
    viewY = 128.0;
  }
}

function centerCamera() {
  viewX = 2048.0;
  viewY = 128.0;
  zoom = 5.0;
  clampCamera();
}

// Viewport mapping (Centered 4:3 letterboxing)
function updateViewport() {
  const windowW = window.innerWidth;
  const windowH = window.innerHeight;

  const scale = Math.min(windowW / 640, windowH / 480);
  const viewW = Math.max(1, Math.floor(640 * scale));
  const viewH = Math.max(1, Math.floor(480 * scale));
  const viewX0 = Math.floor((windowW - viewW) / 2);
  const viewY0 = Math.floor((windowH - viewH) / 2);

  const container = document.getElementById('game-stage');
  if (container) {
    container.style.position = 'absolute';
    container.style.left = viewX0 + 'px';
    container.style.top = viewY0 + 'px';
    container.style.width = viewW + 'px';
    container.style.height = viewH + 'px';
  }

  const dpr = window.devicePixelRatio || 1;
  const pixelW = Math.round(viewW * dpr);
  const pixelH = Math.round(viewH * dpr);

  if (glCanvas.width !== pixelW || glCanvas.height !== pixelH) {
    glCanvas.width = pixelW;
    glCanvas.height = pixelH;
  }
}

window.addEventListener('resize', updateViewport);

// Level & Bridge binary loading
function identifyLevelForBridge(buf) {
  if (!buf || buf.byteLength < 4128) return null;
  const bridgeHeader = new Uint8Array(buf, 4, 4116);

  if (window.BRIDGE_ASSETS && window.BRIDGE_ASSETS.levels) {
    for (const [levelName, b64] of Object.entries(window.BRIDGE_ASSETS.levels)) {
      try {
        const levelBuf = b64ToArrayBuffer(b64);
        if (levelBuf.byteLength >= 4116) {
          const levelHeader = new Uint8Array(levelBuf, 0, 4116);
          let match = true;
          for (let i = 0; i < 4116; i++) {
            if (bridgeHeader[i] !== levelHeader[i]) {
              match = false;
              break;
            }
          }
          if (match) return levelName;
        }
      } catch (e) {
        // Continue checking
      }
    }
  }
  return null;
}

function loadLevelByName(name, forceFresh = false) {
  let loaded = false;
  if (!forceFresh) {
    const savedB64 = getSavedDesign(name);
    if (savedB64) {
      try {
        const buf = b64ToArrayBuffer(savedB64);
        if (engine.loadBridgeBinary(buf)) {
          loaded = true;
        }
      } catch (err) {
        console.warn(`Failed loading saved bridge for ${name}:`, err);
      }
    }
  }

  if (!loaded) {
    if (!window.BRIDGE_ASSETS || !window.BRIDGE_ASSETS.levels || !window.BRIDGE_ASSETS.levels[name]) {
      throw new Error(`Level asset not found: "${name}"`);
    }
    const buf = b64ToArrayBuffer(window.BRIDGE_ASSETS.levels[name]);
    const ok = engine.loadLevelBinary(buf);
    if (!ok) {
      throw new Error(`Failed to parse binary level data for "${name}"`);
    }
  }

  // Commit level identity only after validation
  currentLevelName = name;
  isCampaignLevel = CAMPAIGN_LEVELS.has(name);
  levelPassedReported = false;
  centerCamera();
}

function downloadBridgeFile(filename, buffer) {
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCurrentDesign() {
  if (!engine) return false;
  const buf = engine.exportBridgeBinary();
  if (buf) {
    const baseName = (currentLevelName || 'bridge').replace(/\.lvl$/i, '');
    downloadBridgeFile(`${baseName}.brg`, buf);
    setStatusFeedback('Download requested');
    syncAccessibleControls();
    return true;
  } else {
    showHtmlDialog({
      title: 'Export Error',
      message: 'Could not export bridge design binary.',
      actions: [{ label: 'OK', onClick: hideHtmlDialog }]
    });
    return false;
  }
}

// HTML Modal Dialog helper
function showHtmlDialog({ title, message, actions = [] }) {
  const container = document.getElementById('html-dialog-container');
  const titleEl = document.getElementById('html-dialog-title');
  const msgEl = document.getElementById('html-dialog-message');
  const actionsEl = document.getElementById('html-dialog-actions');

  if (!container || !titleEl || !msgEl || !actionsEl) return;

  titleEl.textContent = title;
  msgEl.textContent = message;
  actionsEl.innerHTML = '';

  for (const act of actions) {
    const btn = document.createElement('button');
    btn.textContent = act.label;
    btn.onclick = (e) => {
      e.preventDefault();
      if (act.onClick) act.onClick();
    };
    actionsEl.appendChild(btn);
  }

  container.style.display = 'flex';
}

function hideHtmlDialog() {
  const container = document.getElementById('html-dialog-container');
  if (container) container.style.display = 'none';
}

function isDialogOpen() {
  const container = document.getElementById('html-dialog-container');
  return !!(container && container.style.display && container.style.display !== 'none');
}

// Transient status message (e.g. "Download requested")
function setStatusFeedback(msg, durationMs = 2500) {
  statusMessage = msg;
  statusExpiresAt = performance.now() + durationMs;
}

// Control Descriptors for each screen
function getControls(screen) {
  const controls = [];

  const COLOR_NORMAL = [0.63, 0.63, 0.63, 1.0];
  const COLOR_WHITE = [1.0, 1.0, 1.0, 1.0];
  const COLOR_DISABLED = [0.32, 0.32, 0.32, 1.0];
  const COLOR_GREEN = [0.0, 1.0, 0.0, 1.0];
  const COLOR_RED = [1.0, 0.0, 0.0, 1.0];

  function resolveColor(ctrl) {
    if (ctrl.disabled) return COLOR_DISABLED;
    if (ctrl.color) return ctrl.color;
    const isHovered = hoveredControlId === ctrl.id;
    const isFocused = focusedControlId === ctrl.id;
    if (ctrl.active || isHovered || isFocused) return COLOR_WHITE;
    return COLOR_NORMAL;
  }

  if (screen === 'home') {
    // Title
    controls.push({
      id: 'lbl-title-bridge',
      text: 'Bridge',
      x: 320,
      y: 160,
      size: 32,
      advance: 32,
      align: 'center',
      color: COLOR_WHITE
    });
    controls.push({
      id: 'lbl-title-builder',
      text: 'Builder',
      x: 320,
      y: 192,
      size: 32,
      advance: 32,
      align: 'center',
      color: COLOR_WHITE
    });
    // Version
    controls.push({
      id: 'lbl-version',
      text: 'Version 12.18.00',
      x: 320,
      y: 240,
      size: 8,
      advance: 8,
      align: 'center',
      color: COLOR_NORMAL
    });
    // Actions
    controls.push({
      id: 'btn-start-game',
      text: 'Start Game',
      x: 320,
      y: 320,
      size: 16,
      advance: 16,
      align: 'center',
      action: 'start-game',
      shortcut: 'S',
      mnemonicIndex: 0
    });
    controls.push({
      id: 'btn-load-bridge',
      text: 'Load Bridge',
      x: 320,
      y: 336,
      size: 16,
      advance: 16,
      align: 'center',
      action: 'load-bridge',
      shortcut: 'L',
      mnemonicIndex: 0
    });
    controls.push({
      id: 'btn-readme',
      text: 'Readme',
      x: 320,
      y: 352,
      size: 16,
      advance: 16,
      align: 'center',
      action: 'readme',
      shortcut: 'R',
      mnemonicIndex: 0
    });
    controls.push({
      id: 'btn-home-exit',
      text: 'Exit',
      x: 320,
      y: 368,
      size: 16,
      advance: 16,
      align: 'center',
      action: 'exit',
      shortcut: 'E',
      mnemonicIndex: 0,
      tooltip: 'Exit to GitHub repository (https://github.com/s--i/BridgeBuilderDemo)'
    });
    // Footer
    controls.push({
      id: 'lbl-footer',
      text: 'Bridge Builder (c) 2000  Alex Austin  All Rights Reserved',
      x: 320,
      y: 448,
      size: 8,
      advance: 8,
      align: 'center',
      color: COLOR_NORMAL
    });
  } else if (screen === 'levels') {
    // Exit at top left
    controls.push({
      id: 'btn-levels-exit',
      text: 'Exit',
      x: 0,
      y: 0,
      size: 16,
      advance: 16,
      action: 'exit'
    });
    // Level 1 to 15 vertical list at X=0 starting Y=64 with 16 spacing
    // Levels 1-7 always visible (2-7 disabled if locked). Levels 8-15 only appear once unlocked.
    for (let i = 1; i <= 15; i++) {
      const isUnlocked = i <= gameProgress.unlockedLevel;
      if (i > 7 && !isUnlocked) continue;
      const name = `level${String(i).padStart(2, '0')}.lvl`;
      const isCompleted = gameProgress.completedLevels.includes(name);
      controls.push({
        id: `btn-level-${i}`,
        text: `${isCompleted ? '* ' : ''}Level ${i}`,
        x: 0,
        y: 64 + (i - 1) * 16,
        size: 16,
        advance: 16,
        action: 'select-level',
        levelName: name,
        disabled: i <= 7 && !isUnlocked
      });
    }
  } else if (screen === 'readme') {
    // Exit at top left
    controls.push({
      id: 'btn-readme-exit',
      text: 'Exit',
      x: 0,
      y: 0,
      size: 16,
      advance: 16,
      action: 'exit'
    });

    const DEFAULT_README = `Bridge Builder Readme

How to play:

Left click to select a point, left click again to
create a link.  Right click to delete points and
links.  Once your bridge is ready select Test to
test your bridge.  Then select Run Train to send
the train across the bridge.  If it makes it
across you win, if it doesn't you don't win.
You can then go back and edit it more to fix your
poorly designed bridge.  Press Z to zoom in,
Shift Z to zoom out.  Have a great day.

Requirements:

200Mhz or faster CPU
Windows 95/98/00/NT
Direct X version 6 or later
Keyboard recommended
OpenGL video card and drivers
go to www.glsetup.com for the latest OpenGL drivers`;

    const rawReadme = (typeof window !== 'undefined' && window.BRIDGE_README) ? window.BRIDGE_README : DEFAULT_README;
    const readmeLines = rawReadme.trimEnd().split(/\r?\n/);

    let startY = 48;
    for (let i = 0; i < readmeLines.length; i++) {
      controls.push({
        id: `lbl-readme-${i}`,
        text: readmeLines[i],
        x: 32,
        y: startY + i * 16,
        size: 8,
        advance: 8,
        color: COLOR_NORMAL
      });
    }
  } else if (screen === 'editor') {
    // Exit at (0, 0)
    controls.push({
      id: 'btn-editor-exit',
      text: 'Exit',
      x: 0,
      y: 0,
      size: 16,
      advance: 16,
      action: 'exit'
    });
    // Test at (576, 0)
    controls.push({
      id: 'btn-editor-test',
      text: 'Test',
      x: 576,
      y: 0,
      size: 16,
      advance: 16,
      action: 'test',
      shortcut: 'T',
      mnemonicIndex: 0
    });
    // Zoom In at (0, 64)
    controls.push({
      id: 'btn-editor-zoom-in',
      text: 'Zoom In',
      x: 0,
      y: 64,
      size: 16,
      advance: 16,
      action: 'zoom-in'
    });
    // Zoom Out at (0, 80)
    controls.push({
      id: 'btn-editor-zoom-out',
      text: 'Zoom Out',
      x: 0,
      y: 80,
      size: 16,
      advance: 16,
      action: 'zoom-out'
    });

    // Cost & Budget at Y=448/464, values at X=128
    const cost = engine ? engine.getCost() : 0;
    const budget = engine ? engine.level.budget : 0;
    const overBudget = cost >= budget;
    const valueColor = overBudget ? COLOR_RED : COLOR_WHITE;

    controls.push({
      id: 'lbl-cost-title',
      text: 'Cost:',
      x: 0,
      y: 448,
      size: 16,
      advance: 16,
      color: COLOR_WHITE
    });
    controls.push({
      id: 'lbl-cost-val',
      text: `$${cost.toLocaleString()}`,
      x: 128,
      y: 448,
      size: 16,
      advance: 16,
      color: valueColor
    });

    controls.push({
      id: 'lbl-budget-title',
      text: 'Budget:',
      x: 0,
      y: 464,
      size: 16,
      advance: 16,
      color: COLOR_WHITE
    });
    controls.push({
      id: 'lbl-budget-val',
      text: `$${budget.toLocaleString()}`,
      x: 128,
      y: 464,
      size: 16,
      advance: 16,
      color: valueColor
    });

    // Save at (320, 464)
    controls.push({
      id: 'btn-editor-save',
      text: 'Save',
      x: 320,
      y: 464,
      size: 16,
      advance: 16,
      action: 'save'
    });
    // Clear at (560, 464)
    controls.push({
      id: 'btn-editor-clear',
      text: 'Clear',
      x: 560,
      y: 464,
      size: 16,
      advance: 16,
      action: 'clear'
    });

    // Transient status message (e.g. "Download requested")
    if (statusMessage && performance.now() < statusExpiresAt) {
      controls.push({
        id: 'lbl-editor-status',
        text: statusMessage,
        x: 320,
        y: 432,
        size: 16,
        advance: 16,
        align: 'center',
        color: COLOR_WHITE
      });
    }
  } else if (screen === 'simulation') {
    // Edit at (0, 0)
    controls.push({
      id: 'btn-sim-edit',
      text: 'Edit',
      x: 0,
      y: 0,
      size: 16,
      advance: 16,
      action: 'edit'
    });
    // Slow at (160, 0)
    controls.push({
      id: 'btn-sim-slow',
      text: 'Slow',
      x: 160,
      y: 0,
      size: 16,
      advance: 16,
      active: isSlow,
      action: 'toggle-slow',
      shortcut: 'S',
      mnemonicIndex: 0
    });
    // Pause at (320, 0)
    controls.push({
      id: 'btn-sim-pause',
      text: 'Pause',
      x: 320,
      y: 0,
      size: 16,
      advance: 16,
      active: engine ? engine.paused : false,
      action: 'toggle-pause',
      shortcut: 'P',
      mnemonicIndex: 0
    });
    // Run Train at (496, 0) right-aligned top until dispatched
    if (engine && !engine.trainActive) {
      controls.push({
        id: 'btn-sim-train',
        text: 'Run Train',
        x: 496,
        y: 0,
        size: 16,
        advance: 16,
        action: 'run-train',
        shortcut: 'T',
        mnemonicIndex: 4
      });
    }
    // Zoom In at (0, 64)
    controls.push({
      id: 'btn-sim-zoom-in',
      text: 'Zoom In',
      x: 0,
      y: 64,
      size: 16,
      advance: 16,
      action: 'zoom-in'
    });
    // Zoom Out at (0, 80)
    controls.push({
      id: 'btn-sim-zoom-out',
      text: 'Zoom Out',
      x: 0,
      y: 80,
      size: 16,
      advance: 16,
      action: 'zoom-out'
    });
    // Analyze Stress at (0, 464)
    controls.push({
      id: 'btn-sim-stress',
      text: 'Analyze Stress',
      x: 0,
      y: 464,
      size: 16,
      advance: 16,
      active: stressView,
      action: 'toggle-stress',
      shortcut: 'A',
      mnemonicIndex: 0
    });

    // Completion overlays
    if (engine && engine.levelPassed) {
      const lvlNum = getLevelNumber(currentLevelName);
      if (isCampaignLevel && lvlNum === 15) {
        const victoryLines = [
          "Congratulations!  You are the Bridge",
          "Building Champion.  People now look",
          "at you with respect and admiration.",
          "Your bridges you have brought peace",
          "and joy to the Earth, Iowa and The",
          "Moon.  Happy days are ahead of you.",
          "Visit the Bridge Builder Website for",
          "updates, contests, and the meaning",
          "of life (coming soon)."
        ];
        for (let i = 0; i < victoryLines.length; i++) {
          controls.push({
            id: `lbl-victory-${i}`,
            text: victoryLines[i],
            x: 320,
            y: 96 + i * 16,
            size: 16,
            advance: 16,
            align: 'center',
            color: COLOR_WHITE
          });
        }
        controls.push({
          id: 'btn-victory-exit',
          text: 'Exit Game',
          x: 320,
          y: 260,
          size: 16,
          advance: 16,
          align: 'center',
          action: 'exit-to-home'
        });
      } else {
        // Levels 1..14 or custom bridge
        controls.push({
          id: 'lbl-level-passed',
          text: isCampaignLevel ? 'Level Passed' : 'Bridge Passed',
          x: 320,
          y: 220,
          size: 16,
          advance: 16,
          align: 'center',
          color: COLOR_GREEN
        });
        if (isCampaignLevel) {
          controls.push({
            id: 'btn-next-level',
            text: 'Next Level',
            x: 320,
            y: 240,
            size: 16,
            advance: 16,
            align: 'center',
            action: 'next-level'
          });
        }
      }
    }
  }

  // Resolve visual colors based on state
  for (const ctrl of controls) {
    ctrl.color = resolveColor(ctrl);
  }

  return controls;
}

// Synchronize transparent accessible HTML button overlays with current controls
function syncAccessibleControls() {
  accessibleControls.innerHTML = '';
  const controls = getControls(currentScreen);

  for (const ctrl of controls) {
    if (!ctrl.action) continue;

    const btn = document.createElement('button');
    btn.id = ctrl.id;
    btn.setAttribute('aria-label', ctrl.text);
    btn.title = ctrl.tooltip || ctrl.text;
    btn.disabled = !!ctrl.disabled;
    btn.tabIndex = ctrl.disabled ? -1 : 0;
    if (ctrl.shortcut) {
      btn.setAttribute('aria-keyshortcuts', ctrl.shortcut);
    }

    const size = ctrl.size || 16;
    const advance = ctrl.advance !== undefined ? ctrl.advance : size;
    const width = ctrl.text.length * advance;
    const height = size;

    let left = ctrl.x || 0;
    if (ctrl.align === 'center') {
      left = (ctrl.x || 0) - width * 0.5;
    } else if (ctrl.align === 'right') {
      left = (ctrl.x || 0) - width;
    }
    const top = ctrl.y || 0;

    btn.style.left = `${(left / 640) * 100}%`;
    btn.style.top = `${(top / 480) * 100}%`;
    btn.style.width = `${(width / 640) * 100}%`;
    btn.style.height = `${(height / 480) * 100}%`;

    btn.addEventListener('mouseenter', () => {
      hoveredControlId = ctrl.id;
    });
    btn.addEventListener('mouseleave', () => {
      if (hoveredControlId === ctrl.id) hoveredControlId = null;
    });
    btn.addEventListener('focus', () => {
      focusedControlId = ctrl.id;
    });
    btn.addEventListener('blur', () => {
      if (focusedControlId === ctrl.id) focusedControlId = null;
    });
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if ((e.button === 0 || e.button === undefined) && (ctrl.action === 'zoom-in' || ctrl.action === 'zoom-out')) {
        pointerDownTargetAction = ctrl.action;
        heldZoomAction = ctrl.action;
        zoomSteppedThisTick = true;
        dispatch(ctrl.action, ctrl);
      }
    });
    btn.addEventListener('pointerup', () => {
      heldZoomAction = null;
    });
    btn.addEventListener('pointercancel', () => {
      heldZoomAction = null;
      pointerDownTargetAction = null;
    });
    btn.addEventListener('pointerleave', () => {
      heldZoomAction = null;
      pointerDownTargetAction = null;
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (ctrl.action === 'zoom-in' || ctrl.action === 'zoom-out') {
        if (pointerDownTargetAction === ctrl.action) {
          pointerDownTargetAction = null;
          return;
        }
      }
      dispatch(ctrl.action, ctrl);
    });

    accessibleControls.appendChild(btn);
  }
}

// Screen navigation
let simulationTime = 0;
let editorTime = 0;
let previousFrameTime = null;

function navigate(screen) {
  currentScreen = screen;
  hoveredControlId = null;
  focusedControlId = null;

  // Reset accumulator on screen transitions
  simulationTime = 0;
  editorTime = 0;
  previousFrameTime = null;
  isZHeld = false;
  isShiftHeld = false;
  zoomSteppedThisTick = false;
  heldZoomAction = null;
  pointerDownTargetAction = null;

  if (screen === 'editor') {
    levelPassedReported = false;
    if (engine && engine.simulationActive) {
      engine.resetSimulation();
      isSlow = false;
    }
  } else if (screen === 'simulation') {
    levelPassedReported = false;
  } else {
    if (engine && engine.simulationActive) {
      engine.resetSimulation();
      isSlow = false;
    }
  }

  syncAccessibleControls();
}

// Exit flow with autosave confirmation on storage failure
function exitWithAutosave() {
  const ok = trySaveCurrentDesign();
  if (ok) {
    if (engine && engine.simulationActive) {
      engine.resetSimulation();
      isSlow = false;
      levelPassedReported = false;
    }
    navigate('home');
  } else {
    showHtmlDialog({
      title: 'Storage Unavailable',
      message: 'Unable to save bridge design to browser local storage.\nYou can download your bridge before leaving.',
      actions: [
        {
          label: 'Save .brg',
          onClick: () => {
            exportCurrentDesign();
          }
        },
        {
          label: 'Leave Anyway',
          onClick: () => {
            hideHtmlDialog();
            if (engine && engine.simulationActive) {
              engine.resetSimulation();
              isSlow = false;
              levelPassedReported = false;
            }
            navigate('home');
          }
        },
        {
          label: 'Cancel',
          onClick: () => {
            hideHtmlDialog();
          }
        }
      ]
    });
  }
}

// Command dispatcher
function dispatch(action, payload = null) {
  switch (action) {
    case 'start-game':
      navigate('levels');
      break;

    case 'load-bridge':
      if (fileImport) {
        fileImport.value = '';
        fileImport.click();
      }
      break;

    case 'readme':
      navigate('readme');
      break;

    case 'exit':
      if (currentScreen === 'home') {
        if (typeof window !== 'undefined' && window.location) {
          window.location.href = 'https://github.com/s--i/BridgeBuilderDemo';
        }
      } else if (currentScreen === 'levels' || currentScreen === 'readme') {
        navigate('home');
      } else if (currentScreen === 'editor' || currentScreen === 'simulation') {
        exitWithAutosave();
      }
      break;

    case 'select-level':
      if (payload && payload.levelName) {
        try {
          loadLevelByName(payload.levelName);
          navigate('editor');
        } catch (err) {
          showHtmlDialog({
            title: 'Level Load Error',
            message: `Failed to load level: ${err.message}`,
            actions: [{ label: 'OK', onClick: hideHtmlDialog }]
          });
        }
      }
      break;

    case 'test':
      if (engine && currentScreen === 'editor') {
        isSlow = false;
        levelPassedReported = false;
        engine.startTest();
        navigate('simulation');
      }
      break;

    case 'edit':
      if (engine && currentScreen === 'simulation') {
        engine.resetSimulation();
        isSlow = false;
        levelPassedReported = false;
        navigate('editor');
      }
      break;

    case 'toggle-slow':
      isSlow = !isSlow;
      simulationTime = 0; // reset accumulator on speed change
      syncAccessibleControls();
      break;

    case 'toggle-pause':
      if (engine && currentScreen === 'simulation') {
        engine.togglePause();
        simulationTime = 0; // reset accumulator on pause change
        syncAccessibleControls();
      }
      break;

    case 'run-train':
      if (engine && currentScreen === 'simulation' && !engine.trainActive) {
        engine.startTrain();
        syncAccessibleControls();
      }
      break;

    case 'toggle-stress':
      stressView = !stressView;
      syncAccessibleControls();
      break;

    case 'zoom-in': {
      let halfW = 320.0 / zoom;
      halfW = Math.max(32.0, halfW - 1.0);
      zoom = 320.0 / halfW;
      clampCamera();
      break;
    }

    case 'zoom-out': {
      let halfW = 320.0 / zoom;
      halfW = Math.min(160.0, halfW + 1.0);
      zoom = 320.0 / halfW;
      clampCamera();
      break;
    }

    case 'save':
      if (engine && (currentScreen === 'editor' || currentScreen === 'simulation')) {
        exportCurrentDesign();
      }
      break;

    case 'clear':
      if (engine && currentScreen === 'editor') {
        engine.clearBridge();
        removeSavedDesign(currentLevelName);
        trySaveCurrentDesign();
        syncAccessibleControls();
      }
      break;

    case 'next-level':
      if (engine && engine.levelPassed && isCampaignLevel) {
        const lvlNum = getLevelNumber(currentLevelName);
        if (lvlNum < 15) {
          const nextName = `level${String(lvlNum + 1).padStart(2, '0')}.lvl`;
          try {
            loadLevelByName(nextName);
            navigate('editor');
          } catch (err) {
            showHtmlDialog({
              title: 'Next Level Error',
              message: `Failed to load next level: ${err.message}`,
              actions: [{ label: 'OK', onClick: hideHtmlDialog }]
            });
          }
        }
      }
      break;

    case 'exit-to-home':
      exitWithAutosave();
      break;

    default:
      console.warn('Unhandled action:', action);
  }
}

// File Import handler
if (fileImport) {
  fileImport.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const buf = reader.result;
        if (!engine.loadBridgeBinary(buf)) {
          showHtmlDialog({
            title: 'Bridge Load Error',
            message: 'Invalid or corrupted .brg file.',
            actions: [{ label: 'OK', onClick: hideHtmlDialog }]
          });
          return;
        }

        const matchedLevel = identifyLevelForBridge(buf);
        if (matchedLevel && CAMPAIGN_LEVELS.has(matchedLevel)) {
          isCampaignLevel = true;
          currentLevelName = matchedLevel;
          const lvlNum = getLevelNumber(matchedLevel);
          if (lvlNum > gameProgress.unlockedLevel) {
            gameProgress.unlockedLevel = lvlNum;
            saveProgress(gameProgress);
          }
        } else {
          isCampaignLevel = false;
          const rawName = (file.name || 'custom.brg').replace(/[^\w.-]/g, '_');
          currentLevelName = rawName.startsWith('custom_') ? rawName : `custom_${rawName}`;
        }

        centerCamera();
        trySaveCurrentDesign();
        navigate('editor');
      } catch (err) {
        showHtmlDialog({
          title: 'Import Error',
          message: `Failed to load bridge file: ${err.message}`,
          actions: [{ label: 'OK', onClick: hideHtmlDialog }]
        });
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (isDialogOpen()) return;
  if (e.repeat) return;
  if (e.isComposing) return;

  const target = e.target;
  if (target) {
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) {
      return;
    }
  }

  // When an HTML button has focus, leave Enter and Space to native button activation to avoid triggering a second game action
  const activeEl = document.activeElement;
  const activeTag = activeEl ? (activeEl.tagName || '').toLowerCase() : '';
  if (activeTag === 'button' && (e.code === 'Space' || e.key === ' ' || e.key === 'Enter')) {
    return;
  }

  // Ignore Ctrl / Command / Alt combinations (Shift is allowed)
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === 'Shift') {
    isShiftHeld = true;
  }

  // Consolidated Escape handling
  if (e.key === 'Escape') {
    e.preventDefault();
    if (currentScreen === 'editor') {
      if (engine) {
        engine.editorCancel();
        trySaveCurrentDesign();
        syncAccessibleControls();
      }
    } else if (currentScreen === 'readme' || currentScreen === 'levels') {
      navigate('home');
    }
    return;
  }

  // Zoom shortcuts
  if (e.key === 'z' || e.key === 'Z') {
    if (currentScreen === 'editor' || currentScreen === 'simulation') {
      e.preventDefault();
      isZHeld = true;
      isShiftHeld = !!e.shiftKey;
      zoomSteppedThisTick = true;
      if (e.shiftKey) {
        dispatch('zoom-out');
      } else {
        dispatch('zoom-in');
      }
      return;
    }
  }

  // Space aliases
  if (e.code === 'Space' || e.key === ' ') {
    if (currentScreen === 'editor') {
      e.preventDefault();
      dispatch('test');
      return;
    } else if (currentScreen === 'simulation' && engine && !engine.trainActive) {
      e.preventDefault();
      dispatch('run-train');
      return;
    }
  }

  // Match keyboard input against enabled controls on current screen
  const keyUpper = e.key.toUpperCase();
  const controls = getControls(currentScreen);
  const matchingCtrl = controls.find(c =>
    c.shortcut &&
    c.shortcut.toUpperCase() === keyUpper &&
    !c.disabled &&
    c.action
  );

  if (matchingCtrl) {
    e.preventDefault();
    if (matchingCtrl.action === 'load-bridge') {
      if (fileImport) {
        fileImport.value = '';
        fileImport.click();
      }
    } else {
      dispatch(matchingCtrl.action, matchingCtrl);
    }
    return;
  }
});

window.addEventListener('keyup', (e) => {
  if (e.key === 'z' || e.key === 'Z') {
    isZHeld = false;
  }
  if (e.key === 'Shift') {
    isShiftHeld = false;
  }
});

window.addEventListener('pointerup', () => {
  heldZoomAction = null;
  pointerDownTargetAction = null;
});

window.addEventListener('blur', () => {
  isZHeld = false;
  isShiftHeld = false;
  heldZoomAction = null;
  pointerDownTargetAction = null;
});

// Editor Controls
new EditorControls(glCanvas, {
  engine: () => engine,
  isEditor: () => currentScreen === 'editor',
  isGameplay: () => currentScreen === 'editor' || currentScreen === 'simulation',
  world: logicalToWorld,
  hover: (wx, wy, lx, ly, buttons) => {
    mouseLogicalX = lx; mouseLogicalY = ly;
    pointerOnCanvas = lx >= 0 && lx < 640 && ly >= 0 && ly < 480;
    pointerInWindow = true;
    mouseButtons = buttons;
  },
  leave: () => { pointerOnCanvas = false; mouseButtons = 0; },
  leaveWindow: () => { pointerOnCanvas = false; pointerInWindow = false; mouseButtons = 0; },
  changed: () => {
    trySaveCurrentDesign();
    syncAccessibleControls();
  },
  pan: (dx, dy) => {
    viewX -= dx / zoom;
    viewY += dy / zoom;
    clampCamera();
  },
  zoom: (factor) => {
    zoom = Math.max(2.0, Math.min(10.0, zoom * factor));
    clampCamera();
  }
});

// Level pass handling
function handleLevelPassed() {
  if (!isCampaignLevel || !CAMPAIGN_LEVELS.has(currentLevelName)) return;

  if (!gameProgress.completedLevels.includes(currentLevelName)) {
    gameProgress.completedLevels.push(currentLevelName);
    const lvlNum = getLevelNumber(currentLevelName);
    if (lvlNum < 15) {
      gameProgress.unlockedLevel = Math.max(gameProgress.unlockedLevel, lvlNum + 1);
    }
    saveProgress(gameProgress);
  }
}

// Recompute world coordinates each frame so previews follow camera/zoom changes
// even while the physical pointer is stationary. Wasm owns picking and validity.
function getEditorVisuals() {
  if (currentScreen !== 'editor' || !engine || !pointerOnCanvas || isDialogOpen()) return null;
  const p = logicalToWorld(mouseLogicalX, mouseLogicalY);
  return { ...engine.getEditorVisuals(p.x, p.y), deleting: (mouseButtons & 2) !== 0 };
}

function tickGameplayInput() {
  if (isDialogOpen()) return;

  // 1. Edge scrolling (2 world units per tick)
  // Recreates authentic fullscreen feel: scrolling continues when cursor is at screen edge,
  // in letterbox bars, or within a comfortable edge margin when not hovering interactive HUD buttons.
  if (pointerOnCanvas || pointerInWindow) {
    const isOverButton = hoveredControlId !== null;
    const SCROLL_MARGIN = 20;

    if (!isOverButton) {
      if (mouseLogicalX <= SCROLL_MARGIN) {
        viewX -= 2.0;
      } else if (mouseLogicalX >= 640 - SCROLL_MARGIN) {
        viewX += 2.0;
      }
      if (mouseLogicalY <= SCROLL_MARGIN) {
        viewY += 2.0;
      } else if (mouseLogicalY >= 480 - SCROLL_MARGIN) {
        viewY -= 2.0;
      }
    }
  }

  // 2. Held Z / Shift+Z repetition or held Zoom In/Out button (1 world unit of halfW per tick)
  const isZoomIn = (isZHeld && !isShiftHeld) || heldZoomAction === 'zoom-in';
  const isZoomOut = (isZHeld && isShiftHeld) || heldZoomAction === 'zoom-out';

  if (isZoomIn || isZoomOut) {
    if (!zoomSteppedThisTick) {
      let halfW = 320.0 / zoom;
      if (isZoomOut) {
        halfW = Math.min(160.0, halfW + 1.0);
      } else {
        halfW = Math.max(32.0, halfW - 1.0);
      }
      zoom = 320.0 / halfW;
    }
  }
  zoomSteppedThisTick = false;

  clampCamera();
}

const TICK_INTERVAL = 1000 / 30;
const TICK_EPSILON = 1e-4;

// Main Frame Loop
function frame(timestamp) {
  try {
    const elapsed = previousFrameTime === null ? 0 : Math.min(250, timestamp - previousFrameTime);
    previousFrameTime = timestamp;

    if (currentScreen === 'simulation' && engine) {
      const timeScale = isSlow ? 0.25 : 1.0;
      simulationTime += elapsed * timeScale;
      while (simulationTime >= TICK_INTERVAL - TICK_EPSILON) {
        if (!engine.paused) {
          engine.step();
          if (engine.levelPassed && !levelPassedReported) {
            levelPassedReported = true;
            handleLevelPassed();
            syncAccessibleControls();
          }
        }
        tickGameplayInput();
        simulationTime = Math.max(0, simulationTime - TICK_INTERVAL);
      }
    } else if (currentScreen === 'editor' && engine) {
      editorTime += elapsed;
      while (editorTime >= TICK_INTERVAL - TICK_EPSILON) {
        engine.editorTick();
        tickGameplayInput();
        editorTime = Math.max(0, editorTime - TICK_INTERVAL);
      }
    }

    // Render WebGL scene & bitmap text
    const controls = getControls(currentScreen);
    if (glRenderer) {
      glRenderer.render(engine, viewX, viewY, zoom, stressView, controls, currentScreen, getEditorVisuals());
    }

  } catch (err) {
    console.error('Frame loop error:', err);
  }

  requestAnimationFrame(frame);
}

// App Initialization
async function init() {
  updateViewport();

  // 1. Initialize WebGL Renderer
  try {
    glRenderer = new WebGLRenderer(glCanvas);
  } catch (err) {
    console.error('WebGL initialization failed:', err);
    showHtmlDialog({
      title: 'WebGL Not Supported',
      message: 'Bridge Builder requires WebGL. Please ensure hardware acceleration is enabled or try another browser.\n\n' + err.message,
      actions: []
    });
    return;
  }

  // 2. Initialize WebAssembly Engine
  try {
    engine = await window.createBridgeEngine();
  } catch (err) {
    console.error('Wasm engine initialization failed:', err);
    showHtmlDialog({
      title: 'Could Not Start Engine',
      message: 'Failed to instantiate the WebAssembly physics engine.\n\n' + err.message,
      actions: []
    });
    return;
  }

  // 3. Prime initial level and start at home screen
  try {
    loadLevelByName('level01.lvl');
    navigate('home');
    requestAnimationFrame(frame);
  } catch (err) {
    console.error('Startup failed:', err);
    showHtmlDialog({
      title: 'Could Not Start Bridge Builder',
      message: 'Failed to initialize the initial level data.\n\n' + err.message,
      actions: []
    });
  }
}

init();
