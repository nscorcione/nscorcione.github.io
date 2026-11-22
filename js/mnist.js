/* ==============================================================
   DÉMO MNIST : dessin d'un chiffre et prédiction par W = pinv(E~) @ B
   Reprend test.py : même prétraitement (recadrage, boîte 20x20,
   centrage par centre de masse dans 28x28) et même prédiction
   f(x, W) = [x, 1] @ W. Tout est calculé dans le navigateur.
   ============================================================== */
(function () {
  "use strict";

  const model = window.MNIST_MODEL;
  const canvas = document.getElementById("mnist-canvas");
  if (!model || !canvas) return;

  /* ---------- Décodage de W (785 x 10, float32) ---------- */
  const bytes = Uint8Array.from(atob(model.weights), function (c) { return c.charCodeAt(0); });
  const W = new Float32Array(bytes.buffer);
  const NB_CLASSES = model.cols;           // 10
  const NB_ENTREES = model.rows - 1;       // 784 (+1 pour le biais)

  const accEl = document.querySelector("[data-mnist-acc]");
  if (accEl) accEl.textContent = (model.testAccuracy * 100).toFixed(1).replace(".", ",");

  /* ---------- Zone de dessin ---------- */
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const TAILLE = canvas.width;             // 280, comme dans test.py
  const RAYON = 10;                         // même rayon de pinceau que test.py
  const hint = document.getElementById("mnist-hint");
  const preview = document.getElementById("mnist-preview");
  const pctx = preview.getContext("2d");

  function effacer() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, TAILLE, TAILLE);
    pctx.fillStyle = "#000";
    pctx.fillRect(0, 0, 28, 28);
    hint.classList.remove("is-hidden");
    afficher(null);
  }

  let dessine = false;
  let dernier = null;

  function position(e) {
    const r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * TAILLE / r.width, y: (e.clientY - r.top) * TAILLE / r.height };
  }

  function trait(a, b) {
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = RAYON * 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    if (a) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
    else { ctx.arc(b.x, b.y, RAYON, 0, Math.PI * 2); ctx.fill(); }
  }

  canvas.addEventListener("pointerdown", function (e) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    dessine = true;
    hint.classList.add("is-hidden");
    dernier = position(e);
    trait(null, dernier);
    demanderPrediction();
  });
  canvas.addEventListener("pointermove", function (e) {
    if (!dessine) return;
    const p = position(e);
    trait(dernier, p);
    dernier = p;
    demanderPrediction();
  });
  function fin() { if (dessine) { dessine = false; predire(); } }
  canvas.addEventListener("pointerup", fin);
  canvas.addEventListener("pointercancel", fin);

  document.getElementById("mnist-clear").addEventListener("click", effacer);

  /* Prédiction limitée à une fois par image affichée pendant le tracé */
  let enAttente = false;
  function demanderPrediction() {
    if (enAttente) return;
    enAttente = true;
    requestAnimationFrame(function () { enAttente = false; predire(); });
  }

  /* ---------- Prétraitement (équivalent de DessinChiffre.pretraiter) ---------- */

  // Réduction par moyenne de surface : chaque pixel cible = moyenne pondérée
  // des pixels source qu'il recouvre.
  function redimensionner(src, largeurSrc, x0, y0, w, h, nw, nh) {
    const out = new Float64Array(nw * nh);
    const sx = w / nw, sy = h / nh;
    for (let ty = 0; ty < nh; ty++) {
      const ya = ty * sy, yb = ya + sy;
      for (let tx = 0; tx < nw; tx++) {
        const xa = tx * sx, xb = xa + sx;
        let somme = 0, poids = 0;
        for (let iy = Math.floor(ya); iy < Math.ceil(yb); iy++) {
          const wy = Math.min(iy + 1, yb) - Math.max(iy, ya);
          if (wy <= 0) continue;
          const ligne = (y0 + iy) * largeurSrc + x0;
          for (let ix = Math.floor(xa); ix < Math.ceil(xb); ix++) {
            const wx = Math.min(ix + 1, xb) - Math.max(ix, xa);
            if (wx <= 0) continue;
            somme += src[ligne + ix] * wx * wy;
            poids += wx * wy;
          }
        }
        out[ty * nw + tx] = poids > 0 ? somme / poids : 0;
      }
    }
    return out;
  }

  function pretraiter() {
    const rgba = ctx.getImageData(0, 0, TAILLE, TAILLE).data;
    const gris = new Float64Array(TAILLE * TAILLE);
    let x0 = TAILLE, x1 = -1, y0 = TAILLE, y1 = -1;
    for (let i = 0; i < gris.length; i++) {
      const v = rgba[i * 4];
      gris[i] = v;
      if (v > 0) {
        const y = (i / TAILLE) | 0, x = i - y * TAILLE;
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;   // rien de dessiné

    // Recadrage sur la boîte englobante puis réduction dans une boîte 20x20 (ratio conservé)
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    let nw, nh;
    if (w > h) { nw = 20; nh = Math.max(1, Math.round(h * 20 / w)); }
    else { nh = 20; nw = Math.max(1, Math.round(w * 20 / h)); }
    const petit = redimensionner(gris, TAILLE, x0, y0, w, h, nw, nh);

    // Centrage par centre de masse dans un cadre 28x28
    let masse = 0, cx = 0, cy = 0;
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const v = petit[y * nw + x];
      masse += v; cx += x * v; cy += y * v;
    }
    cx /= masse; cy /= masse;
    const dx = Math.round(14 - cx), dy = Math.round(14 - cy);
    const cadre = new Float64Array(784);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const X = x + dx, Y = y + dy;
      if (X >= 0 && X < 28 && Y >= 0 && Y < 28) cadre[Y * 28 + X] = Math.round(petit[y * nw + x]);
    }
    return cadre;
  }

  /* ---------- Modèle : scores = [x, 1] @ W ---------- */
  function scores(x) {
    const s = new Float64Array(NB_CLASSES);
    for (let k = 0; k < NB_CLASSES; k++) s[k] = W[NB_ENTREES * NB_CLASSES + k];   // biais
    for (let i = 0; i < NB_ENTREES; i++) {
      const xi = x[i];
      if (xi === 0) continue;
      const base = i * NB_CLASSES;
      for (let k = 0; k < NB_CLASSES; k++) s[k] += xi * W[base + k];
    }
    return s;
  }

  function softmax(s, T) {
    let max = -Infinity;
    for (const v of s) if (v * T > max) max = v * T;
    const e = Array.from(s, function (v) { return Math.exp(v * T - max); });
    const somme = e.reduce(function (a, b) { return a + b; }, 0);
    return e.map(function (v) { return v / somme; });
  }

  /* ---------- Affichage ---------- */
  const barsEl = document.getElementById("mnist-bars");
  const predEl = document.getElementById("mnist-pred");
  const confEl = document.getElementById("mnist-conf");
  const barres = [];
  for (let k = 0; k < 10; k++) {
    const b = document.createElement("div");
    b.className = "bar";
    b.innerHTML = '<span class="bar-val"></span><div class="bar-track"><div class="bar-fill"></div></div><span class="bar-label">' + k + "</span>";
    barsEl.appendChild(b);
    barres.push({ el: b, val: b.querySelector(".bar-val"), fill: b.querySelector(".bar-fill") });
  }

  function pourcent(p) {
    if (p >= 0.995) return "100";
    if (p < 0.005) return "0";
    return (p * 100).toFixed(0);
  }

  function afficher(probas) {
    if (!probas) {
      predEl.textContent = "?";
      confEl.textContent = "en attente d'un dessin";
      barres.forEach(function (b) { b.el.classList.remove("is-top"); b.val.textContent = ""; b.fill.style.height = "0%"; });
      return;
    }
    let top = 0;
    for (let k = 1; k < 10; k++) if (probas[k] > probas[top]) top = k;
    predEl.textContent = String(top);
    confEl.textContent = "confiance " + pourcent(probas[top]) + " %";
    barres.forEach(function (b, k) {
      b.el.classList.toggle("is-top", k === top);
      b.val.textContent = pourcent(probas[k]) + "%";
      b.fill.style.height = Math.max(probas[k] * 100, 0.8) + "%";
    });
    barsEl.setAttribute("aria-label", "Prédiction : " + top + ", confiance " + pourcent(probas[top]) + " pour cent");
  }

  function dessinerApercu(x) {
    const img = pctx.createImageData(28, 28);
    for (let i = 0; i < 784; i++) {
      const v = Math.max(0, Math.min(255, x[i]));
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    pctx.putImageData(img, 0, 0);
  }

  function predire() {
    const x = pretraiter();
    if (!x) { afficher(null); return; }
    dessinerApercu(x);
    afficher(softmax(scores(x), model.temperature));
  }

  effacer();
})();
