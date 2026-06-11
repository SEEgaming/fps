<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mini FPS Arena</title>
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div id="app">
    <section id="menu" class="panel menu-panel">
      <div class="brand-row">
        <div class="brand-mark">FPS</div>
        <div>
          <h1>Mini FPS Arena</h1>
          <p>Browser multiplayer arena shooter. Create a room, share the code, and fight.</p>
        </div>
      </div>

      <div class="form-grid">
        <label>
          Nickname
          <input id="nameInput" maxlength="16" placeholder="Your name" autocomplete="off" />
        </label>

        <button id="createBtn" class="primary">Create Room</button>

        <label>
          Room Code
          <input id="roomInput" maxlength="8" placeholder="ABCDE" autocomplete="off" />
        </label>

        <button id="joinBtn">Join Room</button>
      </div>

      <div class="tips">
        <strong>Controls:</strong> WASD move · Mouse aim · Left click shoot · Shift sprint · Tab leaderboard
      </div>
    </section>

    <section id="lobby" class="panel lobby-panel hidden">
      <div class="topbar">
        <div>
          <span class="muted">Room</span>
          <h2 id="roomCode">-----</h2>
        </div>
        <div class="topbar-actions">
          <button id="copyLinkBtn">Copy Invite Link</button>
          <button id="leaveBtn">Leave</button>
        </div>
      </div>

      <div class="lobby-content">
        <div>
          <h3>Players</h3>
          <div id="lobbyPlayers" class="player-list"></div>
        </div>
        <div class="rules-card">
          <h3>Match Rules</h3>
          <ul>
            <li>Free-for-all arena combat</li>
            <li>5 minute match timer</li>
            <li>+10 score per kill, +15 headshot kill</li>
            <li>Health, shield, and speed pickups respawn around the map</li>
          </ul>
          <button id="startBtn" class="primary start-btn">Start Match</button>
          <p id="hostHint" class="muted">Only the host can start.</p>
        </div>
      </div>
    </section>

    <section id="game" class="hidden">
      <canvas id="gameCanvas"></canvas>

      <div id="hud">
        <div class="hud-top">
          <div class="pill">Room <span id="hudRoom">-----</span></div>
          <div class="pill timer" id="timer">05:00</div>
          <div class="pill" id="ping">-- ms</div>
        </div>

        <div class="crosshair">
          <div></div><div></div><div></div><div></div>
        </div>
        <div id="hitmarker" class="hitmarker hidden">×</div>
        <div id="damageVignette"></div>

        <div class="bars">
          <div class="bar-wrap">
            <span>HP</span>
            <div class="bar"><div id="hpBar"></div></div>
            <b id="hpText">100</b>
          </div>
          <div class="bar-wrap shield">
            <span>SHD</span>
            <div class="bar"><div id="shieldBar"></div></div>
            <b id="shieldText">25</b>
          </div>
        </div>

        <div id="weaponCard">
          <div class="muted">Weapon</div>
          <strong>Pulse Rifle</strong>
          <div class="ammo-line">∞ energy</div>
        </div>

        <div id="killFeed"></div>

        <div id="scoreboard" class="scoreboard hidden">
          <h3>Scoreboard</h3>
          <table>
            <thead>
              <tr><th>Player</th><th>Score</th><th>K</th><th>D</th><th>DMG</th></tr>
            </thead>
            <tbody id="scoreRows"></tbody>
          </table>
        </div>

        <div id="deathScreen" class="death-screen hidden">
          <h2>You were eliminated</h2>
          <p>Respawning in <span id="respawnText">2.5</span>s</p>
        </div>

        <div id="endScreen" class="end-screen hidden">
          <h2>Match Finished</h2>
          <div id="winnerText"></div>
          <button id="backToLobbyBtn">Back to Lobby</button>
        </div>

        <div id="playPrompt" class="play-prompt">
          <h2>Click to lock mouse and play</h2>
          <p>Press Esc to unlock mouse.</p>
        </div>
      </div>
    </section>

    <div id="toast" class="toast hidden"></div>
  </div>

  <script src="/socket.io/socket.io.js"></script>
  <script src="/shared/gameConfig.js"></script>
  <script type="importmap">
    {
      "imports": {
        "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js"
      }
    }
  </script>
  <script type="module" src="/client.js"></script>
</body>
</html>
