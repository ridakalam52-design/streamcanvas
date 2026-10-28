# StreamCanvas

StreamCanvas turns Twitch chat into a shared 64 × 36 pixel mural. Chat paints live, an OBS-ready overlay shows the mural and community activity, and a streamer dashboard controls the session and replays it as WebM.

## Features

- Named palette and nearest-color hex snapping, coordinates, subscriber/VIP/mod line tool, subscriber cooldown bonus, cheer bursts, and moderator undo and bans.
- Live overlay with a sharp pixel grid, coordinate labels every eight cells, a drop-in animation for new pixels, latest-painter color swatches, red-versus-blue territory bar, raid/follow banners, and paint hint.
- Dashboard with live canvas, painter and pixel totals, top five artists, pause and cooldown settings, team toggle, confirmed clear, and PNG snapshot.
- Heart guide or uploaded logo/image as a faint ghost template. The overlay tracks how much of the guide has been painted. Transparent PNGs work best.
- Optional Twitch IRC chat and EventSub WebSocket integration, anonymous read-only IRC by default.
- JSONL stroke history that restores the mural after restart, plus a client-side timelapse player and WebM export.
- Demo mode simulates 30 chatters, team joins, paints, and raids without Twitch credentials.

## Quick start

Requires Node.js 22 or newer.

```sh
npm install
cp .env.example .env
# Set TWITCH_CHANNEL in .env for a live channel
npm start
```

Open `http://localhost:3000/dashboard` for streamer controls and `http://localhost:3000/overlay` for the stream overlay. Set `PORT` to change the default port.

To showcase the app without a Twitch channel, use `npm run demo` or `DEMO=1 npm start`.

## OBS setup

1. Add a **Browser Source** in OBS.
2. Set the URL to `http://localhost:3000/overlay` and the dimensions to **1920 × 1080**.
3. The overlay uses a transparent page background and scales its crisp 64 × 36 mural with pixelated rendering.
4. Leave the dashboard open at `/dashboard` in a regular browser window to load templates and manage the session.

## Chat commands

| Command | Action | Access |
| --- | --- | --- |
| `!paint <x> <y> <color>` | Paint one cell; x is 0–63 and y is 0–35 | Everyone |
| `!line <x1> <y1> <x2> <y2> <color>` | Paint a straight line | Subscribers, VIPs, moderators |
| `!team red` / `!team blue` | Join a scoreboard team | Everyone |
| `!undo [@user]` | Undo the latest stroke or the named artist's latest stroke | Moderators |
| `!ban @user` | Block someone from painting | Moderators |
| `!canvas` | Ask the configured bot for mural help | Everyone, bot replies optional |

Colors are `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `white`, `black`, `brown`, and `gray`. Six-digit hex colors snap to the nearest palette entry. Fill commands are disabled. The regular cooldown defaults to 10 seconds and is configurable in the dashboard; subscribers receive half the cooldown. Cheer tags grant up to four bonus pixels.

## Environment variables

| Variable | Purpose | Default |
| --- | --- | --- |
| `PORT` | HTTP and WebSocket listen port | `3000` |
| `TWITCH_CHANNEL` | Twitch channel to read from IRC | unset |
| `TWITCH_BOT_TOKEN` | Optional OAuth token for bot chat replies | unset |
| `TWITCH_BOT_USERNAME` | Bot account username; anonymous IRC is used when absent | unset |
| `PAINT_COOLDOWN_SECONDS` | Initial regular viewer cooldown | `10` |
| `TWITCH_CLIENT_ID` | EventSub Helix client ID | unset |
| `TWITCH_CLIENT_SECRET` | EventSub application secret | unset |
| `TWITCH_USER_TOKEN` | User token with EventSub permissions | unset |
| `TWITCH_BROADCASTER_ID` | Broadcaster ID used for EventSub subscriptions | unset |
| `DEMO` | Simulated traffic when set to `1` | `0` |

The app reads a local `.env` file at startup and accepts environment variables supplied by the process. Leave Twitch credentials unset to run locally or use demo mode.

## Architecture

- `src/server.js` serves the Express pages and JSON APIs, owns the WebSocket broadcast, starts demo traffic, and logs every received chat command with its channel and user.
- `src/twitch/irc.js` handles Twitch IRC WebSocket auth, tags, channel joins, chat messages, and optional replies. `src/twitch/eventsub.js` handles optional follow and raid notifications.
- `src/commands.js` parses chat commands and applies permissions, cooldowns, teams, cheers, bans, and undo.
- `src/canvas/state.js` maintains the 64 × 36 canvas, statistics, template completion, and JSONL persistence under `data/`.
- `public/overlay.*` and `public/dashboard.*` render the browser experiences. Template masks are stored in `data/template.json`.

## Data, replay, and development

The dashboard replays the full stroke log and can capture playback as a WebM in the browser. PNG snapshots exclude the guide layer. Clearing the mural clears its stroke log but leaves a loaded template in place. Tests run with Node's built-in test runner.

```sh
npm test
npm run demo
```

## Built with Codex

Built with Codex for the TwitchCon hackathon brief. The project uses Node.js, Express, `ws`, native browser Canvas APIs, and Node's built-in test runner. MIT licensed.
