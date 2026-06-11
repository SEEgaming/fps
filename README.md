# Mini FPS Arena

A small browser-based multiplayer 3D FPS game. It uses:

- Node.js + Express as the web server
- Socket.IO for real-time multiplayer networking
- Three.js for 3D rendering in the browser

## Features

- Create room / join room
- Multiplayer free-for-all FPS combat
- First-person mouse look
- WASD movement, sprint, jump-like arena movement feel
- Server-side hit detection
- Health, shield, kills, deaths, score
- Respawn system
- Health / shield / speed pickups
- Kill feed
- Leaderboard
- Match countdown
- Render-ready deployment

## Local run

```bash
npm install
npm start
```

Then open:

```text
http://localhost:3000
```

## Deploy to Render

Create a Render **Web Service**, connect this GitHub repository, then use:

```text
Build Command: npm install
Start Command: npm start
```

After deployment, open the Render URL and share it with friends.

## Controls

```text
WASD / Arrow keys: Move
Mouse: Look around
Left click: Shoot
Shift: Sprint
Tab: Hold leaderboard
Esc: Unlock mouse
```

## Important

Do not upload `node_modules` to GitHub. Render will run `npm install` automatically.
