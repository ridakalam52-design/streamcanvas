import { HEIGHT, WIDTH, snapColor } from "./canvas/state.js";

/** Parse a supported chat message into a validated command object. */
export function parseCommand(message) {
  const args = message.trim().split(/\s+/);
  if (!args[0]?.startsWith("!")) return null;
  const command = args.shift().slice(1).toLowerCase();

  if (command === "paint" && args.length === 3) {
    const [x, y] = args.slice(0, 2).map(Number);
    const color = snapColor(args[2]);
    if (Number.isInteger(x) && Number.isInteger(y) && inside(x, y) && color) {
      return { type: "paint", x, y, color };
    }
  }
  if (command === "line" && args.length === 5) {
    const [x1, y1, x2, y2] = args.slice(0, 4).map(Number);
    const color = snapColor(args[4]);
    if (
      [x1, y1, x2, y2].every(Number.isInteger) &&
      inside(x1, y1) &&
      inside(x2, y2) &&
      color
    ) {
      return { type: "line", x1, y1, x2, y2, color };
    }
  }
  if (command === "team" && ["red", "blue"].includes(args[0]?.toLowerCase())) {
    return { type: "team", team: args[0].toLowerCase() };
  }
  if (command === "undo" && args.length <= 1) {
    return { type: "undo", user: args[0]?.replace(/^@/, "").toLowerCase() };
  }
  if (command === "ban" && args[0]) {
    return { type: "ban", user: args[0].replace(/^@/, "").toLowerCase() };
  }
  if (command === "canvas") return { type: "canvas" };
  return null;
}

function inside(x, y) {
  return x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT;
}

/** Apply permissions, team selection, cooldowns, and effects to parsed commands. */
export class CommandService {
  constructor(
    state,
    {
      cooldown = 10_000,
      now = () => Date.now(),
      ack = () => {},
      ackInterval = 5_000,
      broadcasterName = "",
    } = {},
  ) {
    this.state = state;
    this.cooldown = cooldown;
    this.now = now;
    this.ack = ack;
    this.ackInterval = ackInterval;
    this.lastAck = -Infinity;
    this.broadcasterName = broadcasterName.replace(/^#/, "").toLowerCase();
    this.lastPaint = new Map();
  }

  sendAck(message) {
    if (this.now() - this.lastAck < this.ackInterval) return;
    this.lastAck = this.now();
    this.ack(message);
  }

  handle(user, message, tags = {}) {
    const command = parseCommand(message);
    if (!command) return null;
    const name = user.toLowerCase();
    const badges = tags.badges ?? {};
    const moderator = Boolean(
      tags.mod ||
      tags.moderator ||
      tags.broadcaster ||
      badges.moderator ||
      badges.broadcaster ||
      name === this.broadcasterName,
    );
    const privileged =
      moderator ||
      Boolean(tags.vip || badges.vip || tags.subscriber || tags.sub);

    if (command.type === "team") {
      if (!this.state.teamsEnabled) return { error: "teams-disabled" };
      this.state.teams.set(name, command.team);
      return { type: "team", user: name, team: command.team };
    }
    if (command.type === "ban") {
      if (!moderator) return { error: "permission" };
      this.state.banned.add(command.user);
      return { type: "ban", user: command.user };
    }
    if (command.type === "undo") {
      if (!moderator) return { error: "permission" };
      const target = command.user ?? this.state.strokes.at(-1)?.user;
      return {
        type: "undo",
        stroke: target ? this.state.undoUser(target) : null,
      };
    }
    if (command.type === "canvas") {
      this.sendAck(
        "StreamCanvas: paint with !paint x y color. Open the mural at /overlay.",
      );
      return { type: "canvas" };
    }
    if (this.state.banned.has(name)) return { error: "banned" };
    if (this.state.paused) return { error: "paused" };
    if (command.type === "line" && !privileged) return { error: "permission" };

    const subscriber = Boolean(tags.subscriber || tags.sub);
    const cooldown = this.cooldown * (subscriber ? 0.5 : 1);
    const lastPaint = this.lastPaint.get(name) ?? -Infinity;
    if (this.now() - lastPaint < cooldown) return { error: "cooldown" };

    this.lastPaint.set(name, this.now());
    const options = {
      team: this.state.teamsEnabled ? this.state.teams.get(name) : null,
    };
    const result =
      command.type === "paint"
        ? this.state.paint(name, command.x, command.y, command.color, options)
        : this.state.paintLine(
            name,
            command.x1,
            command.y1,
            command.x2,
            command.y2,
            command.color,
            options,
          );
    if (tags.bits && command.type === "paint") {
      const bonusPixels = Math.min(4, Math.floor(Number(tags.bits) / 100));
      for (let index = 0; index < bonusPixels; index += 1) {
        this.state.paint(
          name,
          (command.x + index + 1) % WIDTH,
          command.y,
          command.color,
          {
            ...options,
            kind: "cheer",
          },
        );
      }
    }
    this.sendAck(
      `${user} painted ${command.type === "paint" ? `(${command.x}, ${command.y})` : "a line"}!`,
    );
    return { type: command.type, result };
  }
}

/** Format a rejected command log entry with the machine-readable reason. */
export function formatCommandRejection(channel, user, message, reason) {
  const channelName = channel.replace(/^#/, "");
  return `[chat-command-rejected] channel=#${channelName} user=${user} command=${JSON.stringify(message)} reason=${reason}`;
}
