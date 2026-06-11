'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const CONFIG = require('./public/shared/gameConfig.js');

const PORT = process.env.PORT || 3000;
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  transports: ['websocket', 'polling'],
  pingInterval: 15000,
  pingTimeout: 10000
});

app.use('/shared', express.static(path.join(__dirname, 'public', 'shared')));
app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const rooms = new Map();
const socketToRoom = new Map();

function nowMs() {
  return Date.now();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomRoomId() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  do {
    id = '';
    for (let i = 0; i < 5; i += 1) id += alphabet[randInt(0, alphabet.length - 1)];
  } while (rooms.has(id));
  return id;
}

function cleanName(name) {
  const safe = String(name || '').replace(/[^\p{L}\p{N}_\- ]/gu, '').trim().slice(0, 16);
  return safe || `Player${randInt(100, 999)}`;
}

function createRoom(hostSocket, playerName) {
  const id = randomRoomId();
  const room = {
    id,
    hostId: hostSocket.id,
    state: 'lobby',
    createdAt: nowMs(),
    startedAt: 0,
    endsAt: 0,
    players: new Map(),
    pickups: CONFIG.pickups.map((p) => ({ ...p, active: true, respawnAt: 0 })),
    lastBroadcastAt: 0,
    killFeed: []
  };
  rooms.set(id, room);
  addPlayerToRoom(room, hostSocket, playerName);
  return room;
}

function addPlayerToRoom(room, socket, playerName) {
  if (room.players.size >= CONFIG.match.maxPlayers) {
    socket.emit('serverError', { message: 'Room is full.' });
    return null;
  }

  socket.join(room.id);
  socketToRoom.set(socket.id, room.id);

  const index = room.players.size;
  const spawn = CONFIG.spawns[index % CONFIG.spawns.length];
  const color = CONFIG.colors[index % CONFIG.colors.length];
  const player = {
    id: socket.id,
    name: cleanName(playerName),
    color,
    x: spawn.x,
    z: spawn.z,
    y: CONFIG.player.cameraHeight,
    yaw: spawn.yaw,
    pitch: 0,
    hp: CONFIG.player.maxHealth,
    shield: CONFIG.player.startingShield,
    alive: true,
    respawnAt: 0,
    score: 0,
    kills: 0,
    deaths: 0,
    damage: 0,
    streak: 0,
    lastShotAt: 0,
    speedBoostUntil: 0,
    invulnerableUntil: nowMs() + 1200,
    input: {
      forward: 0,
      strafe: 0,
      sprint: false,
      fire: false,
      yaw: spawn.yaw,
      pitch: 0,
      seq: 0
    }
  };
  room.players.set(socket.id, player);
  socket.emit('roomJoined', publicRoomState(room, socket.id));
  broadcastLobby(room);
  return player;
}

function removePlayer(socketId) {
  const roomId = socketToRoom.get(socketId);
  if (!roomId) return;
  const room = rooms.get(roomId);
  if (!room) return;

  const player = room.players.get(socketId);
  room.players.delete(socketId);
  socketToRoom.delete(socketId);

  if (player) {
    addKillFeed(room, 'system', `${player.name} left the arena.`);
  }

  if (room.players.size === 0) {
    rooms.delete(roomId);
    return;
  }

  if (room.hostId === socketId) {
    room.hostId = room.players.keys().next().value;
  }
  broadcastLobby(room);
}

function publicRoomState(room, selfId) {
  return {
    roomId: room.id,
    selfId,
    hostId: room.hostId,
    state: room.state,
    maxPlayers: CONFIG.match.maxPlayers,
    matchDurationMs: CONFIG.match.durationMs,
    players: Array.from(room.players.values()).map(serializePlayer),
    timeLeftMs: Math.max(0, room.endsAt - nowMs()),
    serverNow: nowMs(),
    pickups: room.pickups,
    killFeed: room.killFeed.slice(-8)
  };
}

function serializePlayer(player) {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    x: round(player.x),
    z: round(player.z),
    y: round(player.y),
    yaw: round(player.yaw),
    pitch: round(player.pitch),
    hp: Math.ceil(player.hp),
    shield: Math.ceil(player.shield),
    alive: player.alive,
    score: player.score,
    kills: player.kills,
    deaths: player.deaths,
    damage: Math.round(player.damage),
    streak: player.streak,
    respawnInMs: player.alive ? 0 : Math.max(0, player.respawnAt - nowMs()),
    speedBoost: player.speedBoostUntil > nowMs(),
    invulnerable: player.invulnerableUntil > nowMs()
  };
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function broadcastLobby(room) {
  io.to(room.id).emit('roomState', publicRoomState(room));
}

function addKillFeed(room, type, text) {
  const item = { id: `${nowMs()}-${Math.random()}`, type, text, time: nowMs() };
  room.killFeed.push(item);
  room.killFeed = room.killFeed.slice(-10);
  io.to(room.id).emit('killFeed', item);
}

function resetMatch(room) {
  const start = nowMs();
  room.state = 'playing';
  room.startedAt = start;
  room.endsAt = start + CONFIG.match.durationMs;
  room.pickups = CONFIG.pickups.map((p) => ({ ...p, active: true, respawnAt: 0 }));
  room.killFeed = [];

  let index = 0;
  for (const player of room.players.values()) {
    const spawn = CONFIG.spawns[index % CONFIG.spawns.length];
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = spawn.yaw;
    player.pitch = 0;
    player.hp = CONFIG.player.maxHealth;
    player.shield = CONFIG.player.startingShield;
    player.alive = true;
    player.respawnAt = 0;
    player.score = 0;
    player.kills = 0;
    player.deaths = 0;
    player.damage = 0;
    player.streak = 0;
    player.speedBoostUntil = 0;
    player.lastShotAt = 0;
    player.invulnerableUntil = start + 1500;
    player.input.forward = 0;
    player.input.strafe = 0;
    player.input.fire = false;
    index += 1;
  }
  addKillFeed(room, 'system', 'Match started. Good luck.');
  io.to(room.id).emit('matchStarted', publicRoomState(room));
}

function finishMatch(room) {
  if (room.state !== 'playing') return;
  room.state = 'ended';
  room.endsAt = nowMs();
  addKillFeed(room, 'system', 'Match finished.');
  io.to(room.id).emit('matchEnded', publicRoomState(room));
  broadcastLobby(room);
}

function normalizeInput(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  return {
    forward: clamp(Number(input.forward) || 0, -1, 1),
    strafe: clamp(Number(input.strafe) || 0, -1, 1),
    sprint: Boolean(input.sprint),
    fire: Boolean(input.fire),
    yaw: clamp(Number(input.yaw) || 0, -Math.PI * 4, Math.PI * 4),
    pitch: clamp(Number(input.pitch) || 0, -1.35, 1.35),
    seq: Number(input.seq) || 0
  };
}

function simulateRooms(dt) {
  const now = nowMs();
  for (const room of rooms.values()) {
    if (room.state === 'playing') {
      if (now >= room.endsAt) {
        finishMatch(room);
      } else {
        simulateRoom(room, dt, now);
      }
    }

    if (now - room.lastBroadcastAt >= 1000 / CONFIG.networking.broadcastRate) {
      room.lastBroadcastAt = now;
      io.to(room.id).emit('roomState', publicRoomState(room));
    }
  }
}

function simulateRoom(room, dt, now) {
  respawnPlayers(room, now);
  refreshPickups(room, now);

  for (const player of room.players.values()) {
    if (!player.alive) continue;
    const input = player.input;
    player.yaw = input.yaw;
    player.pitch = input.pitch;
    movePlayer(player, dt, now);
    collectPickups(room, player, now);
    if (input.fire) {
      tryShoot(room, player, now);
    }
  }
}

function respawnPlayers(room, now) {
  for (const player of room.players.values()) {
    if (player.alive || now < player.respawnAt) continue;
    const spawn = findSafeSpawn(room);
    player.x = spawn.x;
    player.z = spawn.z;
    player.yaw = spawn.yaw;
    player.pitch = 0;
    player.hp = CONFIG.player.maxHealth;
    player.shield = CONFIG.player.startingShield;
    player.alive = true;
    player.invulnerableUntil = now + 1400;
    player.speedBoostUntil = 0;
    player.input.fire = false;
    io.to(room.id).emit('playerRespawned', { id: player.id, x: player.x, z: player.z });
  }
}

function findSafeSpawn(room) {
  let best = CONFIG.spawns[randInt(0, CONFIG.spawns.length - 1)];
  let bestScore = -Infinity;
  for (const spawn of CONFIG.spawns) {
    let nearest = Infinity;
    for (const player of room.players.values()) {
      if (!player.alive) continue;
      const d = Math.hypot(player.x - spawn.x, player.z - spawn.z);
      nearest = Math.min(nearest, d);
    }
    if (nearest > bestScore) {
      bestScore = nearest;
      best = spawn;
    }
  }
  return best;
}

function refreshPickups(room, now) {
  for (const pickup of room.pickups) {
    if (!pickup.active && now >= pickup.respawnAt) {
      pickup.active = true;
      io.to(room.id).emit('pickupRespawned', { id: pickup.id });
    }
  }
}

function movePlayer(player, dt, now) {
  const input = player.input;
  let forward = input.forward;
  let strafe = input.strafe;
  const length = Math.hypot(forward, strafe);
  if (length > 1) {
    forward /= length;
    strafe /= length;
  }

  let speed = CONFIG.player.baseSpeed;
  if (input.sprint) speed *= CONFIG.player.sprintMultiplier;
  if (player.speedBoostUntil > now) speed *= CONFIG.player.speedBoostMultiplier;

  const yaw = player.yaw;
  const forwardX = -Math.sin(yaw);
  const forwardZ = -Math.cos(yaw);
  const rightX = Math.cos(yaw);
  const rightZ = -Math.sin(yaw);

  let nextX = player.x + (forwardX * forward + rightX * strafe) * speed * dt;
  let nextZ = player.z + (forwardZ * forward + rightZ * strafe) * speed * dt;

  const resolved = resolveCircleWalls(nextX, nextZ, CONFIG.player.radius);
  player.x = resolved.x;
  player.z = resolved.z;
}

function resolveCircleWalls(x, z, radius) {
  let px = x;
  let pz = z;

  for (const wall of CONFIG.walls) {
    const halfW = wall.w / 2;
    const halfD = wall.d / 2;
    const minX = wall.x - halfW;
    const maxX = wall.x + halfW;
    const minZ = wall.z - halfD;
    const maxZ = wall.z + halfD;

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
        // Player center is exactly inside a rectangle; push out by shortest axis.
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
  return {
    x: clamp(px, -halfWidth, halfWidth),
    z: clamp(pz, -halfDepth, halfDepth)
  };
}

function collectPickups(room, player, now) {
  for (const pickup of room.pickups) {
    if (!pickup.active) continue;
    const dist = Math.hypot(player.x - pickup.x, player.z - pickup.z);
    if (dist > CONFIG.pickups.radius) continue;

    if (pickup.type === 'health') {
      if (player.hp >= CONFIG.player.maxHealth) continue;
      player.hp = Math.min(CONFIG.player.maxHealth, player.hp + CONFIG.pickups.healthAmount);
    } else if (pickup.type === 'shield') {
      if (player.shield >= CONFIG.player.maxShield) continue;
      player.shield = Math.min(CONFIG.player.maxShield, player.shield + CONFIG.pickups.shieldAmount);
    } else if (pickup.type === 'speed') {
      player.speedBoostUntil = now + CONFIG.pickups.speedDurationMs;
    }

    pickup.active = false;
    pickup.respawnAt = now + CONFIG.pickups.respawnMs;
    io.to(room.id).emit('pickupCollected', { id: pickup.id, by: player.id, type: pickup.type });
  }
}

function tryShoot(room, shooter, now) {
  if (now - shooter.lastShotAt < CONFIG.weapon.cooldownMs) return;
  shooter.lastShotAt = now;

  const ray = createShotRay(shooter);
  const wallHit = nearestWallHit(ray.origin, ray.dir, CONFIG.weapon.range);
  const playerHit = nearestPlayerHit(room, shooter, ray.origin, ray.dir, CONFIG.weapon.range);

  let hit = null;
  let endpointDistance = CONFIG.weapon.range;
  if (wallHit && wallHit.t < endpointDistance) {
    endpointDistance = wallHit.t;
    hit = { type: 'wall', x: wallHit.x, y: wallHit.y, z: wallHit.z };
  }
  if (playerHit && playerHit.t < endpointDistance) {
    endpointDistance = playerHit.t;
    hit = playerHit;
    applyDamage(room, shooter, playerHit.player, playerHit.headshot, now);
  }

  const endpoint = {
    x: ray.origin.x + ray.dir.x * endpointDistance,
    y: ray.origin.y + ray.dir.y * endpointDistance,
    z: ray.origin.z + ray.dir.z * endpointDistance
  };

  io.to(room.id).emit('shotFired', {
    shooterId: shooter.id,
    origin: ray.origin,
    endpoint,
    hit: hit ? {
      type: hit.type,
      targetId: hit.player ? hit.player.id : null,
      headshot: Boolean(hit.headshot),
      x: hit.x || endpoint.x,
      y: hit.y || endpoint.y,
      z: hit.z || endpoint.z
    } : null
  });
}

function createShotRay(player) {
  let yaw = player.yaw;
  let pitch = player.pitch;
  // Tiny deterministic-ish spread to make continuous spray less laser-perfect.
  const spread = CONFIG.weapon.spread;
  yaw += (Math.random() - 0.5) * spread;
  pitch += (Math.random() - 0.5) * spread;

  const cosPitch = Math.cos(pitch);
  const dir = normalize3({
    x: -Math.sin(yaw) * cosPitch,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cosPitch
  });
  return {
    origin: { x: player.x, y: CONFIG.player.cameraHeight, z: player.z },
    dir
  };
}

function normalize3(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function nearestPlayerHit(room, shooter, origin, dir, maxRange) {
  let best = null;

  for (const target of room.players.values()) {
    if (target.id === shooter.id || !target.alive) continue;

    const head = intersectSphere(origin, dir, { x: target.x, y: 1.62, z: target.z }, 0.36, maxRange);
    const body = intersectSphere(origin, dir, { x: target.x, y: 1.05, z: target.z }, 0.68, maxRange);

    let hit = null;
    if (head !== null) {
      hit = { t: head, headshot: true };
    } else if (body !== null) {
      hit = { t: body, headshot: false };
    }

    if (!hit) continue;
    if (best && hit.t >= best.t) continue;

    const wallBlock = nearestWallHit(origin, dir, hit.t - 0.05);
    if (wallBlock) continue;

    best = {
      type: 'player',
      player: target,
      t: hit.t,
      headshot: hit.headshot,
      x: origin.x + dir.x * hit.t,
      y: origin.y + dir.y * hit.t,
      z: origin.z + dir.z * hit.t
    };
  }

  return best;
}

function intersectSphere(origin, dir, center, radius, maxRange) {
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const b = 2 * (ox * dir.x + oy * dir.y + oz * dir.z);
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  const disc = b * b - 4 * c;
  if (disc < 0) return null;
  const sqrt = Math.sqrt(disc);
  const t1 = (-b - sqrt) / 2;
  const t2 = (-b + sqrt) / 2;
  const t = t1 > 0 ? t1 : t2 > 0 ? t2 : null;
  if (t === null || t > maxRange) return null;
  return t;
}

function nearestWallHit(origin, dir, maxRange) {
  let best = null;
  for (const wall of CONFIG.walls) {
    const hit = intersectAABB(origin, dir, {
      minX: wall.x - wall.w / 2,
      maxX: wall.x + wall.w / 2,
      minY: 0,
      maxY: wall.h,
      minZ: wall.z - wall.d / 2,
      maxZ: wall.z + wall.d / 2
    });
    if (hit === null || hit < 0 || hit > maxRange) continue;
    if (best && hit >= best.t) continue;
    best = {
      t: hit,
      x: origin.x + dir.x * hit,
      y: origin.y + dir.y * hit,
      z: origin.z + dir.z * hit
    };
  }
  return best;
}

function intersectAABB(origin, dir, box) {
  let tMin = -Infinity;
  let tMax = Infinity;

  const axes = [
    ['x', 'minX', 'maxX'],
    ['y', 'minY', 'maxY'],
    ['z', 'minZ', 'maxZ']
  ];

  for (const [axis, minKey, maxKey] of axes) {
    const o = origin[axis];
    const d = dir[axis];
    if (Math.abs(d) < 1e-8) {
      if (o < box[minKey] || o > box[maxKey]) return null;
      continue;
    }
    let t1 = (box[minKey] - o) / d;
    let t2 = (box[maxKey] - o) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }

  return tMin >= 0 ? tMin : tMax >= 0 ? tMax : null;
}

function applyDamage(room, shooter, target, headshot, now) {
  if (target.invulnerableUntil > now) return;
  let damage = headshot ? CONFIG.weapon.headshotDamage : CONFIG.weapon.damage;

  if (target.shield > 0) {
    const shieldDamage = Math.min(target.shield, damage * 0.75);
    target.shield -= shieldDamage;
    damage -= shieldDamage * 0.7;
  }

  target.hp -= damage;
  shooter.damage += damage;
  shooter.score += headshot ? 3 : 1;
  io.to(room.id).emit('playerDamaged', {
    targetId: target.id,
    shooterId: shooter.id,
    amount: Math.round(damage),
    headshot
  });

  if (target.hp <= 0) {
    killPlayer(room, shooter, target, headshot, now);
  }
}

function killPlayer(room, killer, victim, headshot, now) {
  victim.alive = false;
  victim.respawnAt = now + CONFIG.match.respawnMs;
  victim.hp = 0;
  victim.shield = 0;
  victim.deaths += 1;
  victim.streak = 0;
  victim.input.fire = false;

  if (killer && killer.id !== victim.id) {
    killer.kills += 1;
    killer.streak += 1;
    killer.score += headshot ? 15 : 10;
    const extra = headshot ? ' with a headshot' : '';
    const streak = killer.streak >= 3 ? ` (${killer.streak} streak)` : '';
    addKillFeed(room, 'kill', `${killer.name} eliminated ${victim.name}${extra}${streak}.`);
  } else {
    addKillFeed(room, 'kill', `${victim.name} was eliminated.`);
  }

  io.to(room.id).emit('playerKilled', {
    victimId: victim.id,
    killerId: killer ? killer.id : null,
    headshot,
    respawnMs: CONFIG.match.respawnMs
  });
}

io.on('connection', (socket) => {
  socket.emit('connected', { id: socket.id, config: { match: CONFIG.match, player: CONFIG.player, weapon: CONFIG.weapon } });

  socket.on('createRoom', ({ name } = {}) => {
    removePlayer(socket.id);
    createRoom(socket, name);
  });

  socket.on('joinRoom', ({ roomId, name } = {}) => {
    removePlayer(socket.id);
    const id = String(roomId || '').trim().toUpperCase();
    const room = rooms.get(id);
    if (!room) {
      socket.emit('serverError', { message: 'Room not found.' });
      return;
    }
    addPlayerToRoom(room, socket, name);
  });

  socket.on('leaveRoom', () => {
    const roomId = socketToRoom.get(socket.id);
    if (roomId) socket.leave(roomId);
    removePlayer(socket.id);
    socket.emit('leftRoom');
  });

  socket.on('startGame', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room) return;
    if (room.hostId !== socket.id) {
      socket.emit('serverError', { message: 'Only the host can start the match.' });
      return;
    }
    if (room.players.size < CONFIG.match.minPlayersToStart) {
      socket.emit('serverError', { message: 'Not enough players.' });
      return;
    }
    resetMatch(room);
  });

  socket.on('returnToLobby', () => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room || room.hostId !== socket.id) return;
    room.state = 'lobby';
    room.endsAt = 0;
    addKillFeed(room, 'system', 'Returned to lobby.');
    broadcastLobby(room);
  });

  socket.on('input', (payload) => {
    const room = rooms.get(socketToRoom.get(socket.id));
    if (!room) return;
    const player = room.players.get(socket.id);
    if (!player) return;
    player.input = normalizeInput(payload);
    player.yaw = player.input.yaw;
    player.pitch = player.input.pitch;
  });

  socket.on('disconnect', () => {
    removePlayer(socket.id);
  });
});

setInterval(() => {
  simulateRooms(1 / CONFIG.networking.tickRate);
}, 1000 / CONFIG.networking.tickRate);

server.listen(PORT, () => {
  console.log(`Mini FPS Arena running on port ${PORT}`);
});
