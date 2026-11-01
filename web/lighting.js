// Dedicated rendering module for Bridge Builder lighting and shading calculations.
// Replicates original routines from bridge.exe (2000):
// - FUN_004098e0: Terrain relief lighting & underwater extinction
// - FUN_00409d78: Train per-vertex directional sunlight
// - FUN_0040b020: Beam ribbon directional sunlight & underwater attenuation

const BridgeLighting = {
  // Sunlight direction vector at 60 deg elevation (cos 60°, sin 60°)
  SUN_DIR_X: 0.5,
  SUN_DIR_Y: 0.8660254037844386,

  // Ambient lighting floor (unaff_EAX clamping in original routines)
  AMBIENT_FLOOR: 0.2,

  // Base relief shading scale in FUN_004098e0
  TERRAIN_SHADE_SCALE: 0.2,

  // Depth extinction rate per world unit below waterLevel (0.02)
  UNDERWATER_EXTINCTION: 0.02,

  // Base train car color RGB (_DAT_004185ec, _DAT_004185f0, _DAT_004185f4)
  TRAIN_BASE_COLOR: [0.2, 0.4, 0.3],

  // Underwater light attenuation factor for a given Y position
  computeUnderwaterAttenuation(y, waterLevel) {
    if (waterLevel === undefined || waterLevel === null || y >= waterLevel) {
      return 1.0;
    }
    const depth = waterLevel - y;
    return Math.max(0.0, 1.0 - depth * this.UNDERWATER_EXTINCTION);
  },

  // Directional sunlight dot product clamped to ambient floor
  computeDirectionalLight(nx, ny) {
    const dot = nx * this.SUN_DIR_X + ny * this.SUN_DIR_Y;
    return Math.max(this.AMBIENT_FLOOR, dot);
  },

  // Beam ribbon sunlight factors for top side (+nx, +ny) and bottom side (-nx, -ny) (FUN_0040b020)
  computeBeamLighting(x1, y1, x2, y2) {
    const dy = y1 - y2;
    const dx = x2 - x1;
    const len = Math.hypot(dx, dy);
    if (len < 0.001) {
      return { light1: 1.0, light2: 1.0 };
    }
    const nx = dy / len;
    const ny = dx / len;
    const dot = nx * this.SUN_DIR_X + ny * this.SUN_DIR_Y;
    const l1 = Math.max(this.AMBIENT_FLOOR, dot);
    const l2 = Math.max(this.AMBIENT_FLOOR, -dot);
    return { light1: l1, light2: l2 };
  },

  // Per-vertex directional train sunlight shading (FUN_00409d78)
  computeTrainVertexLighting(dx, dy) {
    const len = Math.hypot(dx, dy);
    if (len < 0.0001) {
      return this.AMBIENT_FLOOR;
    }
    const nx = dx / len;
    const ny = dy / len;
    const dot = nx * this.SUN_DIR_X + ny * this.SUN_DIR_Y;
    return Math.max(this.AMBIENT_FLOOR, dot);
  },

  // Terrain relief Gouraud vertex shading buffer for 1024 columns (FUN_004098e0)
  computeTerrainShading(terrain, waterLevel, isSimulating, targetBuffer = null) {
    const count = terrain.length;
    const shading = targetBuffer || new Float32Array(count);

    if (!isSimulating) {
      // Editor mode: uniform 0.2 ambient shading
      for (let i = 0; i < count; i++) {
        shading[i] = this.TERRAIN_SHADE_SCALE;
      }
      return shading;
    }

    for (let i = 0; i < count; i++) {
      const iPrev = i > 0 ? i - 1 : 0;
      const iNext = i < count - 1 ? i + 1 : count - 1;

      const dy1 = terrain[iPrev] - terrain[i];
      const len1 = Math.hypot(dy1, 4.0);
      const ny1 = dy1 / len1;
      const nx1 = 4.0 / len1;

      const dy2 = terrain[i] - terrain[iNext];
      const len2 = Math.hypot(dy2, 4.0);
      const ny2 = dy2 / len2;
      const nx2 = 4.0 / len2;

      const ny = ny1 + ny2;
      const nx = nx1 + nx2;
      let dot = ny * this.SUN_DIR_X + nx * this.SUN_DIR_Y;
      if (dot < this.AMBIENT_FLOOR) {
        dot = this.AMBIENT_FLOOR;
      }

      const y = terrain[i];
      const atten = this.computeUnderwaterAttenuation(y, waterLevel);
      shading[i] = dot * atten * this.TERRAIN_SHADE_SCALE;
    }
    return shading;
  }
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BridgeLighting;
}
if (typeof window !== 'undefined') {
  window.BridgeLighting = BridgeLighting;
}
