(function exposeGameConfig(root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.GAME_CONFIG = factory();
  }
})(typeof self !== 'undefined' ? self : this, function createConfig() {
  const COLORS = [
    '#5ee7ff', '#ff6b6b', '#ffe66d', '#8aff80', '#b17dff',
    '#ff9f43', '#4dabf7', '#f06595', '#63e6be', '#ffd43b'
  ];

  const walls = [
    // Outer arena boundaries
    { id: 'north-wall', x: 0, z: -50, w: 104, d: 4, h: 6, type: 'wall' },
    { id: 'south-wall', x: 0, z: 50, w: 104, d: 4, h: 6, type: 'wall' },
    { id: 'west-wall', x: -50, z: 0, w: 4, d: 104, h: 6, type: 'wall' },
    { id: 'east-wall', x: 50, z: 0, w: 4, d: 104, h: 6, type: 'wall' },

    // Mid map cover blocks
    { id: 'center-core-a', x: -6, z: 0, w: 5, d: 16, h: 4.5, type: 'cover' },
    { id: 'center-core-b', x: 6, z: 0, w: 5, d: 16, h: 4.5, type: 'cover' },
    { id: 'center-short-a', x: 0, z: -10, w: 16, d: 4, h: 3.5, type: 'cover' },
    { id: 'center-short-b', x: 0, z: 10, w: 16, d: 4, h: 3.5, type: 'cover' },

    // L-shaped lanes
    { id: 'north-lane-left', x: -27, z: -26, w: 4, d: 22, h: 3.5, type: 'cover' },
    { id: 'north-lane-top', x: -18, z: -36, w: 22, d: 4, h: 3.5, type: 'cover' },
    { id: 'north-lane-right', x: 27, z: -26, w: 4, d: 22, h: 3.5, type: 'cover' },
    { id: 'north-lane-top-r', x: 18, z: -36, w: 22, d: 4, h: 3.5, type: 'cover' },

    { id: 'south-lane-left', x: -27, z: 26, w: 4, d: 22, h: 3.5, type: 'cover' },
    { id: 'south-lane-bottom', x: -18, z: 36, w: 22, d: 4, h: 3.5, type: 'cover' },
    { id: 'south-lane-right', x: 27, z: 26, w: 4, d: 22, h: 3.5, type: 'cover' },
    { id: 'south-lane-bottom-r', x: 18, z: 36, w: 22, d: 4, h: 3.5, type: 'cover' },

    // Smaller cover crates
    { id: 'crate-nw-1', x: -34, z: -8, w: 5, d: 5, h: 3, type: 'crate' },
    { id: 'crate-nw-2', x: -39, z: 8, w: 5, d: 5, h: 3, type: 'crate' },
    { id: 'crate-ne-1', x: 34, z: -8, w: 5, d: 5, h: 3, type: 'crate' },
    { id: 'crate-ne-2', x: 39, z: 8, w: 5, d: 5, h: 3, type: 'crate' },
    { id: 'crate-sw-1', x: -14, z: 27, w: 5, d: 5, h: 3, type: 'crate' },
    { id: 'crate-se-1', x: 14, z: -27, w: 5, d: 5, h: 3, type: 'crate' },
    { id: 'crate-west-mid', x: -33, z: 0, w: 4, d: 10, h: 3, type: 'crate' },
    { id: 'crate-east-mid', x: 33, z: 0, w: 4, d: 10, h: 3, type: 'crate' }
  ];

  const spawns = [
    { x: -40, z: -40, yaw: Math.PI * 0.75 },
    { x: 40, z: 40, yaw: -Math.PI * 0.25 },
    { x: 40, z: -40, yaw: -Math.PI * 0.75 },
    { x: -40, z: 40, yaw: Math.PI * 0.25 },
    { x: 0, z: -42, yaw: 0 },
    { x: 0, z: 42, yaw: Math.PI },
    { x: -42, z: 0, yaw: Math.PI * 0.5 },
    { x: 42, z: 0, yaw: -Math.PI * 0.5 }
  ];

  const pickups = [
    { id: 'hp-center-n', type: 'health', x: 0, z: -22 },
    { id: 'hp-center-s', type: 'health', x: 0, z: 22 },
    { id: 'shield-west', type: 'shield', x: -43, z: 0 },
    { id: 'shield-east', type: 'shield', x: 43, z: 0 },
    { id: 'speed-nw', type: 'speed', x: -22, z: -18 },
    { id: 'speed-se', type: 'speed', x: 22, z: 18 },
    { id: 'speed-ne', type: 'speed', x: 22, z: -18 },
    { id: 'speed-sw', type: 'speed', x: -22, z: 18 }
  ];

  return {
    arena: {
      width: 100,
      depth: 100,
      floorY: 0
    },
    networking: {
      tickRate: 30,
      broadcastRate: 15,
      inputRate: 30
    },
    match: {
      durationMs: 5 * 60 * 1000,
      maxPlayers: 8,
      minPlayersToStart: 1,
      respawnMs: 2500
    },
    player: {
      radius: 0.62,
      height: 1.8,
      cameraHeight: 1.58,
      baseSpeed: 7.8,
      sprintMultiplier: 1.18,
      speedBoostMultiplier: 1.38,
      maxHealth: 100,
      maxShield: 75,
      startingShield: 25,
      jumpVisualHeight: 0.06
    },
    weapon: {
      cooldownMs: 210,
      damage: 24,
      headshotDamage: 48,
      range: 72,
      spread: 0.0035,
      name: 'Pulse Rifle'
    },
    pickups: {
      radius: 1.45,
      respawnMs: 14000,
      healthAmount: 40,
      shieldAmount: 35,
      speedDurationMs: 6500
    },
    walls,
    spawns,
    pickups,
    colors: COLORS
  };
});
