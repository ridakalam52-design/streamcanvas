import express from "express";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { CanvasState, PALETTE } from "./canvas/state.js";
import { CommandService, formatCommandRejection } from "./commands.js";
import { EventSub } from "./twitch/eventsub.js";
import { TwitchIRC } from "./twitch/irc.js";

loadEnvironmentFile();
const publicDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../public",
);
export const state = new CanvasState();
const app = express();
const server = http.createServer(app);
const webSockets = new WebSocketServer({ server });
let irc;

app.use(express.json({ limit: "5mb" }));
app.use(express.static(publicDirectory));
app.get("/healthz", (_request, response) => {
  response.json({ ok: true, mode: process.env.DEMO === "1" ? "demo" : "live" });
});
app.get("/api/state", (_request, response) => response.json(state.snapshot()));
app.post("/api/settings", (request, response) => {
  const { cooldown, teamsEnabled, paused } = request.body ?? {};
  if (Number.isFinite(cooldown)) {
    state.cooldownSeconds = Math.max(0, Math.min(120, cooldown));
    commands.cooldown = state.cooldownSeconds * 1000;
  }
  if (typeof teamsEnabled === "boolean") state.teamsEnabled = teamsEnabled;
  if (typeof paused === "boolean") state.paused = paused;
  broadcast({ type: "state", state: state.snapshot() });
  response.json({ ok: true });
});
app.post("/api/clear", (_request, response) => {
  state.clear();
  broadcast({ type: "state", state: state.snapshot() });
  response.json({ ok: true });
});
app.put("/api/template", (request, response) => {
  try {
    state.setTemplate(request.body?.template ?? null);
    broadcast({ type: "state", state: state.snapshot() });
    response.json({ ok: true, progress: state.templateProgress() });
  } catch (error) {
    response.status(400).json({ error: error.message });
  }
});
app.get("/api/export", (_request, response) => {
  response.setHeader("Content-Type", "application/json");
  response.setHeader(
    "Content-Disposition",
    'attachment; filename="streamcanvas-session.json"',
  );
  response.json(state.strokes);
});
app.get("/overlay", (_request, response) =>
  response.sendFile(path.join(publicDirectory, "overlay.html")),
);
app.get("/dashboard", (_request, response) =>
  response.sendFile(path.join(publicDirectory, "dashboard.html")),
);

state.cooldownSeconds = Number(process.env.PAINT_COOLDOWN_SECONDS ?? 10);
export const commands = new CommandService(state, {
  cooldown: state.cooldownSeconds * 1000,
  broadcasterName: process.env.TWITCH_CHANNEL ?? "",
  ack: (message) => irc?.say(message),
});

/** Log each command at receipt, including rejected commands and its Twitch channel. */
function receiveChat({ user, message, tags = {} }) {
  if (message.trim().startsWith("!")) {
    console.log(
      `[chat-command] channel=#${process.env.TWITCH_CHANNEL ?? "demo"} user=${user} command=${JSON.stringify(message)}`,
    );
  }
  const result = commands.handle(user, message, tags);
  if (message.trim().startsWith("!") && (result?.error || !result)) {
    const reason = result?.error ?? "invalid";
    console.log(
      formatCommandRejection(
        process.env.TWITCH_CHANNEL ?? "demo",
        user,
        message,
        reason,
      ),
    );
  }
  if (result) broadcast({ type: "command", result, state: state.snapshot() });
}

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of webSockets.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

if (process.env.TWITCH_CHANNEL && process.env.DEMO !== "1") {
  irc = new TwitchIRC({
    channel: process.env.TWITCH_CHANNEL,
    token: process.env.TWITCH_BOT_TOKEN,
    username: process.env.TWITCH_BOT_USERNAME,
    onMessage: receiveChat,
  });
  irc.connect();
}

const eventSub = new EventSub({
  clientId: process.env.TWITCH_CLIENT_ID,
  clientSecret: process.env.TWITCH_CLIENT_SECRET,
  userToken: process.env.TWITCH_USER_TOKEN,
  onEvent: ({ type, event }) => {
    const name =
      event?.user_name ?? event?.from_broadcaster_user_name ?? "raid";
    for (let index = 0; index < 45; index += 1) {
      state.paint(
        name,
        Math.floor(Math.random() * 64),
        Math.floor(Math.random() * 36),
        PALETTE.red,
        {
          kind: "event",
        },
      );
    }
    const text =
      type === "channel.raid" ? `${name} raided!` : `${name} followed!`;
    broadcast({ type: "banner", text, state: state.snapshot() });
  },
});
eventSub.connect();

webSockets.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", state: state.snapshot() }));
});

/** Create a steady stream of plausible viewers, team joins, paints, and raids. */
function startDemo() {
  const viewers = Array.from(
    { length: 30 },
    (_, index) => `viewer${index + 1}`,
  );
  const colors = Object.keys(PALETTE);
  let tick = 0;
  const timer = setInterval(() => {
    const user = viewers[tick % viewers.length];
    const team = tick % 2 ? "red" : "blue";
    receiveChat({ user, message: `!team ${team}` });
    const x = Math.floor(Math.random() * 64);
    const y = Math.floor(Math.random() * 36);
    const color = colors[Math.floor(Math.random() * colors.length)];
    receiveChat({ user, message: `!paint ${x} ${y} ${color}` });
    tick += 1;
    if (tick % 24 === 0) {
      const raider = viewers[Math.floor(Math.random() * viewers.length)];
      for (let index = 0; index < 20; index += 1) {
        state.paint(
          raider,
          Math.floor(Math.random() * 64),
          Math.floor(Math.random() * 36),
          PALETTE[team],
          {
            team,
            kind: "raid",
          },
        );
      }
      broadcast({
        type: "banner",
        text: `${raider}'s team raid is painting!`,
        state: state.snapshot(),
      });
    }
    broadcast({ type: "state", state: state.snapshot() });
  }, 300);
  timer.unref();
}

function loadEnvironmentFile() {
  try {
    const contents = fs.readFileSync(path.resolve(".env"), "utf8");
    for (const line of contents.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
      }
    }
  } catch {
    // A .env file is optional; deployments can provide variables directly.
  }
}

if (process.env.DEMO === "1") startDemo();
const port = Number(process.env.PORT) || 3000;
server.listen(port, () =>
  console.log(`StreamCanvas listening on http://localhost:${port}`),
);
process.on("SIGINT", () => {
  irc?.close();
  eventSub.close();
  server.close(() => process.exit(0));
});
