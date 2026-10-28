import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  CommandService,
  formatCommandRejection,
  parseCommand,
} from "../src/commands.js";
import { CanvasState, PALETTE, snapColor } from "../src/canvas/state.js";

function createHarness(options = {}) {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "streamcanvas-test-"),
  );
  let time = 1_000;
  const state = new CanvasState({
    file: path.join(directory, "strokes.jsonl"),
    now: () => time,
  });
  const commands = new CommandService(state, {
    cooldown: options.cooldown ?? 10_000,
    broadcasterName: options.broadcasterName ?? "",
    ack: options.ack,
    now: () => time,
  });
  return {
    state,
    commands,
    directory,
    tick: (milliseconds) => {
      time += milliseconds;
    },
    cleanup: () => fs.rmSync(directory, { recursive: true, force: true }),
  };
}

test("parses a valid paint command with a named color", () => {
  assert.deepEqual(parseCommand("!paint 3 4 red"), {
    type: "paint",
    x: 3,
    y: 4,
    color: PALETTE.red,
  });
});

test("parses a valid line command with a hex color", () => {
  assert.deepEqual(parseCommand("!line 1 2 3 4 #ffffff"), {
    type: "line",
    x1: 1,
    y1: 2,
    x2: 3,
    y2: 4,
    color: PALETTE.white,
  });
});

test("parses supported team, undo, ban, and canvas commands", () => {
  assert.deepEqual(parseCommand("!team BLUE"), { type: "team", team: "blue" });
  assert.deepEqual(parseCommand("!undo @Painter"), {
    type: "undo",
    user: "painter",
  });
  assert.deepEqual(parseCommand("!ban @BadActor"), {
    type: "ban",
    user: "badactor",
  });
  assert.deepEqual(parseCommand("!canvas"), { type: "canvas" });
});

test("rejects ordinary chat and unsupported fill commands", () => {
  assert.equal(parseCommand("hello chat"), null);
  assert.equal(parseCommand("!fill red"), null);
  assert.equal(parseCommand("!paint 1 2 red extra"), null);
});

test("rejects pixels and lines outside the mural bounds", () => {
  assert.equal(parseCommand("!paint 64 4 red"), null);
  assert.equal(parseCommand("!paint -1 4 red"), null);
  assert.equal(parseCommand("!line 1 2 64 4 red"), null);
});

test("snaps hex values to the nearest color in the fixed palette", () => {
  assert.equal(snapColor("#ff0000"), PALETTE.red);
  assert.equal(snapColor("#ffffff"), PALETTE.white);
});

test("accepts palette names case-insensitively and rejects invalid colors", () => {
  assert.equal(snapColor("TeAl"), PALETTE.teal);
  assert.equal(snapColor("not-a-color"), null);
  assert.equal(snapColor("#fff"), null);
});

test("enforces the configured regular viewer cooldown", () => {
  const { commands, state, tick, cleanup } = createHarness();
  assert.equal(commands.handle("alice", "!paint 1 1 red").type, "paint");
  assert.equal(commands.handle("alice", "!paint 2 2 blue").error, "cooldown");
  tick(10_000);
  assert.equal(commands.handle("alice", "!paint 2 2 blue").type, "paint");
  assert.equal(state.strokes.length, 2);
  cleanup();
});

test("halves cooldown for subscribers", () => {
  const { commands, state, tick, cleanup } = createHarness();
  commands.handle("subscriber", "!paint 1 1 teal", { subscriber: true });
  tick(4_999);
  assert.equal(
    commands.handle("subscriber", "!paint 2 2 teal", { subscriber: true })
      .error,
    "cooldown",
  );
  tick(1);
  assert.equal(
    commands.handle("subscriber", "!paint 2 2 teal", { subscriber: true }).type,
    "paint",
  );
  assert.equal(state.strokes.length, 2);
  cleanup();
});

test("denies regular viewers permission to draw lines", () => {
  const { commands, state, cleanup } = createHarness();
  assert.equal(
    commands.handle("viewer", "!line 1 1 3 1 red").error,
    "permission",
  );
  assert.equal(state.strokes.length, 0);
  cleanup();
});

test("allows moderators to draw lines", () => {
  const { commands, state, cleanup } = createHarness();
  const result = commands.handle("mod", "!line 1 1 3 1 red", { mod: true });
  assert.equal(result.type, "line");
  assert.equal(result.result.length, 3);
  cleanup();
});

test("broadcaster badge grants moderator permissions for line, undo, and ban", () => {
  const { commands, state, cleanup } = createHarness();
  const tags = { badges: { broadcaster: "1" } };
  const painted = commands.handle("ridakalam", "!line 28 10 35 10 red", tags);
  assert.equal(painted.type, "line");
  assert.equal(painted.result.length, 8);
  assert.equal(state.strokes.length, 8);
  assert.equal(
    commands.handle("ridakalam", "!undo", tags).stroke.user,
    "ridakalam",
  );
  assert.equal(state.strokes.length, 7);
  assert.equal(
    commands.handle("ridakalam", "!ban @badactor", tags).type,
    "ban",
  );
  assert.equal(state.banned.has("badactor"), true);
  cleanup();
});

test("configured channel owner name also grants moderator permissions", () => {
  const { commands, state, cleanup } = createHarness({
    broadcasterName: "#RidaKalam",
  });
  assert.equal(commands.handle("RIDAKALAM", "!line 1 1 2 1 blue").type, "line");
  assert.equal(commands.handle("ridakalam", "!ban @spammer").type, "ban");
  assert.equal(commands.handle("ridakalam", "!undo").stroke.user, "ridakalam");
  assert.equal(state.banned.has("spammer"), true);
  cleanup();
});

test("rejection log includes channel, user, command, and reason", () => {
  assert.equal(
    formatCommandRejection(
      "#ridakalam",
      "viewer",
      "!line 1 1 2 1 red",
      "permission",
    ),
    '[chat-command-rejected] channel=#ridakalam user=viewer command="!line 1 1 2 1 red" reason=permission',
  );
});

test("denies non-moderators the undo command", () => {
  const { commands, cleanup } = createHarness();
  assert.equal(commands.handle("viewer", "!undo").error, "permission");
  cleanup();
});

test("moderator undo removes the latest stroke or a named artist stroke", () => {
  const { commands, state, tick, cleanup } = createHarness();
  commands.handle("alice", "!paint 1 1 red");
  tick(10_000);
  commands.handle("bob", "!paint 2 2 blue");
  const undone = commands.handle("mod", "!undo @alice", { mod: true });
  assert.equal(undone.stroke.user, "alice");
  assert.equal(state.strokes.length, 1);
  assert.equal(state.grid[1][1], null);
  cleanup();
});

test("denies non-moderators the ban command and accepts moderator bans", () => {
  const { commands, state, cleanup } = createHarness();
  assert.equal(commands.handle("viewer", "!ban @alice").error, "permission");
  assert.equal(
    commands.handle("mod", "!ban @alice", { mod: true }).type,
    "ban",
  );
  assert.equal(commands.handle("alice", "!paint 1 1 red").error, "banned");
  assert.equal(state.strokes.length, 0);
  cleanup();
});

test("team join assigns subsequent pixels and scores unique territory cells", () => {
  const { commands, state, tick, cleanup } = createHarness();
  commands.handle("alice", "!team red");
  commands.handle("alice", "!paint 1 1 red");
  commands.handle("bob", "!team blue");
  commands.handle("bob", "!paint 2 2 blue");
  tick(10_000);
  commands.handle("alice", "!paint 2 2 red");
  assert.deepEqual(state.stats().territory, { red: 2, blue: 0 });
  assert.deepEqual(state.stats().territoryPercent, { red: 100, blue: 0 });
  cleanup();
});

test("team toggle disables team joins and territory tracking", () => {
  const { commands, state, cleanup } = createHarness();
  state.teamsEnabled = false;
  assert.equal(commands.handle("alice", "!team red").error, "teams-disabled");
  assert.deepEqual(state.stats().territory, { red: 0, blue: 0 });
  cleanup();
});

test("template completion counts filled guide cells", () => {
  const { commands, state, cleanup } = createHarness();
  const template = Array(64 * 36).fill(0);
  template[0] = 255;
  template[1] = 255;
  state.setTemplate(template);
  assert.deepEqual(state.templateProgress(), {
    target: 2,
    filled: 0,
    percent: 0,
  });
  commands.handle("alice", "!paint 0 0 red");
  assert.deepEqual(state.templateProgress(), {
    target: 2,
    filled: 1,
    percent: 50,
  });
  cleanup();
});

test("rejects malformed mural templates", () => {
  const { state, cleanup } = createHarness();
  assert.throws(() => state.setTemplate([255, 0]), /2,304 alpha values/);
  cleanup();
});

test("reloads paint and undo records from the JSONL persistence log", () => {
  const { commands, state, directory, tick, cleanup } = createHarness();
  commands.handle("alice", "!paint 1 1 red");
  tick(10_000);
  commands.handle("bob", "!paint 2 2 blue");
  state.undoUser("alice");
  const reloaded = new CanvasState({
    file: path.join(directory, "strokes.jsonl"),
  });
  assert.equal(reloaded.strokes.length, 1);
  assert.equal(reloaded.grid[1][1], null);
  assert.equal(reloaded.grid[2][2], PALETTE.blue);
  cleanup();
});

test("persists template data across a state restart", () => {
  const { state, directory, cleanup } = createHarness();
  const template = Array(64 * 36).fill(0);
  template[100] = 180;
  state.setTemplate(template);
  const reloaded = new CanvasState({
    file: path.join(directory, "strokes.jsonl"),
  });
  assert.equal(reloaded.template[100], 180);
  cleanup();
});
