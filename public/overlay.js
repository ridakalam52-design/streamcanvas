const CELL = 20;
const WIDTH = 64;
const HEIGHT = 36;
const canvas = document.querySelector("#mural");
const context = canvas.getContext("2d");
const ticker = document.querySelector("#ticker-artists");
const recentPainters = new Map();
const knownStrokeIds = new Set();
let hasInitialState = false;
let bannerTimer;

context.imageSmoothingEnabled = false;

/** Add coordinate marks at every eighth pixel along both mural axes. */
function buildAxisLabels() {
  for (let x = 0; x < WIDTH; x += 8) {
    const label = document.createElement("span");
    label.textContent = String(x).padStart(2, "0");
    document.querySelector("#axis-top").append(label);
  }
  for (let y = 0; y < HEIGHT; y += 8) {
    const label = document.createElement("span");
    label.textContent = String(y).padStart(2, "0");
    document.querySelector("#axis-left").append(label);
  }
}

/** Draw the guide, mural, and lightweight coordinate grid. */
function draw(state, animatedStrokes = []) {
  context.fillStyle = "#14141d";
  context.fillRect(0, 0, canvas.width, canvas.height);
  drawTemplate(state.template);

  const animated = new Map(
    animatedStrokes.map((stroke) => [stroke.id, stroke]),
  );
  for (const stroke of state.strokes ?? []) {
    if (animated.has(stroke.id)) continue;
    drawPixel(stroke, 1);
  }
  drawGrid();
  animatedStrokes.forEach((stroke, index) => animatePixel(stroke, index * 24));
}

function drawTemplate(template) {
  if (!template) return;
  template.forEach((alpha, index) => {
    if (alpha < 24) return;
    context.fillStyle = `rgba(232, 234, 255, ${Math.min(0.22, (alpha / 255) * 0.22)})`;
    context.fillRect(
      (index % WIDTH) * CELL,
      Math.floor(index / WIDTH) * CELL,
      CELL,
      CELL,
    );
  });
}

function drawPixel(stroke, scale, alpha = 1) {
  const size = CELL * scale;
  const inset = (CELL - size) / 2;
  context.save();
  context.globalAlpha = alpha;
  context.fillStyle = stroke.color;
  context.fillRect(
    stroke.x * CELL + inset,
    stroke.y * CELL + inset,
    size,
    size,
  );
  context.restore();
}

function drawGrid() {
  context.lineWidth = 1;
  context.strokeStyle = "rgba(242, 242, 255, 0.10)";
  for (let x = 0; x <= WIDTH; x += 8) {
    context.beginPath();
    context.moveTo(x * CELL + 0.5, 0);
    context.lineTo(x * CELL + 0.5, canvas.height);
    context.stroke();
  }
  for (let y = 0; y <= HEIGHT; y += 8) {
    context.beginPath();
    context.moveTo(0, y * CELL + 0.5);
    context.lineTo(canvas.width, y * CELL + 0.5);
    context.stroke();
  }
}

function animatePixel(stroke, delay) {
  const started = performance.now() + delay;
  const duration = 360;
  function frame(now) {
    if (now < started) {
      requestAnimationFrame(frame);
      return;
    }
    const progress = Math.min(1, (now - started) / duration);
    const eased = 1 - (1 - progress) ** 3;
    const scale = 0.12 + 0.88 * eased;
    const drop = (1 - eased) * -12;
    context.save();
    context.translate(0, drop);
    drawPixel(stroke, scale, Math.min(1, progress * 2.5));
    context.restore();
    if (progress < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function renderBattle(stats) {
  const red = stats?.territoryPercent?.red ?? 0;
  const blue = stats?.territoryPercent?.blue ?? 0;
  document.querySelector("#red-pct").textContent = `${red}%`;
  document.querySelector("#blue-pct").textContent = `${blue}%`;
  document.querySelector("#red-territory").style.width = `${red}%`;
  document.querySelector("#blue-territory").style.width = `${blue}%`;
}

function renderProgress(progress) {
  const card = document.querySelector("#progress-card");
  card.hidden = !progress;
  if (!progress) return;
  document.querySelector("#progress-label").textContent =
    `${progress.percent}%`;
  document.querySelector("#progress-fill").style.width = `${progress.percent}%`;
}

function renderTicker(strokes) {
  for (const stroke of strokes.slice(-20)) {
    recentPainters.delete(stroke.user);
    recentPainters.set(stroke.user, stroke.color);
  }
  const latest = [...recentPainters].reverse().slice(0, 5);
  ticker.replaceChildren(
    ...latest.map(([user, color]) => {
      const item = document.createElement("span");
      item.className = "ticker-person";
      const swatch = document.createElement("i");
      swatch.style.backgroundColor = color;
      const name = document.createElement("b");
      name.textContent = user;
      item.append(swatch, name);
      return item;
    }),
  );
}

function showBanner(text) {
  const banner = document.querySelector("#raid-banner");
  banner.textContent = text;
  banner.classList.add("visible");
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => banner.classList.remove("visible"), 5000);
}

function render(state) {
  const strokes = state.strokes ?? [];
  const newStrokes = strokes.filter((stroke) => !knownStrokeIds.has(stroke.id));
  strokes.forEach((stroke) => knownStrokeIds.add(stroke.id));
  draw(state, newStrokes.slice(-24));
  renderBattle(state.stats);
  document.querySelector(".battle-row").hidden = state.teamsEnabled === false;
  renderProgress(state.templateProgress);
  renderTicker(strokes);
}

function connect() {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${scheme}//${location.host}`);
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.state) render(message.state);
    if (message.type === "banner") showBanner(message.text);
  };
  socket.onclose = () => setTimeout(connect, 1500);
}

buildAxisLabels();
fetch("/api/state")
  .then((response) => response.json())
  .then(render);
connect();
