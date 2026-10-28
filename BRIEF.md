# Build brief: StreamCanvas (Codex x TwitchCon Hackathon)

Build a complete, working Node.js (v22, ESM) app called **StreamCanvas**: Twitch chat paints a shared pixel mural live on the stream overlay.

## Core
- Server: Node + Express + `ws` (no other heavy deps). `npm start` runs it on PORT (default 3000).
- Connects to Twitch chat over the IRC WebSocket `wss://irc-ws.chat.twitch.tv:443`. Anonymous read-only by default (NICK justinfan<random>), channel from `TWITCH_CHANNEL` env. If `TWITCH_BOT_TOKEN` + `TWITCH_BOT_USERNAME` are set, it can also reply in chat (rate-limited acknowledgements, off by default).
- Chat commands:
  - `!paint <x> <y> <color>` — color is a palette name (red, orange, yellow, green, teal, blue, purple, pink, white, black, brown, gray) or #hex snapped to the palette. Grid 64x36.
  - `!line x1 y1 x2 y2 color` (subs/VIP/mods only, via IRC tags), `!fill` disabled.
  - `!team <red|blue>` join a team; team territory scoreboard on the overlay.
  - `!undo` (mods) undo the last stroke by a user; `!ban @user` (mods) block a user from painting.
  - `!canvas` posts link/help (only when bot token is set).
- Per-user cooldown (default 10s, configurable), subscriber cooldown halved, bits/cheers in tags give a paint burst.
- Optional EventSub (if `TWITCH_CLIENT_ID` + `TWITCH_CLIENT_SECRET` + a user token are present): raids and follows trigger a "confetti burst" painting random pixels in the raider's color and an on-overlay banner. Use the EventSub WebSocket transport (`wss://eventsub.wss.twitch.tv/ws`). Must degrade gracefully when not configured.
- Overlay page `/overlay` (transparent background, for OBS Browser Source 1920x1080): crisp pixel canvas, newest-painter ticker, team scores, banners, subtle pixel-drop animation.
- Streamer dashboard `/dashboard`: live canvas, stats (painters, pixels, top artists), toggles (cooldown, teams on/off, pause painting), clear canvas, snapshot PNG download, and a **timelapse** replay of the whole session (canvas replayed from the stroke log) exportable as an animated GIF or WebM (do it client-side with canvas + MediaRecorder for WebM; GIF optional).
- Persistence: stroke log in a JSON lines file under ./data so a restart keeps the mural.
- **Demo mode** `npm run demo` / `DEMO=1`: a simulated chat of ~30 fake viewers sends realistic commands (including a raid and a team battle) so the overlay can be shown without a live channel.
- `/healthz` endpoint.

## Quality
- Clean modular code: src/twitch/irc.js, src/twitch/eventsub.js, src/canvas/state.js, src/commands.js, src/server.js, public/overlay.*, public/dashboard.*.
- Tests with `node --test` covering command parsing, color snapping, cooldowns, permissions and undo. All must pass.
- README.md: what it is, screenshots placeholder section, quick start, OBS setup, env vars table, how it uses Twitch (IRC chat, EventSub), and a "Built with Codex" section. MIT LICENSE (copyright 2026 Rida Kalam). .env.example. .gitignore.
- Verify: run the tests and start the server in demo mode briefly to ensure it boots and /healthz returns ok. Fix anything failing.
