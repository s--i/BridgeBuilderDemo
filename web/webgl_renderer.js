/**
 * webgl_renderer.js - Authentic 2000 Bridge Builder OpenGL Renderer Ported to WebGL
 * 
 * Recreates the authentic visual presentation of Alex Austin's original 2000 Bridge Builder:
 * - Pure orthographic / side-on parallel projection (no perspective distortion)
 * - Authentic 2000 color palette:
 *     - Dusky slate background: #414552 (glClearColor(0.256, 0.272, 0.320))
 *     - Ground rock: #383a40 (0.22, 0.23, 0.25)
 *     - River water: #182060 (0.09, 0.12, 0.38)
 *     - Deck beams: #f0f0f5 (0.95, 0.95, 0.95)
 *     - Iron truss beams: #858b98 (0.52, 0.55, 0.60)
 *     - Stress gradient: Lime Green -> Yellow -> Red
 *     - Train cars: Authentic dark charcoal-green silhouette with top specular edge
 * - 0.4 half-thickness ribbon beams (_DAT_0041865c)
 * - 2%/unit linear underwater depth extinction (_DAT_0041866c)
 */

class WebGLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { antialias: true, depth: false, alpha: false }) ||
              canvas.getContext('experimental-webgl', { antialias: true, depth: false, alpha: false });

    if (!this.gl) {
      throw new Error('WebGL not supported by this browser.');
    }

    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0.256, 0.272, 0.320, 1.0); // Exact bridge.exe glClearColor

    this.initShaders();
    this.initBuffers();
    this.initTextPass();

    this.beamHalfThickness = 0.4; // _DAT_0041865c
    this.waterExtinction = 0.02;  // _DAT_0041866c
  }

  initShaders() {
    const gl = this.gl;
    const vsSource = `
      attribute vec2 a_position;
      attribute vec4 a_color;
      uniform mat4 u_viewProjection;
      varying vec4 v_color;

      void main() {
        gl_Position = u_viewProjection * vec4(a_position, 0.0, 1.0);
        v_color = a_color;
      }
    `;

    const fsSource = `
      precision mediump float;
      varying vec4 v_color;

      void main() {
        gl_FragColor = v_color;
      }
    `;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s));
      }
      return s;
    };

    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }

    this.program = p;
    this.attribs = {
      position: gl.getAttribLocation(p, 'a_position'),
      color: gl.getAttribLocation(p, 'a_color'),
    };
    this.uniforms = {
      viewProjection: gl.getUniformLocation(p, 'u_viewProjection'),
    };
  }

  initBuffers() {
    const gl = this.gl;
    this.vbo = gl.createBuffer();
    this.maxVertices = 120000;
    // Each vertex: 2 floats pos + 4 floats color = 6 floats = 24 bytes
    this.vertexStride = 6 * 4;
    this.vertexData = new Float32Array(this.maxVertices * 6);
    this.vertexCount = 0;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.vertexData.byteLength, gl.DYNAMIC_DRAW);

    this.editorLinesVbo = gl.createBuffer();
    this.editorLinesData = null;
  }

  beginScene() {
    this.vertexCount = 0;
  }

  addVertex(x, y, r, g, b, a) {
    if (this.vertexCount >= this.maxVertices) return;
    const idx = this.vertexCount * 6;
    const d = this.vertexData;
    d[idx]     = x;
    d[idx + 1] = y;
    d[idx + 2] = r;
    d[idx + 3] = g;
    d[idx + 4] = b;
    d[idx + 5] = a;
    this.vertexCount++;
  }

  addTriangle(p1, p2, p3, c1, c2, c3) {
    const col2 = c2 || c1;
    const col3 = c3 || c1;
    this.addVertex(p1[0], p1[1], c1[0], c1[1], c1[2], c1[3]);
    this.addVertex(p2[0], p2[1], col2[0], col2[1], col2[2], col2[3]);
    this.addVertex(p3[0], p3[1], col3[0], col3[1], col3[2], col3[3]);
  }

  addQuad(p1, p2, p3, p4, c1, c2, c3, c4) {
    const col2 = c2 || c1;
    const col3 = c3 || c1;
    const col4 = c4 || c1;
    this.addTriangle(p1, p2, p3, c1, col2, col3);
    this.addTriangle(p1, p3, p4, c1, col3, col4);
  }

  // Draw 2D ribbon beam with thickness, directional sunlight shading, and underwater extinction (FUN_0040b020)
  addBeamRibbon(x1, y1, x2, y2, halfThickness, color, waterLevel = 120.0, light1 = 1.0, light2 = 1.0, applyUnderwater = true) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) return;
    const nx = (-dy / len) * halfThickness;
    const ny = (dx / len) * halfThickness;

    let atten1 = 1.0, atten2 = 1.0, atten3 = 1.0, atten4 = 1.0;
    if (applyUnderwater && waterLevel !== undefined && waterLevel !== null) {
      if (typeof BridgeLighting !== 'undefined') {
        atten1 = BridgeLighting.computeUnderwaterAttenuation(y1 - ny, waterLevel);
        atten2 = BridgeLighting.computeUnderwaterAttenuation(y2 - ny, waterLevel);
        atten3 = BridgeLighting.computeUnderwaterAttenuation(y2 + ny, waterLevel);
        atten4 = BridgeLighting.computeUnderwaterAttenuation(y1 + ny, waterLevel);
      } else {
        atten1 = Math.max(0.0, 1.0 - Math.max(0.0, waterLevel - (y1 - ny)) * this.waterExtinction);
        atten2 = Math.max(0.0, 1.0 - Math.max(0.0, waterLevel - (y2 - ny)) * this.waterExtinction);
        atten3 = Math.max(0.0, 1.0 - Math.max(0.0, waterLevel - (y2 + ny)) * this.waterExtinction);
        atten4 = Math.max(0.0, 1.0 - Math.max(0.0, waterLevel - (y1 + ny)) * this.waterExtinction);
      }
    }

    // In FUN_0040b020:
    // Side (+nx, +ny) uses fStack_24 = light1 (faces sun)
    // Side (-nx, -ny) uses fStack_20 = light2 (shady side)
    const c1 = [color[0] * light2 * atten1, color[1] * light2 * atten1, color[2] * light2 * atten1, color[3]];
    const c2 = [color[0] * light2 * atten2, color[1] * light2 * atten2, color[2] * light2 * atten2, color[3]];
    const c3 = [color[0] * light1 * atten3, color[1] * light1 * atten3, color[2] * light1 * atten3, color[3]];
    const c4 = [color[0] * light1 * atten4, color[1] * light1 * atten4, color[2] * light1 * atten4, color[3]];

    this.addQuad(
      [x1 - nx, y1 - ny],
      [x2 - nx, y2 - ny],
      [x2 + nx, y2 + ny],
      [x1 + nx, y1 + ny],
      c1, c2, c3, c4
    );
  }

  // Build authentic terrain relief ribbon and deep ground (FUN_004098e0)
  buildTerrain(level, minX, maxX, isSimulating = false) {
    const terrain = level.terrain;
    let shading = level.terrainShading;
    if (typeof BridgeLighting !== 'undefined' && (!shading || shading.length !== terrain.length)) {
      shading = BridgeLighting.computeTerrainShading(terrain, level.waterLevel, isSimulating);
      level.terrainShading = shading;
    }
    const yBottom = 0.0; // Baseline floor at y = 0.0 (FUN_004098e0)
    const reliefDepth = 0.9; // _DAT_004185cc

    const startIdx = Math.max(0, Math.floor(minX / 4.0));
    const endIdx   = Math.min(1022, Math.ceil(maxX / 4.0));

    // If visible view extends to the left of column 0, extend terrain to minX
    if (startIdx === 0 && minX < 0) {
      const y0 = terrain[0];
      const s0 = (shading && shading[0] !== undefined) ? shading[0] : 0.2;
      const cTop = [s0, s0, s0, 1.0];
      const cBottom = [0.2, 0.2, 0.2, 1.0];
      const yRelief = y0 * reliefDepth;
      this.addQuad([minX, yRelief], [0, yRelief], [0, y0], [minX, y0], cBottom, cBottom, cTop, cTop);
      this.addQuad([minX, yBottom], [0, yBottom], [0, yRelief], [minX, yRelief], cBottom);
    }

    for (let i = startIdx; i <= endIdx; i++) {
      const x1 = i * 4.0;
      const y1 = terrain[i];
      const x2 = (i + 1) * 4.0;
      const y2 = terrain[i + 1];

      // Per-vertex lighting computed by BridgeLighting (FUN_004098e0)
      const s1 = (shading && shading[i] !== undefined) ? shading[i] : 0.2;
      const s2 = (shading && shading[i + 1] !== undefined) ? shading[i + 1] : 0.2;

      const cTop1 = [s1, s1, s1, 1.0];
      const cTop2 = [s2, s2, s2, 1.0];
      const cBottom = [0.2, 0.2, 0.2, 1.0]; // _DAT_004185d8

      const y1Relief = y1 * reliefDepth;
      const y2Relief = y2 * reliefDepth;

      // Quad 2: Shaded relief ribbon with per-vertex Gouraud lighting gradient
      this.addQuad(
        [x1, y1Relief],
        [x2, y2Relief],
        [x2, y2],
        [x1, y1],
        cBottom, cBottom, cTop2, cTop1
      );

      // Quad 1: Deep ground fill below y * 0.9 in uniform ambient charcoal down to y = 0
      this.addQuad(
        [x1, yBottom],
        [x2, yBottom],
        [x2, y2Relief],
        [x1, y1Relief],
        cBottom
      );
    }

    // If visible view extends to the right of column 1023, extend terrain to maxX
    if (endIdx >= 1022 && maxX > 4092) {
      const yLast = terrain[1023];
      const sLast = (shading && shading[1023] !== undefined) ? shading[1023] : 0.2;
      const cTop = [sLast, sLast, sLast, 1.0];
      const cBottom = [0.2, 0.2, 0.2, 1.0];
      const yRelief = yLast * reliefDepth;
      this.addQuad([4092, yRelief], [maxX, yRelief], [maxX, yLast], [4092, yLast], cBottom, cBottom, cTop, cTop);
      this.addQuad([4092, yBottom], [maxX, yBottom], [maxX, yRelief], [4092, yRelief], cBottom);
    }
  }

  // Build authentic translucent river water (FUN_0040978c: baseline at y = 0.0)
  buildWater(level, minX, maxX, isSimulating = false) {
    const yBottom = 0.0; // Baseline floor at y = 0.0 confirmed by original binary instructions
    // FUN_0040978c:
    // Top vertices: rgba(0.0, 0.0, 0.4, 0.5)
    // Bottom vertices: rgba(0.0, 0.0, 0.1, 0.8) in simulation, rgba(0.0, 0.0, 0.4, 0.5) in editor
    const cTop = [0.0, 0.0, 0.4, 0.5];
    const cBottom = isSimulating ? [0.0, 0.0, 0.1, 0.8] : [0.0, 0.0, 0.4, 0.5];
    this.addQuad(
      [minX, yBottom],
      [maxX, yBottom],
      [maxX, level.waterLevel],
      [minX, level.waterLevel],
      cBottom, cBottom, cTop, cTop
    );
  }

  // Build authentic 2D train cars with per-vertex directional sunlight shading (FUN_00409d78)
  buildTrain(cars) {
    for (let car of cars) {
      const cosA = Math.cos(car.angle);
      const sinA = Math.sin(car.angle);

      // In FUN_00409d78:
      // Computes world position of local vertex (lx, ly), normalizes (dx, dy) from car center,
      // and calculates per-vertex lighting: light = max(0.2, dot(normal, sunDir))
      // Base train color is RGB = (0.2, 0.4, 0.3) (_DAT_004185ec, _DAT_004185f0, _DAT_004185f4)
      const transformAndLight = (lx, ly) => {
        const wx = car.x + lx * cosA - ly * sinA;
        const wy = car.y + lx * sinA + ly * cosA;
        const dx = wx - car.x;
        const dy = wy - car.y;
        let light = 0.2;
        if (typeof BridgeLighting !== 'undefined') {
          light = BridgeLighting.computeTrainVertexLighting(dx, dy);
        } else {
          const len = Math.hypot(dx, dy);
          if (len > 0.0001) {
            const nx = dx / len;
            const ny = dy / len;
            const dot = nx * 0.5 + ny * 0.8660254; // Sun angle 60°
            light = Math.max(0.2, dot);
          }
        }
        const baseColor = (typeof BridgeLighting !== 'undefined') ? BridgeLighting.TRAIN_BASE_COLOR : [0.2, 0.4, 0.3];
        return {
          pos: [wx, wy],
          color: [light * baseColor[0], light * baseColor[1], light * baseColor[2], 1.0]
        };
      };

      if (car.type === 1) {
        // Locomotive: Stepped hood profile with 2 quads (_DAT_004185e4=4.5, _DAT_004185e8=2.1, _DAT_004185f8=1.8, _DAT_004185fc=2.0)
        // Quad 1: Cab
        const v0 = transformAndLight(-4.5, -1.8);
        const v1 = transformAndLight( 2.0, -1.8);
        const v2 = transformAndLight( 2.0,  2.1);
        const v3 = transformAndLight(-4.5,  2.1);
        this.addQuad(v0.pos, v1.pos, v2.pos, v3.pos, v0.color, v1.color, v2.color, v3.color);

        // Quad 2: Front Hood
        const v4 = transformAndLight( 2.0, -1.8);
        const v5 = transformAndLight( 4.5, -1.8);
        const v6 = transformAndLight( 4.5,  0.5); // Authentic bridge.exe locomotive hood top at y = 0.5 (_DAT_00418604)
        const v7 = transformAndLight( 2.0,  2.1);
        this.addQuad(v4.pos, v5.pos, v6.pos, v7.pos, v4.color, v5.color, v6.color, v7.color);
      } else {
        // Freight car: Single flat-topped box quad
        const v0 = transformAndLight(-4.5, -1.8);
        const v1 = transformAndLight( 4.5, -1.8);
        const v2 = transformAndLight( 4.5,  2.1);
        const v3 = transformAndLight(-4.5,  2.1);
        this.addQuad(v0.pos, v1.pos, v2.pos, v3.pos, v0.color, v1.color, v2.color, v3.color);
      }
    }
  }

  // Build authentic 2D bridge beams for simulation (FUN_004094d4 & FUN_0040b020)
  buildBeams(nodes, beams, waterLevel, stressView, isSimulating = true) {
    const halfThick = isSimulating ? this.beamHalfThickness : (this.beamHalfThickness * 0.25);
    const showStress = isSimulating && stressView;

    for (let b of beams) {
      if (b.broken || b.type === 3) continue;
      const n1 = nodes[b.node1], n2 = nodes[b.node2];
      if (!n1 || !n2) continue;

      let color;
      let l1 = 1.0, l2 = 1.0;
      if (showStress) {
        // FUN_004094d4: R = stress, G = 1.0 - stress, B = 0.0
        // b.stress is already min(1.0, |dl| * 8.0) from Wasm physics (00408346)
        const s = Math.min(1.0, Math.max(0.0, b.stress));
        color = [s, 1.0 - s, 0.0, 1.0];
      } else {
        // FUN_004094d4: Deck = 1.0 (0x3f800000), Iron Truss = 0.5 (0x3f000000)
        color = (b.type === 2) ? [1.0, 1.0, 1.0, 1.0] : [0.5, 0.5, 0.5, 1.0];
        if (typeof BridgeLighting !== 'undefined') {
          const lights = BridgeLighting.computeBeamLighting(n1.x, n1.y, n2.x, n2.y);
          l1 = lights.light1;
          l2 = lights.light2;
        } else {
          l1 = (b.light1 !== undefined) ? b.light1 : 1.0;
          l2 = (b.light2 !== undefined) ? b.light2 : 1.0;
        }
      }

      // In FUN_0040b020, unaff_EAX == 0 when stress view is active (explicitly disabling underwater attenuation so colors stay vivid)
      this.addBeamRibbon(n1.x, n1.y, n2.x, n2.y, halfThick, color, waterLevel, l1, l2, !showStress);
    }
  }

  // Port of FUN_0040b470: Editor beams drawn as plain GL_LINES with member colour (no ribbons, no directional lighting, no water attenuation)
  buildEditorBeams(nodes, beams, preview = null) {
    if (!beams || !nodes) return 0;
    const neededFloats = (beams.length + (preview ? 1 : 0)) * 2 * 6;
    if (!this.editorLinesData || this.editorLinesData.length < neededFloats) {
      this.editorLinesData = new Float32Array(Math.max(neededFloats, 12000));
    }
    const d = this.editorLinesData;
    let count = 0;

    for (let i = 0; i < beams.length; i++) {
      const b = beams[i];
      if (b.broken || b.type === 3) continue;
      const n1 = nodes[b.node1], n2 = nodes[b.node2];
      if (!n1 || !n2) continue;

      // FUN_0040b470: Deck = (1.0, 1.0, 1.0, 1.0), Iron Truss = (0.5, 0.5, 0.5, 1.0)
      const color = (b.type === 2) ? [1.0, 1.0, 1.0, 1.0] : [0.5, 0.5, 0.5, 1.0];
      const r = color[0], g = color[1], bCol = color[2], a = color[3];

      const idx = count * 6;
      d[idx]     = n1.x;
      d[idx + 1] = n1.y;
      d[idx + 2] = r;
      d[idx + 3] = g;
      d[idx + 4] = bCol;
      d[idx + 5] = a;

      d[idx + 6] = n2.x;
      d[idx + 7] = n2.y;
      d[idx + 8] = r;
      d[idx + 9] = g;
      d[idx + 10] = bCol;
      d[idx + 11] = a;

      count += 2;
    }
    // Original temporary member participates in the same pre-water/terrain pass.
    if (preview && nodes[preview.from]) {
      const from = nodes[preview.from];
      const c = preview.type === 2 ? 1 : 0.5;
      d.set([from.x, from.y, c, c, c, 1, preview.x, preview.y, c, c, c, 1], count * 6);
      count += 2;
    }
    return count;
  }

  // 0x0040aca0 and 0x0040ae8c. All dimensions are world units. Seven
  // concentric line passes produce the original small selection/hover glow.
  buildEditorFeedback(nodes, beams, selected, visuals = null) {
    if (!this.editorFeedbackData) this.editorFeedbackData = new Float32Array(1536);
    let count = 0;
    const line = (x1, y1, x2, y2, r, g, b, a) => {
      this.editorFeedbackData.set([x1, y1, r, g, b, a, x2, y2, r, g, b, a], count * 6);
      count += 2;
    };
    const joint = (node, selectedJoint) => {
      if (!node) return;
      let s = 0.5;
      for (let pass = 0; pass < 7; pass++) {
        const c = s * 0.5;
        const alpha = (4 - Math.abs(3 - pass)) * 0.25;
        const a = selectedJoint ? alpha : alpha * 0.5;
        const r = selectedJoint ? 0 : 1;
        const b = selectedJoint ? 0 : 1;
        const points = [[-c, s], [c, s], [s, c], [s, -c],
          [c, -s], [-c, -s], [-s, -c], [-s, c]];
        for (let i = 0; i < 8; i++) {
          const p = points[i], q = points[(i + 1) % 8];
          line(node.x + p[0], node.y + p[1], node.x + q[0], node.y + q[1], r, 1, b, a);
        }
        s = Math.fround(s + 0.05);
      }
    };
    joint(nodes[selected], true);
    if (visuals) {
      joint(nodes[visuals.hoveredNode], false);
      const beam = beams[visuals.hoveredBeam];
      if (beam && nodes[beam.node1] && nodes[beam.node2]) {
        const a = nodes[beam.node1], b = nodes[beam.node2];
        const length = Math.hypot(b.x - a.x, b.y - a.y);
        if (length > 0) {
          const nx = (a.y - b.y) / length, ny = (b.x - a.x) / length;
          let offset = 0.25;
          for (let pass = 0; pass < 7; pass++) {
            const alpha = (4 - Math.abs(3 - pass)) * 0.25;
            const c = visuals.deleting ? 1 : 0.5;
            for (const sign of [-1, 1]) {
              const dx = nx * offset * sign, dy = ny * offset * sign;
              line(a.x + dx, a.y + dy, b.x + dx, b.y + dy, c, c, c,
                visuals.deleting ? alpha : alpha * 0.5);
            }
            offset = Math.fround(offset + 0.05);
          }
        }
      }
    }
    return count;
  }

  // Port of FUN_0040a848: authentic clipped-corner octagon editor joints (assembled from 3 quads)
  buildEditorJoints(nodes) {
    const anchorColor = [0.75, 0.75, 0.75, 1.0];
    const jointColor  = [0.5,  0.5,  0.5,  1.0];
    const S = 0.5;  // _DAT_00418614
    const C = 0.25; // S * _DAT_0041861c (0.5 * 0.5 = 0.25)

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.type === 3) continue; // Skip internal train chassis physics nodes

      const color = (n.type === 2) ? anchorColor : jointColor;
      const x = n.x, y = n.y;

      // FUN_0040a848 Quad 1 (top): (x - C, y + S), (x + C, y + S), (x + S, y + C), (x - S, y + C)
      this.addQuad(
        [x - C, y + S],
        [x + C, y + S],
        [x + S, y + C],
        [x - S, y + C],
        color
      );

      // FUN_0040a848 Quad 2 (mid): (x - S, y + C), (x + S, y + C), (x + S, y - C), (x - S, y - C)
      this.addQuad(
        [x - S, y + C],
        [x + S, y + C],
        [x + S, y - C],
        [x - S, y - C],
        color
      );

      // FUN_0040a848 Quad 3 (bot): (x + S, y - C), (x - S, y - C), (x - C, y - S), (x + C, y - S)
      this.addQuad(
        [x + S, y - C],
        [x - S, y - C],
        [x - C, y - S],
        [x + C, y - S],
        color
      );
    }
  }

  initTextPass() {
    const gl = this.gl;
    if (this.fontTexture) return;
    if (typeof window === 'undefined' || !window.BRIDGE_FONT || !window.BRIDGE_FONT.data) {
      return;
    }

    // 1. Create font texture from window.BRIDGE_FONT
    const binary = atob(window.BRIDGE_FONT.data);
    const fontBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) fontBytes[i] = binary.charCodeAt(i);

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      window.BRIDGE_FONT.width,
      window.BRIDGE_FONT.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      fontBytes
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fontTexture = tex;

    // 2. Compile text shader
    const vsSource = `
      attribute vec2 a_position;
      attribute vec2 a_texCoord;
      attribute vec4 a_color;
      varying vec2 v_texCoord;
      varying vec4 v_color;

      void main() {
        // Orthographic projection mapping 640x480 logical coords to NDC [-1, 1]
        float x = a_position.x * (2.0 / 640.0) - 1.0;
        float y = 1.0 - a_position.y * (2.0 / 480.0);
        gl_Position = vec4(x, y, 0.0, 1.0);
        v_texCoord = a_texCoord;
        v_color = a_color;
      }
    `;

    const fsSource = `
      precision mediump float;
      varying vec2 v_texCoord;
      varying vec4 v_color;
      uniform sampler2D u_font;

      void main() {
        vec4 tex = texture2D(u_font, v_texCoord);
        gl_FragColor = vec4(v_color.rgb, v_color.a * tex.a);
      }
    `;

    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s));
      }
      return s;
    };

    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vsSource));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fsSource));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }
    this.textProgram = p;
    this.textAttribs = {
      position: gl.getAttribLocation(p, 'a_position'),
      texCoord: gl.getAttribLocation(p, 'a_texCoord'),
      color: gl.getAttribLocation(p, 'a_color'),
    };
    this.textUniforms = {
      font: gl.getUniformLocation(p, 'u_font'),
    };

    // 3. Buffer setup
    this.textVbo = gl.createBuffer();
    this.maxTextChars = 4096;
    // 6 vertices per char, 8 floats per vertex (pos: 2, tex: 2, color: 4) = 48 floats/char
    this.textVertexData = new Float32Array(this.maxTextChars * 48);
  }

  renderText(commands) {
    if (!this.fontTexture) {
      this.initTextPass();
    }
    if (!this.textProgram || !this.fontTexture || !commands || commands.length === 0) return;
    const gl = this.gl;

    let charCount = 0;
    const vertexData = this.textVertexData;
    let offset = 0;

    for (let cIdx = 0; cIdx < commands.length; cIdx++) {
      const cmd = commands[cIdx];
      if (!cmd || !cmd.text) continue;
      const str = String(cmd.text);
      if (str.length === 0) continue;

      const size = typeof cmd.size === 'number' ? cmd.size : (cmd.size?.width || 16);
      const charW = typeof cmd.size === 'object' ? cmd.size.width : size;
      const charH = typeof cmd.size === 'object' ? cmd.size.height : size;
      const advance = cmd.advance !== undefined ? cmd.advance : charW;
      const color = cmd.color || [0.63, 0.63, 0.63, 1.0];
      const r = color[0], g = color[1], b = color[2], a = color[3] !== undefined ? color[3] : 1.0;

      const totalW = str.length * advance;
      let startX = cmd.x || 0;
      if (cmd.align === 'center') {
        startX = (cmd.x || 0) - totalW * 0.5;
      } else if (cmd.align === 'right') {
        startX = (cmd.x || 0) - totalW;
      }
      const startY = cmd.y || 0;

      const isDisabled = !!cmd.disabled || (r <= 0.35 && g <= 0.35 && b <= 0.35);

      for (let i = 0; i < str.length; i++) {
        if (charCount >= this.maxTextChars) break;
        const code = str.charCodeAt(i);
        const validCode = (code >= 0 && code <= 127) ? code : 63; // '?'

        const col = validCode % 16;
        const row = Math.floor(validCode / 16);
        // Sample texel centers inside each 16x16 cell so linear filtering
        // cannot blend in neighbouring glyphs from the 256x128 atlas.
        const u0 = (col * 16 + 0.5) / 256;
        const u1 = ((col + 1) * 16 - 0.5) / 256;
        const v0 = (row * 16 + 0.5) / 128;
        const v1 = ((row + 1) * 16 - 0.5) / 128;

        const px0 = startX + i * advance;
        const px1 = px0 + charW;
        const py0 = startY;
        const py1 = py0 + charH;

        let glyphR = r;
        let glyphG = g;
        let glyphB = b;
        let glyphA = a;

        if (!isDisabled && typeof cmd.mnemonicIndex === 'number' && i === cmd.mnemonicIndex) {
          glyphR = 1.0;
          glyphG = 1.0;
          glyphB = 1.0;
          glyphA = 1.0;
        }

        // v1: px0, py0, u0, v0
        vertexData[offset++] = px0; vertexData[offset++] = py0;
        vertexData[offset++] = u0;  vertexData[offset++] = v0;
        vertexData[offset++] = glyphR; vertexData[offset++] = glyphG; vertexData[offset++] = glyphB; vertexData[offset++] = glyphA;

        // v2: px0, py1, u0, v1
        vertexData[offset++] = px0; vertexData[offset++] = py1;
        vertexData[offset++] = u0;  vertexData[offset++] = v1;
        vertexData[offset++] = glyphR; vertexData[offset++] = glyphG; vertexData[offset++] = glyphB; vertexData[offset++] = glyphA;

        // v3: px1, py0, u1, v0
        vertexData[offset++] = px1; vertexData[offset++] = py0;
        vertexData[offset++] = u1;  vertexData[offset++] = v0;
        vertexData[offset++] = glyphR; vertexData[offset++] = glyphG; vertexData[offset++] = glyphB; vertexData[offset++] = glyphA;

        // v4: px1, py0, u1, v0
        vertexData[offset++] = px1; vertexData[offset++] = py0;
        vertexData[offset++] = u1;  vertexData[offset++] = v0;
        vertexData[offset++] = glyphR; vertexData[offset++] = glyphG; vertexData[offset++] = glyphB; vertexData[offset++] = glyphA;

        // v5: px0, py1, u0, v1
        vertexData[offset++] = px0; vertexData[offset++] = py1;
        vertexData[offset++] = u0;  vertexData[offset++] = v1;
        vertexData[offset++] = glyphR; vertexData[offset++] = glyphG; vertexData[offset++] = glyphB; vertexData[offset++] = glyphA;

        // v6: px1, py1, u1, v1
        vertexData[offset++] = px1; vertexData[offset++] = py1;
        vertexData[offset++] = u1;  vertexData[offset++] = v1;
        vertexData[offset++] = glyphR; vertexData[offset++] = glyphG; vertexData[offset++] = glyphB; vertexData[offset++] = glyphA;

        charCount++;
      }
    }

    if (charCount === 0) return;

    gl.useProgram(this.textProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textVbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertexData.subarray(0, charCount * 48), gl.DYNAMIC_DRAW);

    const stride = 8 * 4;
    gl.enableVertexAttribArray(this.textAttribs.position);
    gl.vertexAttribPointer(this.textAttribs.position, 2, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(this.textAttribs.texCoord);
    gl.vertexAttribPointer(this.textAttribs.texCoord, 2, gl.FLOAT, false, stride, 8);

    gl.enableVertexAttribArray(this.textAttribs.color);
    gl.vertexAttribPointer(this.textAttribs.color, 4, gl.FLOAT, false, stride, 16);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fontTexture);
    gl.uniform1i(this.textUniforms.font, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.drawArrays(gl.TRIANGLES, 0, charCount * 6);

    // Restore state
    gl.disableVertexAttribArray(this.textAttribs.texCoord);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  render(engine, viewX, viewY, zoom, stressView, textCommands = [], screenMode = 'editor', editorVisuals = null) {
    const gl = this.gl;
    const canvas = this.canvas;

    gl.viewport(0, 0, canvas.width, canvas.height);

    if (screenMode === 'home' || screenMode === 'levels' || screenMode === 'readme') {
      gl.clearColor(0.0, 0.0, 0.0, 1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (textCommands && textCommands.length > 0) {
        this.renderText(textCommands);
      }
      return;
    }

    // FUN_00401aa4 sets (0.12, 0.1275, 0.15) for editor mode; FUN_00403030 sets (0.256, 0.272, 0.320) for simulation mode
    if (screenMode === 'simulation' || (engine && engine.simulationActive)) {
      gl.clearColor(0.256, 0.272, 0.320, 1.0);
    } else {
      gl.clearColor(0.12, 0.1275, 0.15, 1.0);
    }
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!engine) {
      if (textCommands && textCommands.length > 0) {
        this.renderText(textCommands);
      }
      return;
    }

    this.beginScene();

    const halfW = 320.0 / zoom;
    const halfH = 240.0 / zoom;
    const minX = Math.max(-500.0, viewX - halfW - 20.0);
    const maxX = Math.min(4600.0, viewX + halfW + 20.0);

    const isSimulating = engine.simulationActive;
    const isStress = isSimulating && stressView;
    const nodes = engine.nodes;
    const beams = engine.beams;

    // Authentic draw order matching bridge.exe (FUN_0040978c -> FUN_004098e0):
    // 1. Train is ALWAYS drawn first (FUN_00409d78 at line 1000) before water and terrain
    if (engine.trainActive) {
      this.buildTrain(engine.trainCars);
    }

    if (isSimulating && !isStress) {
      // 2. Beams (normal shaded view during simulation)
      this.buildBeams(nodes, beams, engine.level.waterLevel, false, true);
    }

    // 3. Water quad (behind land)
    this.buildWater(engine.level, minX, maxX, isSimulating);

    // 4. Terrain quads (in front of water)
    this.buildTerrain(engine.level, minX, maxX, isSimulating);

    if (isSimulating && isStress) {
      // 5. Beams (foreground stress pass during simulation)
      this.buildBeams(nodes, beams, engine.level.waterLevel, true, true);
    }

    // 6. Editor joints pass (FUN_0040a848) - ONLY in editor mode, omitted during simulation
    if (!isSimulating) {
      this.buildEditorJoints(nodes);
    }

    // 2D Orthographic Projection Matrix matching screen coordinates exactly
    const l = viewX - halfW;
    const r = viewX + halfW;
    const b = viewY - halfH;
    const t = viewY + halfH;

    const mat = new Float32Array([
      2.0 / (r - l), 0, 0, 0,
      0, 2.0 / (t - b), 0, 0,
      0, 0, -1.0, 0,
      -(r + l) / (r - l), -(t + b) / (t - b), 0, 1.0
    ]);

    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uniforms.viewProjection, false, mat);

    const stride = this.vertexStride;

    // 0. Editor Background Grid & Limit Lines (FUN_00401aa4:510-574)
    if (!isSimulating && engine.generateGrid) {
      const gridCount = engine.generateGrid(
        viewX,
        viewY,
        halfW,
        engine.level.leftLimit,
        engine.level.rightLimit,
        // 0x004022f7: limits require the special editor mode and held B.
        // The shipped game's normal bridge editor does not display them.
        false
      );
      if (gridCount > 0) {
        const gridData = engine.getGridVertexData(gridCount);
        if (gridData) {
          if (!this.gridVbo) this.gridVbo = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, this.gridVbo);
          gl.bufferData(gl.ARRAY_BUFFER, gridData, gl.DYNAMIC_DRAW);

          gl.enableVertexAttribArray(this.attribs.position);
          gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, stride, 0);

          gl.enableVertexAttribArray(this.attribs.color);
          gl.vertexAttribPointer(this.attribs.color, 4, gl.FLOAT, false, stride, 8);

          gl.drawArrays(gl.LINES, 0, gridCount);
        }
      }
    }

    // 0b. Editor Beams Pass (FUN_0040b470: GL_LINES pass before water and terrain)
    if (!isSimulating) {
      const beamLineCount = this.buildEditorBeams(nodes, beams, editorVisuals?.preview);
      if (beamLineCount > 0) {
        if (!this.editorLinesVbo) this.editorLinesVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.editorLinesVbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.editorLinesData.subarray(0, beamLineCount * 6), gl.DYNAMIC_DRAW);

        gl.enableVertexAttribArray(this.attribs.position);
        gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, stride, 0);

        gl.enableVertexAttribArray(this.attribs.color);
        gl.vertexAttribPointer(this.attribs.color, 4, gl.FLOAT, false, stride, 8);

        gl.drawArrays(gl.LINES, 0, beamLineCount);
      }
    }

    // Upload & Draw Scene Triangles (train, simulation beams, water, terrain, editor joints)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.vertexData.subarray(0, this.vertexCount * 6));

    gl.enableVertexAttribArray(this.attribs.position);
    gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, stride, 0);

    gl.enableVertexAttribArray(this.attribs.color);
    gl.vertexAttribPointer(this.attribs.color, 4, gl.FLOAT, false, stride, 8);

    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);

    // Original highlights follow water, terrain and joints, and precede UI text.
    if (!isSimulating) {
      const count = this.buildEditorFeedback(nodes, beams, engine.editorSelection, editorVisuals);
      if (count > 0) {
        if (!this.editorFeedbackVbo) this.editorFeedbackVbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, this.editorFeedbackVbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.editorFeedbackData.subarray(0, count * 6), gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(this.attribs.position);
        gl.vertexAttribPointer(this.attribs.position, 2, gl.FLOAT, false, stride, 0);
        gl.enableVertexAttribArray(this.attribs.color);
        gl.vertexAttribPointer(this.attribs.color, 4, gl.FLOAT, false, stride, 8);
        gl.drawArrays(gl.LINES, 0, count);
      }
    }

    // Bitmap Text Pass
    if (textCommands && textCommands.length > 0) {
      this.renderText(textCommands);
    }
  }
}

if (typeof window !== 'undefined') {
  window.WebGLRenderer = WebGLRenderer;
}
