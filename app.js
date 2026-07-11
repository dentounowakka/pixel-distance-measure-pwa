const DB_NAME = "image-distance-measure";
const DB_VERSION = 1;
const STORE_NAME = "workspace";
const STATE_KEY = "current";

const defaults = {
  mode: "measure",
  opacity1: 1,
  opacity2: 0.55,
  referenceMm: 50,
  image2Offset: { x: 0, y: 0 },
  referenceLine: null,
  measurementLine: null,
  zoom: 1,
  viewOffset: { x: 0, y: 0 }
};

const state = structuredClone(defaults);
state.image1 = null;
state.image2 = null;
state.pendingPoint = null;

const $ = (selector) => document.querySelector(selector);
const canvas = $("#measurementCanvas");
const ctx = canvas.getContext("2d");
const stage = $("#canvasStage");

let viewport = { width: 1, height: 1, dpr: 1 };
let imageBounds = { x: 0, y: 0, width: 1, height: 1 };
let pointerAction = null;
let saveTimer = null;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readWorkspace() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function writeWorkspace(payload) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(payload, STATE_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteWorkspace() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(STATE_KEY);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  $("#saveStatus").textContent = "保存中…";
  saveTimer = setTimeout(async () => {
    try {
      await writeWorkspace({
        mode: state.mode,
        opacity1: state.opacity1,
        opacity2: state.opacity2,
        referenceMm: state.referenceMm,
        image2Offset: state.image2Offset,
        referenceLine: state.referenceLine,
        measurementLine: state.measurementLine,
        zoom: state.zoom,
        viewOffset: state.viewOffset,
        image1: state.image1 ? { name: state.image1.name, blob: state.image1.blob } : null,
        image2: state.image2 ? { name: state.image2.name, blob: state.image2.blob } : null
      });
      $("#saveStatus").textContent = "端末に保存済み";
    } catch (error) {
      console.error(error);
      $("#saveStatus").textContent = "保存できませんでした";
    }
  }, 250);
}

function blobToImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => resolve({ image, url });
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("画像を読み込めませんでした")); };
    image.src = url;
  });
}

async function createImageRecord(blob, name) {
  const loaded = await blobToImage(blob);
  return { ...loaded, blob, name };
}

function releaseImage(record) {
  if (record?.url) URL.revokeObjectURL(record.url);
}

function baseImageSize() {
  const images = [state.image1?.image, state.image2?.image].filter(Boolean);
  if (!images.length) return { width: 1, height: 1 };
  return {
    width: Math.max(...images.map((image) => image.naturalWidth)),
    height: Math.max(...images.map((image) => image.naturalHeight))
  };
}

function fitScale() {
  const size = baseImageSize();
  const padding = viewport.width < 600 ? 18 : 36;
  return Math.min((viewport.width - padding * 2) / size.width, (viewport.height - padding * 2) / size.height, 1);
}

function worldToScreen(point) {
  return {
    x: imageBounds.x + (point.x + state.viewOffset.x) * state.zoom,
    y: imageBounds.y + (point.y + state.viewOffset.y) * state.zoom
  };
}

function screenToWorld(point) {
  return {
    x: (point.x - imageBounds.x) / state.zoom - state.viewOffset.x,
    y: (point.y - imageBounds.y) / state.zoom - state.viewOffset.y
  };
}

function distance(line) {
  if (!line) return null;
  return Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);
}

function drawLine(line, color, label) {
  if (!line) return;
  const start = worldToScreen(line.start);
  const end = worldToScreen(line.end);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.setLineDash(label === "基準" ? [8, 5] : []);
  ctx.beginPath(); ctx.moveTo(start.x, start.y); ctx.lineTo(end.x, end.y); ctx.stroke();
  for (const point of [start, end]) {
    ctx.beginPath(); ctx.arc(point.x, point.y, 5, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "white"; ctx.stroke();
  }
  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const text = `${label} ${distance(line).toFixed(1)} px`;
  ctx.font = "600 12px Segoe UI, sans-serif";
  const width = ctx.measureText(text).width + 14;
  ctx.fillStyle = "rgba(23, 35, 33, 0.88)";
  ctx.fillRect(midX - width / 2, midY - 27, width, 21);
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.fillText(text, midX, midY - 12);
  ctx.restore();
}

function draw() {
  ctx.clearRect(0, 0, viewport.width, viewport.height);
  const size = baseImageSize();
  imageBounds = {
    x: (viewport.width - size.width * state.zoom) / 2,
    y: (viewport.height - size.height * state.zoom) / 2,
    width: size.width * state.zoom,
    height: size.height * state.zoom
  };

  const drawImage = (record, opacity, offset = { x: 0, y: 0 }) => {
    if (!record) return;
    const x = imageBounds.x + (state.viewOffset.x + offset.x) * state.zoom;
    const y = imageBounds.y + (state.viewOffset.y + offset.y) * state.zoom;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(record.image, x, y, record.image.naturalWidth * state.zoom, record.image.naturalHeight * state.zoom);
    ctx.restore();
  };

  drawImage(state.image1, state.opacity1);
  drawImage(state.image2, state.opacity2, state.image2Offset);
  drawLine(state.referenceLine, "#168a67", "基準");
  drawLine(state.measurementLine, "#e0523f", "測定");

  if (state.pendingPoint) {
    const point = worldToScreen(state.pendingPoint);
    ctx.save();
    ctx.fillStyle = state.mode === "reference" ? "#168a67" : "#e0523f";
    ctx.beginPath(); ctx.arc(point.x, point.y, 6, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = "white"; ctx.stroke();
    ctx.restore();
  }
}

function updateResults() {
  const measuredPx = distance(state.measurementLine);
  const referencePx = distance(state.referenceLine);
  $("#pixelResult").textContent = measuredPx === null ? "— px" : `${measuredPx.toFixed(2)} px`;

  if (measuredPx !== null && referencePx && state.referenceMm > 0) {
    const mm = measuredPx * state.referenceMm / referencePx;
    $("#millimeterResult").textContent = `${mm.toFixed(3)} mm`;
  } else {
    $("#millimeterResult").textContent = referencePx ? "測定点を指定" : "基準線を設定";
  }

  $("#referenceResult").textContent = referencePx
    ? `基準: ${referencePx.toFixed(2)} px = ${state.referenceMm} mm`
    : "基準: 未設定";
  $("#alignmentPosition").textContent = `画像2: x ${state.image2Offset.x.toFixed(1)}px / y ${state.image2Offset.y.toFixed(1)}px`;
}

function updateControls() {
  document.querySelectorAll(".mode-button").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  stage.dataset.mode = state.mode;
  const help = {
    measure: "画像上の始点と終点を順に指定します。",
    reference: "実寸が分かる区間の始点と終点を指定します。",
    align: "画像2をドラッグして画像1に重ね合わせます。"
  };
  $("#modeHelp").textContent = help[state.mode];
  $("#opacity1").value = Math.round(state.opacity1 * 100);
  $("#opacity2").value = Math.round(state.opacity2 * 100);
  $("#opacityValue1").textContent = `${Math.round(state.opacity1 * 100)}%`;
  $("#opacityValue2").textContent = `${Math.round(state.opacity2 * 100)}%`;
  $("#referenceMm").value = state.referenceMm;
  $("#zoomValue").textContent = `${Math.round(state.zoom / fitScale() * 100)}%`;
  $("#imageName1").textContent = state.image1?.name || "未選択";
  $("#imageName2").textContent = state.image2?.name || "未選択";
  $("#emptyState").classList.toggle("hidden", Boolean(state.image1 || state.image2));
  updateResults();
}

function render() { updateControls(); draw(); }

function resizeCanvas() {
  const rect = stage.getBoundingClientRect();
  viewport = { width: Math.max(1, rect.width), height: Math.max(1, rect.height), dpr: Math.min(window.devicePixelRatio || 1, 2) };
  canvas.width = Math.round(viewport.width * viewport.dpr);
  canvas.height = Math.round(viewport.height * viewport.dpr);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
  draw();
}

async function selectImage(slot, file) {
  if (!file?.type.startsWith("image/")) return;
  try {
    const record = await createImageRecord(file, file.name);
    releaseImage(state[slot]);
    state[slot] = record;
    state.zoom = fitScale();
    state.viewOffset = { x: 0, y: 0 };
    if (slot === "image2") state.image2Offset = { x: 0, y: 0 };
    render();
    scheduleSave();
  } catch (error) {
    console.error(error);
    $("#saveStatus").textContent = "画像を読み込めませんでした";
  }
}

function eventPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

canvas.addEventListener("pointerdown", (event) => {
  if (!state.image1 && !state.image2) return;
  canvas.setPointerCapture(event.pointerId);
  const screen = eventPoint(event);
  if (state.mode === "align") {
    if (!state.image2) return;
    pointerAction = { type: "align", start: screen, original: { ...state.image2Offset } };
    stage.classList.add("dragging");
    return;
  }
  if (event.button === 1 || event.altKey) {
    pointerAction = { type: "pan", start: screen, original: { ...state.viewOffset } };
    stage.classList.add("dragging");
    return;
  }
  const point = screenToWorld(screen);
  if (!state.pendingPoint) {
    state.pendingPoint = point;
  } else {
    const line = { start: state.pendingPoint, end: point };
    if (state.mode === "reference") state.referenceLine = line;
    else state.measurementLine = line;
    state.pendingPoint = null;
    scheduleSave();
  }
  render();
});

canvas.addEventListener("pointermove", (event) => {
  const screen = eventPoint(event);
  const world = screenToWorld(screen);
  $("#pointerPosition").textContent = `x: ${world.x.toFixed(1)} / y: ${world.y.toFixed(1)}`;
  if (!pointerAction) return;
  const dx = (screen.x - pointerAction.start.x) / state.zoom;
  const dy = (screen.y - pointerAction.start.y) / state.zoom;
  if (pointerAction.type === "align") state.image2Offset = { x: pointerAction.original.x + dx, y: pointerAction.original.y + dy };
  else state.viewOffset = { x: pointerAction.original.x + dx, y: pointerAction.original.y + dy };
  draw(); updateResults();
});

function finishPointer() {
  if (pointerAction) scheduleSave();
  pointerAction = null;
  stage.classList.remove("dragging");
}
canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
canvas.addEventListener("pointerleave", () => { if (!pointerAction) $("#pointerPosition").textContent = "x: — / y: —"; });
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

stage.addEventListener("wheel", (event) => {
  if (!state.image1 && !state.image2) return;
  event.preventDefault();
  const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
  state.zoom = Math.min(Math.max(state.zoom * factor, fitScale() * 0.25), 8);
  render(); scheduleSave();
}, { passive: false });

$("#imageInput1").addEventListener("change", (event) => selectImage("image1", event.target.files[0]));
$("#imageInput2").addEventListener("change", (event) => selectImage("image2", event.target.files[0]));

document.querySelectorAll(".mode-button").forEach((button) => button.addEventListener("click", () => {
  state.mode = button.dataset.mode;
  state.pendingPoint = null;
  render(); scheduleSave();
}));

for (const number of [1, 2]) {
  $(`#opacity${number}`).addEventListener("input", (event) => {
    state[`opacity${number}`] = Number(event.target.value) / 100;
    render(); scheduleSave();
  });
}

$("#referenceMm").addEventListener("input", (event) => {
  state.referenceMm = Math.max(0, Number(event.target.value) || 0);
  updateResults(); scheduleSave();
});

$("#resetImage2").addEventListener("click", () => {
  state.image2Offset = { x: 0, y: 0 };
  render(); scheduleSave();
});

$("#clearLines").addEventListener("click", () => {
  state.referenceLine = null;
  state.measurementLine = null;
  state.pendingPoint = null;
  render(); scheduleSave();
});

$("#clearAll").addEventListener("click", async () => {
  if (!confirm("端末に保存した画像と設定をすべて消去しますか？")) return;
  releaseImage(state.image1); releaseImage(state.image2);
  Object.assign(state, structuredClone(defaults), { image1: null, image2: null, pendingPoint: null });
  await deleteWorkspace();
  state.zoom = fitScale();
  $("#saveStatus").textContent = "端末データを消去済み";
  render();
});

function changeZoom(factor) {
  state.zoom = Math.min(Math.max(state.zoom * factor, fitScale() * 0.25), 8);
  render(); scheduleSave();
}
$("#zoomIn").addEventListener("click", () => changeZoom(1.2));
$("#zoomOut").addEventListener("click", () => changeZoom(1 / 1.2));
$("#fitView").addEventListener("click", () => {
  state.zoom = fitScale(); state.viewOffset = { x: 0, y: 0 }; render(); scheduleSave();
});

new ResizeObserver(resizeCanvas).observe(stage);

async function restore() {
  try {
    const saved = await readWorkspace();
    if (saved) {
      Object.assign(state, defaults, saved);
      if (saved.image1?.blob) state.image1 = await createImageRecord(saved.image1.blob, saved.image1.name);
      if (saved.image2?.blob) state.image2 = await createImageRecord(saved.image2.blob, saved.image2.name);
      $("#saveStatus").textContent = "端末データを復元済み";
    }
  } catch (error) {
    console.error(error);
    $("#saveStatus").textContent = "保存データを復元できませんでした";
  }
  if (!state.image1 && !state.image2) state.zoom = fitScale();
  render();
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./service-worker.js").catch(console.error));
}

restore();
