import * as THREE from 'three';

const CONFIG = window.GAME_CONFIG;
const socket = io({ transports: ['websocket', 'polling'] });

const $ = (id) => document.getElementById(id);

const dom = {
  menu: $('menu'),
  lobby: $('lobby'),
  game: $('game'),
  canvas: $('gameCanvas'),
  nameInput: $('nameInput'),
  roomInput: $('roomInput'),
  createBtn: $('createBtn'),
  joinBtn: $('joinBtn'),
  roomCode: $('roomCode'),
  lobbyPlayers: $('lobbyPlayers'),
  startBtn: $('startBtn'),
  hostHint: $('hostHint'),
  copyLinkBtn: $('copyLinkBtn'),
  leaveBtn: $('leaveBtn'),
  hudRoom: $('hudRoom'),
  timer: $('timer'),
  ping: $('ping'),
  hpBar: $('hpBar'),
  shieldBar: $('shieldBar'),
  hpText: $('hpText'),
  shieldText: $('shieldText'),
  killFeed: $('killFeed'),
  scoreRows: $('scoreRows'),
  scoreboard: $('scoreboard'),
  deathScreen: $('deathScreen'),
  respawnText: $('respawnText'),
  endScreen: $('endScreen'),
  winnerText: $('winnerText'),
  backToLobbyBtn: $('backToLobbyBtn'),
  playPrompt: $('playPrompt'),
  hitmarker: $('hitmarker'),
  damageVignette: $('damageVignette'),
  toast: $('toast')
};

let selfId = null;
let currentRoomId = null;
let roomState = null;
let connectedAt = performance.now();
let lastPingSentAt = 0;
let estimatedPing = 0;

let renderer = null;
let scene = null;
let camera = null;
let clock = null;
let floorGrid = null;
let weaponGroup = null;
let muzzleFlash = null;
let ambientParticles = [];
let tracerEffects = [];
let impactEffects = [];
let playerMeshes = new Map();
let pickupMeshes = new Map();
let nameTextureCache = new Map();

let local = {
  ready: false,
  x: 0,
  z: 0,
  y: CONFIG.player.cameraHeight,
  serverX: 0,
  serverZ: 0,
  alive: false,
  hp: CONFIG.player.maxHealth,
  shield: CONFIG.player.startingShield
};

let yaw = 0;
let pitch = 0;
let inputSeq = 0;
let lastHudUpdate = 0;
let lastScoreUpdate = 0;
let lastStateAt = performance.now();

const keys = {
  w: false,
  a: false,
  s: false,
  d: false,
  up: false,
  left: false,
  down: false,
  right: false,
  shift: false,
  tab: false
};
let mouseDown = false;
let pointerLocked = false;

const safeLocalStorage = {
  get(key, fallback = '') {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  }
};

dom.nameInput.value = safeLocalStorage.get('fps-name', `Player${Math.floor(Math.random() * 900 + 100)}`);
const params = new URLSearchParams(window.location.search);
if (params.get('room')) dom.roomInput.value = params.get('room').toUpperCase();

function showSection(section) {
  dom.menu.classList.toggle('hidden', section !== 'menu');
  dom.lobby.classList.toggle('hidden', section !== 'lobby');
  dom.game.classList.toggle('hidden', section !== 'game');
}

function toast(message, timeout = 2400) {
  dom.toast.textContent = message;
  dom.toast.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => dom.toast.classList.add('hidden'), timeout);
}

function getName() {
  const name = dom.nameInput.value.trim().slice(0, 16) || 'Player';
  safeLocalStorage.set('fps-name', name);
  return name;
}

function createRoom() {
  socket.emit('createRoom', { name: getName() });
}

function joinRoom() {
  const roomId = dom.roomInput.value.trim().toUpperCase();
  if (!roomId) {
    toast('Enter a room code first.');
    return;
  }
  socket.emit('joinRoom', { roomId, name: getName() });
}

dom.createBtn.addEventListener('click', createRoom);
dom.joinBtn.addEventListener('click', joinRoom);
dom.roomInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') joinRoom();
});
dom.nameInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') createRoom();
});
dom.startBtn.addEventListener('click', () => socket.emit('startGame'));
dom.leaveBtn.addEventListener('click', () => socket.emit('leaveRoom'));
dom.copyLinkBtn.addEventListener('click', async () => {
  if (!currentRoomId) return;
  const link = `${window.location.origin}${window.location.pathname}?room=${currentRoomId}`;
  try {
    await navigator.clipboard.writeText(link);
    toast('Invite link copied.');
  } catch {
    toast(link, 5000);
  }
});
dom.backToLobbyBtn.addEventListener('click', () => {
  socket.emit('returnToLobby');
  dom.endScreen.classList.add('hidden');
});

socket.on('connect', () => {
  connectedAt = performance.now();
  toast('Connected to server.');
});

socket.on('connected', ({ id }) => {
  selfId = id;
});

socket.on('disconnect', () => {
  toast('Disconnected. Reconnecting...');
});

socket.on('serverError', ({ message }) => toast(message || 'Server error.'));

socket.on('roomJoined', (state) => {
  selfId = state.selfId || selfId;
  applyRoomState(state);
  currentRoomId = state.roomId;
  showLobby(state);
});

socket.on('leftRoom', () => {
  currentRoomId = null;
  roomState = null;
  local.ready = false;
  showSection('menu');
});

socket.on('roomState', (state) => {
  applyRoomState(state);
  if (!state || !state.roomId) return;
  if (state.state === 'playing') {
    showGame();
  } else if (state.state === 'lobby') {
    showLobby(state);
  } else if (state.state === 'ended') {
    showGame();
    showEndScreen(state);
  }
});

socket.on('matchStarted', (state) => {
  applyRoomState(state);
  showGame();
  dom.endScreen.classList.add('hidden');
  dom.deathScreen.classList.add('hidden');
  toast('Match started. Click the game to lock mouse.');
});

socket.on('matchEnded', (state) => {
  applyRoomState(state);
  showEndScreen(state);
});

socket.on('killFeed', (item) => addFeedItem(item));

socket.on('shotFired', (payload) => {
  createTracer(payload);
  if (payload.shooterId === selfId) {
    pulseWeapon();
  }
});

socket.on('playerDamaged', (payload) => {
  if (payload.shooterId === selfId && payload.targetId !== selfId) {
    showHitmarker(payload.headshot);
  }
  if (payload.targetId === selfId) {
    flashDamage();
  }
});

socket.on('playerKilled', (payload) => {
  if (payload.victimId === selfId) {
    mouseDown = false;
    flashDamage(500);
  }
});

socket.on('pickupCollected', ({ id, type, by }) => {
  const mesh = pickupMeshes.get(id);
  if (mesh) mesh.visible = false;
  if (by === selfId) {
    const text = type === 'health' ? 'Health restored.' : type === 'shield' ? 'Shield charged.' : 'Speed boost active.';
    toast(text, 1200);
  }
});

socket.on('pickupRespawned', ({ id }) => {
  const mesh = pickupMeshes.get(id);
  if (mesh) mesh.visible = true;
});

function applyRoomState(state) {
  if (!state) return;
  roomState = state;
  currentRoomId = state.roomId;
  lastStateAt = performance.now();

  const self = getSelfPlayer();
  if (self) {
    if (!local.ready) {
      local.ready = true;
      local.x = self.x;
      local.z = self.z;
      local.serverX = self.x;
      local.serverZ = self.z;
      yaw = self.yaw || 0;
      pitch = self.pitch || 0;
    } else {
      local.serverX = self.x;
      local.serverZ = self.z;
      const dist = Math.hypot(local.x - self.x, local.z - self.z);
      if (dist > 4 || !self.alive) {
        local.x = self.x;
        local.z = self.z;
      }
    }
    local.alive = self.alive;
    local.hp = self.hp;
    local.shield = self.shield;
  }
}

function showLobby(state = roomState) {
  if (!state) return;
  currentRoomId = state.roomId;
  showSection('lobby');
  dom.roomCode.textContent = state.roomId;
  renderLobbyPlayers(state);
  const isHost = state.hostId === selfId;
  dom.startBtn.disabled = !isHost;
  dom.hostHint.textContent = isHost ? 'You are the host.' : 'Only the host can start.';
  dom.startBtn.textContent = state.state === 'ended' ? 'Start New Match' : 'Start Match';
}

function renderLobbyPlayers(state) {
  const players = [...(state.players || [])].sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  dom.lobbyPlayers.innerHTML = players.map((p) => `
    <div class="player-item">
      <div class="player-left">
        <span class="avatar-dot" style="background:${p.color}; color:${p.color}"></span>
        <strong>${escapeHtml(p.name)}</strong>
      </div>
      ${p.id === state.hostId ? '<span class="host-badge">HOST</span>' : ''}
    </div>
  `).join('');
}

function showGame() {
  showSection('game');
  if (!renderer) initThree();
  dom.hudRoom.textContent = currentRoomId || '-----';
  dom.playPrompt.classList.toggle('hidden', pointerLocked);
}

function showEndScreen(state = roomState) {
  if (!state) return;
  const players = [...state.players].sort((a, b) => b.score - a.score || b.kills - a.kills);
  const winner = players[0];
  dom.endScreen.classList.remove('hidden');
  dom.deathScreen.classList.add('hidden');
  const lines = players.slice(0, 5).map((p, i) => `${i + 1}. ${escapeHtml(p.name)} — ${p.score} pts (${p.kills}/${p.deaths})`).join('<br>');
  dom.winnerText.innerHTML = winner ? `<strong style="color:${winner.color}">${escapeHtml(winner.name)}</strong> wins.<br>${lines}` : 'No players.';
  dom.backToLobbyBtn.disabled = state.hostId !== selfId;
  dom.backToLobbyBtn.textContent = state.hostId === selfId ? 'Back to Lobby' : 'Waiting for host...';
}

function escapeHtml(str) {
  return String(str).replace(/[&<>'"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[ch]));
}

function initThree() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080f);
  scene.fog = new THREE.FogExp2(0x05080f, 0.016);

  camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 220);
  camera.rotation.order = 'YXZ';
  scene.add(camera);

  renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.45));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  clock = new THREE.Clock();

  const hemi = new THREE.HemisphereLight(0x9fdcff, 0x11243d, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 1.25);
  sun.position.set(-24, 42, 16);
  scene.add(sun);

  buildArena();
  buildPickups();
  buildWeapon();
  buildAmbientParticles();

  window.addEventListener('resize', resizeRenderer);
  dom.canvas.addEventListener('click', () => {
    if (roomState?.state === 'playing') dom.canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    pointerLocked = document.pointerLockElement === dom.canvas;
    dom.playPrompt.classList.toggle('hidden', pointerLocked || roomState?.state !== 'playing');
  });
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', (event) => { if (pointerLocked && event.button === 0) mouseDown = true; });
  document.addEventListener('mouseup', (event) => { if (event.button === 0) mouseDown = false; });
  document.addEventListener('contextmenu', (event) => { if (pointerLocked) event.preventDefault(); });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  animate();
}

function buildArena() {
  const floorGeo = new THREE.PlaneGeometry(CONFIG.arena.width, CONFIG.arena.depth, 20, 20);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x0b1320, roughness: 0.9, metalness: 0.05 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0;
  scene.add(floor);

  floorGrid = new THREE.GridHelper(CONFIG.arena.width, 50, 0x1a8cff, 0x163048);
  floorGrid.material.transparent = true;
  floorGrid.material.opacity = 0.24;
  floorGrid.position.y = 0.012;
  scene.add(floorGrid);

  const wallMats = {
    wall: new THREE.MeshStandardMaterial({ color: 0x17233a, roughness: 0.82, metalness: 0.08 }),
    cover: new THREE.MeshStandardMaterial({ color: 0x25314d, roughness: 0.74, metalness: 0.1 }),
    crate: new THREE.MeshStandardMaterial({ color: 0x2f405e, roughness: 0.82, metalness: 0.06 })
  };

  for (const wall of CONFIG.walls) {
    const geo = new THREE.BoxGeometry(wall.w, wall.h, wall.d);
    const mesh = new THREE.Mesh(geo, wallMats[wall.type] || wallMats.cover);
    mesh.position.set(wall.x, wall.h / 2, wall.z);
    mesh.userData.kind = 'wall';
    scene.add(mesh);

    if (wall.type !== 'wall') {
      const edge = new THREE.LineSegments(
        new THREE.EdgesGeometry(geo),
        new THREE.LineBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.14 })
      );
      edge.position.copy(mesh.position);
      scene.add(edge);
    }
  }

  const ringGeo = new THREE.TorusGeometry(10.5, 0.08, 8, 120);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.28 });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  scene.add(ring);
}

function buildPickups() {
  for (const pickup of CONFIG.pickups) {
    const group = new THREE.Group();
    group.position.set(pickup.x, 0.55, pickup.z);
    const color = pickup.type === 'health' ? 0xff5364 : pickup.type === 'shield' ? 0x5ee7ff : 0x8aff80;
    const geo = pickup.type === 'speed'
      ? new THREE.OctahedronGeometry(0.75, 0)
      : new THREE.IcosahedronGeometry(0.72, 0);
    const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.12 });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.2, 0.035, 8, 48),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 })
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = -0.42;
    group.add(halo);

    scene.add(group);
    pickupMeshes.set(pickup.id, group);
  }
}

function buildWeapon() {
  weaponGroup = new THREE.Group();
  weaponGroup.position.set(0.35, -0.33, -0.7);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.22, 0.72),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.55, metalness: 0.35 })
  );
  body.position.set(0, 0, 0.02);
  weaponGroup.add(body);

  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.07, 0.56, 12),
    new THREE.MeshStandardMaterial({ color: 0x88dfff, emissive: 0x113344, roughness: 0.32, metalness: 0.6 })
  );
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.04, -0.46);
  weaponGroup.add(barrel);

  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.38, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7, metalness: 0.15 })
  );
  grip.position.set(0.06, -0.25, 0.18);
  grip.rotation.x = -0.24;
  weaponGroup.add(grip);

  muzzleFlash = new THREE.PointLight(0x5ee7ff, 0, 5);
  muzzleFlash.position.set(0, 0.04, -0.8);
  weaponGroup.add(muzzleFlash);

  camera.add(weaponGroup);
}

function buildAmbientParticles() {
  const geo = new THREE.SphereGeometry(0.025, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.28 });
  for (let i = 0; i < 70; i += 1) {
    const p = new THREE.Mesh(geo, mat);
    p.position.set((Math.random() - 0.5) * 92, Math.random() * 4 + 0.8, (Math.random() - 0.5) * 92);
    p.userData.seed = Math.random() * Math.PI * 2;
    scene.add(p);
    ambientParticles.push(p);
  }
}

function resizeRenderer() {
  if (!renderer || !camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function onMouseMove(event) {
  if (!pointerLocked || roomState?.state !== 'playing') return;
  const sensitivity = 0.0021;
  yaw -= event.movementX * sensitivity;
  pitch -= event.movementY * sensitivity;
  pitch = clamp(pitch, -1.25, 1.25);
}

function onKeyDown(event) {
  if (event.code === 'Tab') {
    event.preventDefault();
    keys.tab = true;
    dom.scoreboard.classList.remove('hidden');
    return;
  }
  setKey(event.code, true);
}

function onKeyUp(event) {
  if (event.code === 'Tab') {
    event.preventDefault();
    keys.tab = false;
    dom.scoreboard.classList.add('hidden');
    return;
  }
  setKey(event.code, false);
}

function setKey(code, value) {
  switch (code) {
    case 'KeyW': keys.w = value; break;
    case 'KeyA': keys.a = value; break;
    case 'KeyS': keys.s = value; break;
    case 'KeyD': keys.d = value; break;
    case 'ArrowUp': keys.up = value; break;
    case 'ArrowLeft': keys.left = value; break;
    case 'ArrowDown': keys.down = value; break;
    case 'ArrowRight': keys.right = value; break;
    case 'ShiftLeft':
    case 'ShiftRight': keys.shift = value; break;
    case 'Space':
      if (pointerLocked) {
        mouseDown = value;
      }
      break;
    default: break;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = performance.now() / 1000;

  if (roomState?.state === 'playing') {
    predictLocal(dt);
    updateCamera(dt, t);
    updatePlayers(dt);
    updatePickups(t);
    updateEffects(dt);
    updateHudThrottled();
  } else {
    updateEffects(dt);
  }

  for (const p of ambientParticles) {
    p.position.y += Math.sin(t * 1.4 + p.userData.seed) * 0.002;
  }

  if (renderer && scene && camera) renderer.render(scene, camera);
}

function predictLocal(dt) {
  const self = getSelfPlayer();
  if (!self || !local.ready) return;
  if (!self.alive) {
    local.x += (self.x - local.x) * 0.18;
    local.z += (self.z - local.z) * 0.18;
    return;
  }

  const input = currentInput();
  let forward = input.forward;
  let strafe = input.strafe;
  const length = Math.hypot(forward, strafe);
  if (length > 1) {
    forward /= length;
    strafe /= length;
  }

  let speed = CONFIG.player.baseSpeed;
  if (input.sprint) speed *= CONFIG.player.sprintMultiplier;
  if (self.speedBoost) speed *= CONFIG.player.speedBoostMultiplier;

  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);

  const next = resolveCircleWalls(
    local.x + (fx * forward + rx * strafe) * speed * dt,
    local.z + (fz * forward + rz * strafe) * speed * dt,
    CONFIG.player.radius
  );

  local.x = next.x;
  local.z = next.z;

  const serverError = Math.hypot(local.x - self.x, local.z - self.z);
  if (serverError > 0.05) {
    const correction = serverError > 2.2 ? 0.25 : 0.055;
    local.x += (self.x - local.x) * correction;
    local.z += (self.z - local.z) * correction;
  }
}

function updateCamera(dt, t) {
  if (!camera) return;
  const self = getSelfPlayer();
  const alive = self?.alive;
  const speedBob = movementMagnitude() > 0 ? 1 : 0;
  const bob = alive ? Math.sin(t * 10.5) * 0.025 * speedBob : 0;

  camera.position.set(local.x, CONFIG.player.cameraHeight + bob, local.z);
  camera.rotation.y = yaw;
  camera.rotation.x = pitch;

  if (weaponGroup) {
    const targetX = 0.35 + Math.sin(t * 7) * 0.01 * speedBob;
    const targetY = -0.33 + Math.abs(Math.sin(t * 10.5)) * 0.016 * speedBob;
    weaponGroup.position.x += (targetX - weaponGroup.position.x) * Math.min(1, dt * 10);
    weaponGroup.position.y += (targetY - weaponGroup.position.y) * Math.min(1, dt * 10);
    weaponGroup.rotation.z = Math.sin(t * 7) * 0.01 * speedBob;
  }
}

function updatePlayers(dt) {
  if (!scene || !roomState) return;
  const ids = new Set();
  for (const player of roomState.players || []) {
    ids.add(player.id);
    if (player.id === selfId) continue;
    let group = playerMeshes.get(player.id);
    if (!group) {
      group = createPlayerMesh(player);
      playerMeshes.set(player.id, group);
      scene.add(group);
    }
    group.visible = player.alive;
    group.userData.targetX = player.x;
    group.userData.targetZ = player.z;
    group.userData.targetYaw = player.yaw;
    group.userData.hp = player.hp;
    group.position.x += (player.x - group.position.x) * Math.min(1, dt * 10);
    group.position.z += (player.z - group.position.z) * Math.min(1, dt * 10);
    group.rotation.y = lerpAngle(group.rotation.y, player.yaw, Math.min(1, dt * 10));
    const nameSprite = group.userData.nameSprite;
    if (nameSprite) {
      nameSprite.lookAt(camera.position);
      nameSprite.visible = player.alive;
    }
  }

  for (const [id, mesh] of playerMeshes) {
    if (!ids.has(id)) {
      scene.remove(mesh);
      playerMeshes.delete(id);
    }
  }
}

function createPlayerMesh(player) {
  const group = new THREE.Group();
  group.position.set(player.x, 0, player.z);

  const color = new THREE.Color(player.color || '#5ee7ff');
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.52, metalness: 0.18 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.72, metalness: 0.12 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.72, 6, 12), bodyMat);
  body.position.y = 0.9;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), bodyMat);
  head.position.y = 1.62;
  group.add(head);

  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.06), new THREE.MeshBasicMaterial({ color: 0x05080f }));
  visor.position.set(0, 1.64, -0.31);
  group.add(visor);

  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.7), darkMat);
  weapon.position.set(0.36, 1.08, -0.28);
  group.add(weapon);

  const nameSprite = makeNameSprite(player.name, player.color);
  nameSprite.position.set(0, 2.3, 0);
  group.add(nameSprite);
  group.userData.nameSprite = nameSprite;
  return group;
}

function makeNameSprite(name, color) {
  const key = `${name}-${color}`;
  if (!nameTextureCache.has(key)) {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(4, 9, 16, 0.64)';
    roundRect(ctx, 34, 28, 444, 72, 24);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = '700 38px Inter, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ecf6ff';
    ctx.fillText(name, 256, 64, 390);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    nameTextureCache.set(key, texture);
  }
  const material = new THREE.SpriteMaterial({ map: nameTextureCache.get(key), transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.6, 0.65, 1);
  return sprite;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

function updatePickups(t) {
  if (!roomState) return;
  const pickupState = new Map((roomState.pickups || []).map((p) => [p.id, p]));
  for (const [id, group] of pickupMeshes) {
    const state = pickupState.get(id);
    if (state) group.visible = state.active;
    group.rotation.y += 0.025;
    group.position.y = 0.55 + Math.sin(t * 2.5 + id.length) * 0.12;
  }
}

function updateEffects(dt) {
  for (let i = tracerEffects.length - 1; i >= 0; i -= 1) {
    const effect = tracerEffects[i];
    effect.life -= dt;
    effect.material.opacity = Math.max(0, effect.life / effect.maxLife) * 0.78;
    if (effect.life <= 0) {
      scene.remove(effect.line);
      effect.geometry.dispose();
      effect.material.dispose();
      tracerEffects.splice(i, 1);
    }
  }

  for (let i = impactEffects.length - 1; i >= 0; i -= 1) {
    const effect = impactEffects[i];
    effect.life -= dt;
    effect.mesh.scale.multiplyScalar(1 + dt * 5);
    effect.mesh.material.opacity = Math.max(0, effect.life / effect.maxLife) * 0.75;
    if (effect.life <= 0) {
      scene.remove(effect.mesh);
      effect.mesh.geometry.dispose();
      effect.mesh.material.dispose();
      impactEffects.splice(i, 1);
    }
  }

  if (muzzleFlash) {
    muzzleFlash.intensity += (0 - muzzleFlash.intensity) * Math.min(1, dt * 18);
  }
}

function createTracer(payload) {
  if (!scene || !payload?.origin || !payload?.endpoint) return;
  const shooter = roomState?.players?.find((p) => p.id === payload.shooterId);
  const color = shooter?.color || '#5ee7ff';
  const start = new THREE.Vector3(payload.origin.x, payload.origin.y, payload.origin.z);
  const end = new THREE.Vector3(payload.endpoint.x, payload.endpoint.y, payload.endpoint.z);
  const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
  const material = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.78 });
  const line = new THREE.Line(geometry, material);
  scene.add(line);
  tracerEffects.push({ line, geometry, material, life: 0.12, maxLife: 0.12 });

  if (payload.hit) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(payload.hit.headshot ? 0.34 : 0.22, 12, 8),
      new THREE.MeshBasicMaterial({ color: payload.hit.headshot ? 0xffd166 : 0x5ee7ff, transparent: true, opacity: 0.75 })
    );
    mesh.position.set(payload.hit.x, payload.hit.y, payload.hit.z);
    scene.add(mesh);
    impactEffects.push({ mesh, life: 0.18, maxLife: 0.18 });
  }
}

function pulseWeapon() {
  if (muzzleFlash) muzzleFlash.intensity = 3.2;
  if (weaponGroup) {
    weaponGroup.position.z += 0.035;
    weaponGroup.rotation.x = -0.03;
  }
  setTimeout(() => {
    if (weaponGroup) weaponGroup.rotation.x = 0;
  }, 70);
}

function showHitmarker(headshot = false) {
  dom.hitmarker.textContent = headshot ? '✦' : '×';
  dom.hitmarker.style.color = headshot ? '#ffd166' : '#ffffff';
  dom.hitmarker.classList.remove('hidden');
  clearTimeout(showHitmarker.timer);
  showHitmarker.timer = setTimeout(() => dom.hitmarker.classList.add('hidden'), 170);
}

function flashDamage(ms = 170) {
  dom.damageVignette.classList.add('active');
  clearTimeout(flashDamage.timer);
  flashDamage.timer = setTimeout(() => dom.damageVignette.classList.remove('active'), ms);
}

function updateHudThrottled() {
  const now = performance.now();
  if (now - lastHudUpdate < 90) return;
  lastHudUpdate = now;

  const self = getSelfPlayer();
  if (self) {
    dom.hpText.textContent = Math.max(0, Math.round(self.hp));
    dom.shieldText.textContent = Math.max(0, Math.round(self.shield));
    dom.hpBar.style.width = `${clamp(self.hp / CONFIG.player.maxHealth, 0, 1) * 100}%`;
    dom.shieldBar.style.width = `${clamp(self.shield / CONFIG.player.maxShield, 0, 1) * 100}%`;

    dom.deathScreen.classList.toggle('hidden', self.alive || roomState.state !== 'playing');
    if (!self.alive) {
      dom.respawnText.textContent = (self.respawnInMs / 1000).toFixed(1);
    }
  }

  dom.timer.textContent = formatTime(roomState?.timeLeftMs || 0);
  if (lastPingSentAt === 0 || performance.now() - lastPingSentAt > 2000) {
    lastPingSentAt = performance.now();
    socket.emit('ping');
  }
  estimatedPing = Math.max(0, performance.now() - lastStateAt);
  dom.ping.textContent = `${Math.round(estimatedPing)} ms`;

  if (now - lastScoreUpdate > 300) {
    lastScoreUpdate = now;
    renderScoreboard();
  }
}

function renderScoreboard() {
  if (!roomState) return;
  const players = [...roomState.players].sort((a, b) => b.score - a.score || b.kills - a.kills || a.deaths - b.deaths);
  dom.scoreRows.innerHTML = players.map((p) => `
    <tr>
      <td><span class="score-name"><span class="avatar-dot" style="background:${p.color}; color:${p.color}"></span>${escapeHtml(p.name)}${p.id === selfId ? ' <span class="muted">you</span>' : ''}</span></td>
      <td>${p.score}</td>
      <td>${p.kills}</td>
      <td>${p.deaths}</td>
      <td>${p.damage}</td>
    </tr>
  `).join('');
}

function addFeedItem(item) {
  if (!item) return;
  const div = document.createElement('div');
  div.className = `kill-item ${item.type === 'system' ? 'system' : ''}`;
  div.textContent = item.text;
  dom.killFeed.prepend(div);
  while (dom.killFeed.children.length > 6) dom.killFeed.removeChild(dom.killFeed.lastElementChild);
  setTimeout(() => {
    div.style.opacity = '0';
    div.style.transform = 'translateX(18px)';
  }, 5200);
  setTimeout(() => div.remove(), 5900);
}

function currentInput() {
  const forward = (keys.w || keys.up ? 1 : 0) + (keys.s || keys.down ? -1 : 0);
  const strafe = (keys.d || keys.right ? 1 : 0) + (keys.a || keys.left ? -1 : 0);
  return {
    forward,
    strafe,
    sprint: keys.shift,
    fire: mouseDown && pointerLocked && Boolean(getSelfPlayer()?.alive),
    yaw,
    pitch,
    seq: inputSeq++
  };
}

setInterval(() => {
  if (!socket.connected || roomState?.state !== 'playing') return;
  socket.emit('input', currentInput());
}, 1000 / CONFIG.networking.inputRate);

function getSelfPlayer() {
  return roomState?.players?.find((p) => p.id === selfId) || null;
}

function movementMagnitude() {
  const input = currentInput();
  return Math.hypot(input.forward, input.strafe);
}

function resolveCircleWalls(x, z, radius) {
  let px = x;
  let pz = z;

  for (const wall of CONFIG.walls) {
    const minX = wall.x - wall.w / 2;
    const maxX = wall.x + wall.w / 2;
    const minZ = wall.z - wall.d / 2;
    const maxZ = wall.z + wall.d / 2;
    const closestX = clamp(px, minX, maxX);
    const closestZ = clamp(pz, minZ, maxZ);
    let dx = px - closestX;
    let dz = pz - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq < radius * radius) {
      const dist = Math.sqrt(Math.max(distSq, 0.000001));
      if (dist > 0.0001) {
        const push = radius - dist;
        px += (dx / dist) * push;
        pz += (dz / dist) * push;
      } else {
        const left = Math.abs(px - minX);
        const right = Math.abs(maxX - px);
        const top = Math.abs(pz - minZ);
        const bottom = Math.abs(maxZ - pz);
        const minPush = Math.min(left, right, top, bottom);
        if (minPush === left) px = minX - radius;
        else if (minPush === right) px = maxX + radius;
        else if (minPush === top) pz = minZ - radius;
        else pz = maxZ + radius;
      }
    }
  }

  const halfWidth = CONFIG.arena.width / 2 - radius - 1.8;
  const halfDepth = CONFIG.arena.depth / 2 - radius - 1.8;
  return { x: clamp(px, -halfWidth, halfWidth), z: clamp(pz, -halfDepth, halfDepth) };
}

function lerpAngle(a, b, t) {
  const diff = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + diff * t;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatTime(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Auto-join from invite URL after entering a name is still manual, but this hint helps.
if (dom.roomInput.value) {
  toast(`Room code ${dom.roomInput.value.toUpperCase()} detected. Enter name and Join Room.`);
}
