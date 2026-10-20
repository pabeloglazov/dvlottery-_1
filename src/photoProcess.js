// Обработка фото под требования DV прямо в браузере:
// поиск лица (MediaPipe Face Detector) → белый фон (Selfie Segmenter) → кадр 600×600 → JPEG ≤ 240 КБ.
// Правила DV: голова (макушка–подбородок) 50–69% высоты кадра, глаза на 56–69% высоты от низа.

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const SIZE = 600;
const MAX_BYTES = 240 * 1024;
const HEAD_TARGET = 0.6;           // доля головы в кадре
const EYE_MIN = SIZE * (1 - 0.69); // глаза от верха: 186…264 px
const EYE_MAX = SIZE * (1 - 0.56);

let toolsP = null;
function tools() {
  if (!toolsP) {
    toolsP = (async () => {
      const { FilesetResolver, FaceDetector, ImageSegmenter } = await import("@mediapipe/tasks-vision");
      const fs = await FilesetResolver.forVisionTasks(WASM);
      const base = import.meta.env.BASE_URL || "/";
      const make = (delegate) => Promise.all([
        FaceDetector.createFromOptions(fs, { baseOptions: { modelAssetPath: base + "models/face.tflite", delegate }, runningMode: "IMAGE", minDetectionConfidence: 0.5 }),
        ImageSegmenter.createFromOptions(fs, { baseOptions: { modelAssetPath: base + "models/selfie.tflite", delegate }, runningMode: "IMAGE", outputConfidenceMasks: true, outputCategoryMask: false }),
      ]);
      let face, seg;
      try { [face, seg] = await make("GPU"); } catch { [face, seg] = await make("CPU"); }
      return { face, seg };
    })();
    toolsP.catch(() => { toolsP = null; });
  }
  return toolsP;
}
// Заранее подгрузить модели (когда человек дошёл до шага с фото).
export function warmUpPhotoTools() { tools().catch(() => {}); }

function loadImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); res(img); };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("load")); };
    img.src = url;
  });
}
const canvas = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
const tick = () => new Promise((r) => setTimeout(r, 30));

function jpegUnder(c, max) {
  let q = 0.92, url = c.toDataURL("image/jpeg", q);
  while (url.length * 0.75 > max && q > 0.4) { q -= 0.06; url = c.toDataURL("image/jpeg", q); }
  return url;
}

// Где у человека «срез»: край исходника, в который он упирается, или ровная горизонтальная граница внутри фото
// (если фото уже обрезали раньше и под ним белое поле). Эти срезы надо увести за кадр.
export function findEdges(m, W, H) {
  const at = (x, y) => m.a[y * m.w + x] > 0.5;
  const e = { bY: null, l: false, r: false, t: false };
  for (let x = 0; x < m.w; x++) { if (at(x, m.h - 1) || at(x, m.h - 2)) { e.bY = H; break; } }
  if (e.bY === null) {
    for (let y = m.h - 1; y > m.h * 0.5; y--) {
      let n = 0; for (let x = 0; x < m.w; x++) if (at(x, y)) n++;
      if (n > 0) { if (n / m.w >= 0.3) e.bY = (y + 1) / m.h * H; break; }
    }
  }
  for (let y = Math.floor(m.h * 0.2); y < m.h; y++) { if (at(0, y) || at(1, y)) e.l = true; if (at(m.w - 1, y) || at(m.w - 2, y)) e.r = true; }
  for (let x = 0; x < m.w; x++) if (at(x, 0) || at(x, 1)) { e.t = true; break; }
  return e;
}
// Видны ли срезы в кадре (тогда фото помечается: нужен снимок с запасом). Ничего не растушёвываем.
export function visibleCut(e, W, dx, dy, s) {
  const gB = e.bY !== null ? SIZE - (dy + e.bY * s) : 0, gL = e.l ? dx : 0, gR = e.r ? SIZE - (dx + W * s) : 0, gT = e.t ? dy : 0;
  return gB > 6 || gL > 6 || gR > 6 || gT > 6;
}

// Подбор масштаба и положения: голова 50–69% (лучше ~60%), глаза 56–69% от низа, отступ над головой,
// края исходника, в которые упирается человек, — за пределами кадра.
export function fitFrame({ W, H, eyeX, eyeY, topY, headH, mask }) {
  const e = findEdges(mask, W, H);
  const s0 = (SIZE * HEAD_TARGET) / headH, sMax = (SIZE * 0.68) / headH, sMin = (SIZE * 0.52) / headH;
  let best = null;
  for (let i = 0; i <= 24; i++) {
    const s = sMin + (sMax - sMin) * i / 24;
    for (let eyeT = EYE_MIN + 4; eyeT <= EYE_MAX - 4; eyeT += 4) {
      for (let off = -36; off <= 36; off += 6) {
        const dx = SIZE / 2 + off - eyeX * s, dy = eyeT - eyeY * s;
        const top = dy + topY * s;
        const gap = (e.bY !== null ? Math.max(0, SIZE - (dy + e.bY * s)) : 0) + (e.l ? Math.max(0, dx) : 0) + (e.r ? Math.max(0, SIZE - (dx + W * s)) : 0);
        const topPen = top < SIZE * 0.04 ? (SIZE * 0.04 - top) * 20 : top > SIZE * 0.16 ? (top - SIZE * 0.16) * 2 : 0;
        const score = gap * 10 + topPen + Math.abs(s - s0) / s0 * 120 + Math.abs(eyeT - SIZE * 0.375) * 0.15 + Math.abs(off) * 0.4;
        if (!best || score < best.score) best = { score, s, eyeT, dx, dy, gap, edges: e };
      }
    }
  }
  return best;
}

/**
 * file → { original, processed, metrics } или ошибка с code: "load" | "no_face" | "tools".
 * onStage(i): 0 — ищу лицо, 1 — убираю фон, 2 — кадрирую.
 */
export async function processPhoto(file, onStage = () => {}) {
  let img;
  try { img = await loadImage(file); } catch { throw Object.assign(new Error("load"), { code: "load" }); }
  const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.round(img.naturalWidth * k), H = Math.round(img.naturalHeight * k);
  const src = canvas(W, H);
  src.getContext("2d").drawImage(img, 0, 0, W, H);
  const original = jpegUnder(src, 1.5 * 1024 * 1024);

  onStage(0); await tick();
  let t;
  try { t = await tools(); } catch { throw Object.assign(new Error("tools"), { code: "tools" }); }
  const det = t.face.detect(src).detections || [];
  if (!det.length) throw Object.assign(new Error("no_face"), { code: "no_face", original });
  const f = det.slice().sort((a, b) => b.boundingBox.width * b.boundingBox.height - a.boundingBox.width * a.boundingBox.height)[0];
  const kp = f.keypoints.map((p) => ({ x: p.x * W, y: p.y * H }));
  const eyeX = (kp[0].x + kp[1].x) / 2, eyeY = (kp[0].y + kp[1].y) / 2, mouthY = kp[3].y;
  const bb = f.boundingBox;

  onStage(1); await tick();
  const res = t.seg.segment(src);
  const masks = res.confidenceMasks || [];
  // Маска «человек»: та, где в центре лица уверенность выше.
  let best = null, bestV = -1;
  masks.forEach((m) => {
    const a = m.getAsFloat32Array(), mx = Math.min(m.width - 1, Math.round(eyeX / W * m.width)), my = Math.min(m.height - 1, Math.round(eyeY / H * m.height));
    const v = a[my * m.width + mx];
    if (v > bestV) { bestV = v; best = { a: Float32Array.from(a), w: m.width, h: m.height }; }
  });
  res.close && res.close();
  if (!best) throw Object.assign(new Error("tools"), { code: "tools" });
  // Альфа-маска с мягким краем.
  const mc = canvas(best.w, best.h), md = mc.getContext("2d").createImageData(best.w, best.h);
  for (let i = 0; i < best.a.length; i++) {
    const v = Math.min(1, Math.max(0, (best.a[i] - 0.25) / 0.5));
    md.data[i * 4 + 3] = Math.round(v * 255);
  }
  mc.getContext("2d").putImageData(md, 0, 0);
  const person = canvas(W, H), pc = person.getContext("2d");
  pc.drawImage(src, 0, 0);
  pc.globalCompositeOperation = "destination-in";
  pc.filter = "blur(" + Math.max(1, Math.round(W / 500)) + "px)";
  pc.drawImage(mc, 0, 0, W, H);
  pc.filter = "none"; pc.globalCompositeOperation = "source-over";

  // Макушка — верхняя граница маски над лицом; подбородок — по рту и рамке лица.
  let topY = Math.max(0, bb.originY - bb.height * 0.45);
  const x0 = Math.max(0, Math.floor((bb.originX + bb.width * 0.3) / W * best.w)), x1 = Math.min(best.w - 1, Math.ceil((bb.originX + bb.width * 0.7) / W * best.w));
  const yLimit = Math.floor(eyeY / H * best.h);
  scan: for (let y = 0; y < yLimit; y++) for (let x = x0; x <= x1; x++) if (best.a[y * best.w + x] > 0.5) { topY = y / best.h * H; break scan; }
  const chinY = Math.max(bb.originY + bb.height, mouthY + (mouthY - eyeY) * 0.9);
  const headH = Math.max(10, chinY - topY);

  onStage(2); await tick();
  const fit = fitFrame({ W, H, eyeX, eyeY, topY, headH, mask: best });
  const s = fit.s, eyeT = fit.eyeT;
  const out = canvas(SIZE, SIZE), oc = out.getContext("2d");
  oc.fillStyle = "#fff"; oc.fillRect(0, 0, SIZE, SIZE);
  oc.imageSmoothingQuality = "high";
  oc.drawImage(person, fit.dx, fit.dy, W * s, H * s);
  const processed = jpegUnder(out, MAX_BYTES);
  return {
    original, processed,
    metrics: { cut: visibleCut(fit.edges, W, fit.dx, fit.dy, s), head: Math.round(headH * s / SIZE * 100), eyes: Math.round((SIZE - eyeT) / SIZE * 100), faces: det.length, kb: Math.round(processed.length * 0.75 / 1024) },
  };
}
