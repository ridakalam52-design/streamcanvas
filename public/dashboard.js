const CELL = 20;
const WIDTH = 64;
const HEIGHT = 36;
const canvas = document.querySelector("#dashboard-canvas");
const context = canvas.getContext("2d");
const cooldownInput = document.querySelector("#cooldown");
const replayProgress = document.querySelector("#replay-progress");
let currentState = null;
let replayCancelled = false;

context.imageSmoothingEnabled = false;

/** Paint the current guide and committed pixels into the dashboard canvas. */
function drawCanvas(state, { includeGuide = true } = {}) {
  context.fillStyle = "#14141d";
  context.fillRect(0, 0, canvas.width, canvas.height);
  if (includeGuide && state.template) {
    state.template.forEach((alpha, index) => {
      if (alpha < 24) return;
      context.fillStyle = `rgba(232, 234, 255, ${Math.min(0.2, (alpha / 255) * 0.2)})`;
      context.fillRect(
        (index % WIDTH) * CELL,
        Math.floor(index / WIDTH) * CELL,
        CELL,
        CELL,
      );
    });
  }
  for (const stroke of state.strokes ?? []) {
    context.fillStyle = stroke.color;
    context.fillRect(stroke.x * CELL, stroke.y * CELL, CELL, CELL);
  }
  drawGrid();
}

function drawGrid() {
  context.strokeStyle = "rgba(242, 242, 255, 0.08)";
  context.lineWidth = 1;
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

function render(state) {
  currentState = state;
  drawCanvas(state);
  const stats = state.stats ?? {};
  document.querySelector("#pixels-stat").textContent = stats.pixels ?? 0;
  document.querySelector("#painters-stat").textContent = stats.painters ?? 0;
  document.querySelector("#teams-stat").textContent =
    `${stats.territory?.red ?? 0} : ${stats.territory?.blue ?? 0}`;
  document.querySelector("#paused-toggle").checked = Boolean(state.paused);
  document.querySelector("#teams-toggle").checked =
    state.teamsEnabled !== false;
  cooldownInput.value = state.cooldownSeconds ?? 10;
  document.querySelector("#cooldown-value").textContent = cooldownInput.value;
  renderArtists(stats.artists ?? []);
  const progress = state.templateProgress;
  document.querySelector("#template-status").textContent = progress
    ? `Guide loaded · ${progress.percent}% complete`
    : "No guide loaded";
}

function renderArtists(artists) {
  const list = document.querySelector("#artists-list");
  list.replaceChildren(
    ...artists.map((artist, index) => {
      const item = document.createElement("li");
      const rank = document.createElement("span");
      rank.className = "artist-rank";
      rank.textContent = String(index + 1).padStart(2, "0");
      const name = document.createElement("b");
      name.textContent = artist.user;
      const pixels = document.createElement("span");
      pixels.className = "artist-pixels";
      pixels.textContent = `${artist.pixels} px`;
      item.append(rank, name, pixels);
      return item;
    }),
  );
  if (!artists.length)
    list.innerHTML =
      '<li class="empty-artists">Waiting for the first brush stroke</li>';
}

async function saveSettings() {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      cooldown: Number(cooldownInput.value),
      teamsEnabled: document.querySelector("#teams-toggle").checked,
      paused: document.querySelector("#paused-toggle").checked,
    }),
  });
}

async function setTemplate(template) {
  const response = await fetch("/api/template", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ template }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not save template.");
}

/** Render a clean PNG without the ghost guide or coordinate grid. */
function downloadSnapshot() {
  const output = document.createElement("canvas");
  output.width = WIDTH;
  output.height = HEIGHT;
  const outputContext = output.getContext("2d");
  outputContext.fillStyle = "#14141d";
  outputContext.fillRect(0, 0, WIDTH, HEIGHT);
  currentState.strokes.forEach((stroke) => {
    outputContext.fillStyle = stroke.color;
    outputContext.fillRect(stroke.x, stroke.y, 1, 1);
  });
  const link = document.createElement("a");
  link.download = "streamcanvas-mural.png";
  link.href = output.toDataURL("image/png");
  link.click();
}

/** Draw a heart silhouette as a faint alpha mask over the 64 by 36 grid. */
function makeHeartTemplate() {
  return Array.from({ length: WIDTH * HEIGHT }, (_, index) => {
    const x = ((index % WIDTH) / (WIDTH - 1)) * 2.6 - 1.3;
    const y = 1.35 - (Math.floor(index / WIDTH) / (HEIGHT - 1)) * 2.5;
    const equation = (x * x + y * y - 1) ** 3 - x * x * y ** 3;
    return equation <= 0 ? 230 : 0;
  });
}

/** Fit an uploaded image to the grid and use its visible non-white pixels as a guide. */
async function imageToTemplate(file) {
  const image = new Image();
  image.src = URL.createObjectURL(file);
  await image.decode();
  const source = document.createElement("canvas");
  source.width = WIDTH;
  source.height = HEIGHT;
  const sourceContext = source.getContext("2d", { willReadFrequently: true });
  const scale = Math.min(WIDTH / image.width, HEIGHT / image.height);
  const drawWidth = Math.max(1, Math.round(image.width * scale));
  const drawHeight = Math.max(1, Math.round(image.height * scale));
  sourceContext.imageSmoothingEnabled = true;
  sourceContext.drawImage(
    image,
    (WIDTH - drawWidth) / 2,
    (HEIGHT - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  URL.revokeObjectURL(image.src);
  const pixels = sourceContext.getImageData(0, 0, WIDTH, HEIGHT).data;
  return Array.from({ length: WIDTH * HEIGHT }, (_, index) => {
    const offset = index * 4;
    const brightness = pixels[offset] + pixels[offset + 1] + pixels[offset + 2];
    if (pixels[offset + 3] < 24 || brightness > 735) return 0;
    return pixels[offset + 3];
  });
}

/** Replay each session stroke and optionally record the playback to WebM. */
async function replay(record = false) {
  const strokes = [...(currentState?.strokes ?? [])];
  if (!strokes.length) {
    document.querySelector("#replay-status").textContent =
      "Paint a few pixels before replaying.";
    return;
  }
  replayCancelled = false;
  const stream = record ? canvas.captureStream(30) : null;
  let recorder = null;
  const chunks = [];
  if (record) {
    const mimeType = [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
    ].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) {
      document.querySelector("#replay-status").textContent =
        "This browser cannot record WebM video.";
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data);
    };
    recorder.start();
  }

  context.fillStyle = "#14141d";
  context.fillRect(0, 0, canvas.width, canvas.height);
  replayProgress.value = 0;
  document.querySelector("#replay-status").textContent = record
    ? "Recording mural replay…"
    : "Playing session…";
  const delay = Math.max(2, Math.min(28, 12_000 / strokes.length));
  for (let index = 0; index < strokes.length && !replayCancelled; index += 1) {
    const stroke = strokes[index];
    context.fillStyle = stroke.color;
    context.fillRect(stroke.x * CELL, stroke.y * CELL, CELL, CELL);
    replayProgress.value = (index + 1) / strokes.length;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }

  if (recorder) {
    recorder.stop();
    await new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob(chunks, { type: "video/webm" }));
    link.download = "streamcanvas-timelapse.webm";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
    stream.getTracks().forEach((track) => track.stop());
  }
  document.querySelector("#replay-status").textContent = "Replay complete";
  drawCanvas(currentState);
}

cooldownInput.addEventListener("input", () => {
  document.querySelector("#cooldown-value").textContent = cooldownInput.value;
});
document
  .querySelector("#save-settings")
  .addEventListener("click", saveSettings);
document
  .querySelector("#snapshot-button")
  .addEventListener("click", downloadSnapshot);
document.querySelector("#clear-button").addEventListener("click", async () => {
  if (!window.confirm("Clear all mural pixels and the saved session log?"))
    return;
  await fetch("/api/clear", { method: "POST" });
});
document.querySelector("#heart-template").addEventListener("click", () => {
  setTemplate(makeHeartTemplate()).catch(showTemplateError);
});
document.querySelector("#remove-template").addEventListener("click", () => {
  setTemplate(null).catch(showTemplateError);
});
document
  .querySelector("#template-upload")
  .addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await setTemplate(await imageToTemplate(file));
    } catch (error) {
      showTemplateError(error);
    }
    event.target.value = "";
  });
document
  .querySelector("#replay-button")
  .addEventListener("click", () => replay(false));
document
  .querySelector("#webm-button")
  .addEventListener("click", () => replay(true));

function showTemplateError(error) {
  document.querySelector("#template-status").textContent = error.message;
}

fetch("/api/state")
  .then((response) => response.json())
  .then(render);
const socketScheme = location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${socketScheme}//${location.host}`);
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.state) render(message.state);
};
socket.onclose = () => setTimeout(() => location.reload(), 1500);
