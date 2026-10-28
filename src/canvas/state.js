import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WIDTH = 64;
export const HEIGHT = 36;
export const PALETTE = {
  red: "#ef476f",
  orange: "#f78c3d",
  yellow: "#ffd166",
  green: "#43aa8b",
  teal: "#31b7aa",
  blue: "#4285f4",
  purple: "#9b5de5",
  pink: "#f15bb5",
  white: "#f8f9fa",
  black: "#17202a",
  brown: "#8d5a3b",
  gray: "#8d99ae",
};

const defaultFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/strokes.jsonl",
);
const templateFile = path.resolve(path.dirname(defaultFile), "template.json");
const makeGrid = (fill = null) =>
  Array.from({ length: HEIGHT }, () => Array(WIDTH).fill(fill));

/** Return a palette color by name or the closest palette color to a hex value. */
export function snapColor(input) {
  const value = String(input ?? "").toLowerCase();
  if (PALETTE[value]) return PALETTE[value];
  if (!/^#[0-9a-f]{6}$/i.test(value)) return null;

  const rgb = value
    .slice(1)
    .match(/.{2}/g)
    .map((part) => parseInt(part, 16));
  let closest = null;
  let distance = Infinity;
  for (const hex of Object.values(PALETTE)) {
    const candidate = hex
      .slice(1)
      .match(/.{2}/g)
      .map((part) => parseInt(part, 16));
    const nextDistance = rgb.reduce(
      (sum, channel, index) => sum + (channel - candidate[index]) ** 2,
      0,
    );
    if (nextDistance < distance) {
      distance = nextDistance;
      closest = hex;
    }
  }
  return closest;
}

/** Owns the mural, session log, teams, and optional ghost template. */
export class CanvasState {
  constructor({ file = defaultFile, now = () => Date.now() } = {}) {
    this.file = file;
    this.templateFile = path.join(path.dirname(file), "template.json");
    this.now = now;
    this.grid = makeGrid();
    this.strokes = [];
    this.users = new Map();
    this.teams = new Map();
    this.banned = new Set();
    this.paused = false;
    this.teamsEnabled = true;
    this.cooldownSeconds = 10;
    this.template = null;
    this.load();
    this.loadTemplate();
  }

  /** Replay valid log records, ignoring an interrupted final record. */
  load() {
    if (!fs.existsSync(this.file)) return;
    for (const line of fs
      .readFileSync(this.file, "utf8")
      .split("\n")
      .filter(Boolean)) {
      try {
        const record = JSON.parse(line);
        if (record.type === "paint") this.apply(record, false);
        if (record.type === "undo") {
          this.strokes = this.strokes.filter(
            (stroke) => stroke.id !== record.strokeId,
          );
          this.rebuild();
        }
      } catch {
        // A partial or malformed record should not prevent the mural from loading.
      }
    }
  }

  loadTemplate() {
    try {
      this.template = JSON.parse(fs.readFileSync(this.templateFile, "utf8"));
    } catch {
      this.template = null;
    }
  }

  persist(record) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.appendFileSync(this.file, `${JSON.stringify(record)}\n`);
  }

  /** Add one valid pixel to the canvas and append its stroke to the log. */
  apply(stroke, record = true) {
    if (
      !Number.isInteger(stroke.x) ||
      !Number.isInteger(stroke.y) ||
      stroke.x < 0 ||
      stroke.y < 0 ||
      stroke.x >= WIDTH ||
      stroke.y >= HEIGHT
    ) {
      return false;
    }
    const savedStroke = {
      id:
        stroke.id ?? `${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
      user: stroke.user,
      x: stroke.x,
      y: stroke.y,
      color: stroke.color,
      team: stroke.team ?? null,
      at: stroke.at ?? this.now(),
      kind: stroke.kind ?? "pixel",
    };
    this.grid[savedStroke.y][savedStroke.x] = savedStroke.color;
    this.strokes.push(savedStroke);
    this.users.set(
      savedStroke.user,
      (this.users.get(savedStroke.user) ?? 0) + 1,
    );
    if (record) this.persist({ type: "paint", ...savedStroke });
    return savedStroke;
  }

  rebuild() {
    this.grid = makeGrid();
    this.users.clear();
    for (const stroke of this.strokes) {
      this.grid[stroke.y][stroke.x] = stroke.color;
      this.users.set(stroke.user, (this.users.get(stroke.user) ?? 0) + 1);
    }
  }

  paint(user, x, y, color, { team = null, kind = "pixel" } = {}) {
    return this.apply({ user, x, y, color, team, kind });
  }

  /** Draw a straight Bresenham line and return its newly logged pixels. */
  paintLine(user, x1, y1, x2, y2, color, options = {}) {
    const drawn = [];
    const dx = Math.abs(x2 - x1);
    const sx = x1 < x2 ? 1 : -1;
    const dy = -Math.abs(y2 - y1);
    const sy = y1 < y2 ? 1 : -1;
    let error = dx + dy;
    while (true) {
      const stroke = this.paint(user, x1, y1, color, options);
      if (stroke) drawn.push(stroke);
      if (x1 === x2 && y1 === y2) break;
      const twiceError = 2 * error;
      if (twiceError >= dy) {
        error += dy;
        x1 += sx;
      }
      if (twiceError <= dx) {
        error += dx;
        y1 += sy;
      }
    }
    return drawn;
  }

  /** Remove one artist's latest logged pixel and persist the undo operation. */
  undoUser(user) {
    const stroke = [...this.strokes]
      .reverse()
      .find((item) => item.user.toLowerCase() === user.toLowerCase());
    if (!stroke) return null;
    this.strokes = this.strokes.filter((item) => item.id !== stroke.id);
    this.rebuild();
    this.persist({ type: "undo", strokeId: stroke.id });
    return stroke;
  }

  setTemplate(template) {
    if (template !== null) {
      if (
        !Array.isArray(template) ||
        template.length !== WIDTH * HEIGHT ||
        template.some(
          (alpha) => !Number.isFinite(alpha) || alpha < 0 || alpha > 255,
        )
      ) {
        throw new Error(
          "Template must contain 2,304 alpha values from 0 to 255.",
        );
      }
    }
    this.template = template;
    fs.mkdirSync(path.dirname(this.templateFile), { recursive: true });
    if (template) fs.writeFileSync(this.templateFile, JSON.stringify(template));
    else fs.rmSync(this.templateFile, { force: true });
  }

  clear() {
    this.strokes = [];
    this.grid = makeGrid();
    this.users.clear();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, "");
  }

  templateProgress() {
    if (!this.template) return null;
    let target = 0;
    let filled = 0;
    this.template.forEach((alpha, index) => {
      if (alpha >= 24) {
        target += 1;
        const x = index % WIDTH;
        const y = Math.floor(index / WIDTH);
        if (this.grid[y][x]) filled += 1;
      }
    });
    return {
      target,
      filled,
      percent: target ? Math.round((filled / target) * 100) : 0,
    };
  }

  snapshot() {
    return {
      width: WIDTH,
      height: HEIGHT,
      grid: this.grid,
      strokes: this.strokes,
      teams: Object.fromEntries(this.teams),
      paused: this.paused,
      teamsEnabled: this.teamsEnabled,
      cooldownSeconds: this.cooldownSeconds,
      template: this.template,
      templateProgress: this.templateProgress(),
      stats: this.stats(),
    };
  }

  /** Count unique painted cells by their latest team owner. */
  stats() {
    const artists = [...this.users]
      .map(([user, pixels]) => ({ user, pixels }))
      .sort((a, b) => b.pixels - a.pixels)
      .slice(0, 5);
    const territory = { red: 0, blue: 0 };
    const latest = new Map();
    for (const stroke of this.strokes) {
      latest.set(`${stroke.x},${stroke.y}`, stroke);
    }
    for (const stroke of latest.values()) {
      if (this.teamsEnabled && stroke.team in territory)
        territory[stroke.team] += 1;
    }
    const total = territory.red + territory.blue;
    return {
      painters: this.users.size,
      pixels: this.strokes.length,
      artists,
      territory,
      territoryPercent: {
        red: total ? Math.round((territory.red / total) * 100) : 0,
        blue: total ? Math.round((territory.blue / total) * 100) : 0,
      },
    };
  }
}
