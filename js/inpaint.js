/* ==============================================================
   DÉMO RESTAURATION D'IMAGE
   Traduction de image_restauration_couleur_opti() et grad_conj()
   (Ma316_BE_lib.py) en JavaScript.

   - On ne garde que le rectangle autour du masque, + 3 pixels de marge.
   - Pour chaque canal : R = -(Lm (F*K) + (F*K) Ln) * M
                         A(X) = (Lm X + X Ln) * M
     puis gradient conjugué depuis X0 = 0.
   - Lm X + X Ln avec les matrices laplaciennes tridiagonales (-2 sur la
     diagonale, 1 au-dessus et en dessous) revient exactement au
     laplacien 5 points avec des zéros hors du rectangle : on l'applique
     directement, sans construire les matrices.

   Aucune donnée ne quitte le navigateur : l'image est lue localement
   (FileReader / createImageBitmap) et traitée sur la machine.
   ============================================================== */
(function () {
  "use strict";

  const canvas = document.getElementById("ip-canvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const maskCanvas = document.getElementById("ip-mask");
  const mctx = maskCanvas.getContext("2d", { willReadFrequently: true });
  const stage = document.getElementById("ip-stage");
  const help = document.getElementById("ip-help");
  const $ = function (id) { return document.getElementById(id); };

  const TAILLE_MAX = 1280;          // côté max des images importées (pour garder un calcul rapide)
  const MARGE = 3;                  // même marge que dans la fonction Python
  const COULEUR_MASQUE = "#4ade80";

  // Polygone autour de l'avion du haut, dans l'image PAF en 1280 x 720
  const MASQUE_EXEMPLE = [[581, 268], [675, 285], [755, 324], [749, 339], [721, 368], [600, 371], [515, 339], [521, 321]];

  let original = null;     // ImageData de l'image chargée (pour "Recommencer")
  let courante = null;     // ImageData de l'image avant la restauration en cours
  let estPAF = true;
  let calcul = null;       // état du calcul en cours

  /* ---------- Chargement des images ---------- */

  function chargerDepuisSource(source, largeur, hauteur) {
    const echelle = Math.min(1, TAILLE_MAX / Math.max(largeur, hauteur));
    const w = Math.max(1, Math.round(largeur * echelle));
    const h = Math.max(1, Math.round(hauteur * echelle));
    canvas.width = maskCanvas.width = w;
    canvas.height = maskCanvas.height = h;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(source, 0, 0, w, h);
    original = ctx.getImageData(0, 0, w, h);
    courante = original;
    effacerMasque();
    reinitialiserStats();
    $("ip-compare").disabled = true;
    $("ip-download").disabled = true;
    $("ip-example").disabled = !estPAF;
  }

  function chargerPAF() {
    stopper();
    estPAF = true;
    activerOnglet(true);
    const img = new Image();
    img.onload = function () {
      chargerDepuisSource(img, img.naturalWidth, img.naturalHeight);
      message("Peignez sur l'objet à faire disparaître en débordant un peu autour, puis lancez la restauration. Ou essayez le masque d'exemple sur l'avion du haut.");
    };
    img.src = window.PAF_IMAGE;
  }

  function chargerFichier(fichier) {
    if (!fichier) return;
    if (!/^image\//.test(fichier.type)) { message("Ce fichier n'est pas une image.", true); return; }
    stopper();
    // L'image est lue localement : aucune requête réseau n'est faite ici.
    const url = URL.createObjectURL(fichier);
    const img = new Image();
    img.onload = function () {
      estPAF = false;
      activerOnglet(false);
      chargerDepuisSource(img, img.naturalWidth, img.naturalHeight);
      URL.revokeObjectURL(url);
      const reduite = Math.max(img.naturalWidth, img.naturalHeight) > TAILLE_MAX;
      message("Image chargée" + (reduite ? " et réduite à " + canvas.width + " × " + canvas.height + " px pour le calcul" : "") + ". Peignez la zone à effacer.");
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      message("Votre navigateur n'arrive pas à lire cette image (le HEIC, par exemple, n'est pas pris en charge partout). Essayez un JPEG ou un PNG.", true);
    };
    img.src = url;
  }

  function activerOnglet(paf) {
    $("ip-src-paf").classList.toggle("is-active", paf);
    document.querySelector('label[for="ip-file"]').classList.toggle("is-active", !paf);
  }

  $("ip-src-paf").addEventListener("click", chargerPAF);
  $("ip-file").addEventListener("change", function (e) { chargerFichier(e.target.files[0]); e.target.value = ""; });

  ["dragenter", "dragover"].forEach(function (t) {
    stage.addEventListener(t, function (e) { e.preventDefault(); stage.classList.add("is-dragging"); });
  });
  ["dragleave", "drop"].forEach(function (t) {
    stage.addEventListener(t, function (e) { e.preventDefault(); stage.classList.remove("is-dragging"); });
  });
  stage.addEventListener("drop", function (e) { chargerFichier(e.dataTransfer.files[0]); });

  /* ---------- Tracé du masque ---------- */

  let peint = false;
  let dernier = null;

  function position(e) {
    const r = maskCanvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * maskCanvas.width / r.width, y: (e.clientY - r.top) * maskCanvas.height / r.height };
  }

  function pinceau(a, b) {
    const rayon = +$("ip-brush").value;
    mctx.strokeStyle = mctx.fillStyle = COULEUR_MASQUE;
    mctx.lineWidth = rayon * 2;
    mctx.lineCap = mctx.lineJoin = "round";
    mctx.beginPath();
    if (a) { mctx.moveTo(a.x, a.y); mctx.lineTo(b.x, b.y); mctx.stroke(); }
    else { mctx.arc(b.x, b.y, rayon, 0, Math.PI * 2); mctx.fill(); }
  }

  maskCanvas.addEventListener("pointerdown", function (e) {
    if (calcul) return;
    e.preventDefault();
    maskCanvas.setPointerCapture(e.pointerId);
    peint = true;
    dernier = position(e);
    pinceau(null, dernier);
  });
  maskCanvas.addEventListener("pointermove", function (e) {
    if (!peint) return;
    const p = position(e);
    pinceau(dernier, p);
    dernier = p;
  });
  function finPeinture() { peint = false; dernier = null; }
  maskCanvas.addEventListener("pointerup", finPeinture);
  maskCanvas.addEventListener("pointercancel", finPeinture);

  function effacerMasque() { mctx.clearRect(0, 0, maskCanvas.width, maskCanvas.height); }

  $("ip-clear").addEventListener("click", function () { if (!calcul) effacerMasque(); });
  $("ip-example").addEventListener("click", function () {
    if (calcul || !estPAF) return;
    effacerMasque();
    mctx.fillStyle = COULEUR_MASQUE;
    mctx.beginPath();
    MASQUE_EXEMPLE.forEach(function (p, i) { if (i) mctx.lineTo(p[0], p[1]); else mctx.moveTo(p[0], p[1]); });
    mctx.closePath();
    mctx.fill();
  });

  /* ---------- Préparation : relimiter_masque + matrices R ---------- */

  function preparer(maxIter, epsilon) {
    const W = canvas.width, H = canvas.height;
    const alpha = mctx.getImageData(0, 0, W, H).data;

    // Limites du masque
    let haut = H, bas = -1, gauche = W, droite = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (alpha[(y * W + x) * 4 + 3] > 0) {
        if (y < haut) haut = y; if (y > bas) bas = y;
        if (x < gauche) gauche = x; if (x > droite) droite = x;
      }
    }
    if (bas < 0) return null;

    // Rectangle relimité avec marge
    const y0 = Math.max(0, haut - MARGE), y1 = Math.min(H, bas + MARGE + 1);
    const x0 = Math.max(0, gauche - MARGE), x1 = Math.min(W, droite + MARGE + 1);
    const m = y1 - y0, n = x1 - x0;

    const M = new Uint8Array(m * n);
    const idx = [];
    for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
      if (alpha[((y0 + i) * W + (x0 + j)) * 4 + 3] > 0) { M[i * n + j] = 1; idx.push(i * n + j); }
    }
    const masque = Int32Array.from(idx);

    // Voisins de chaque pixel inconnu dans le rectangle (-1 si hors du rectangle,
    // ce qui correspond aux zéros de la matrice laplacienne tronquée)
    const voisins = new Int32Array(masque.length * 4);
    for (let k = 0; k < masque.length; k++) {
      const p = masque[k], i = (p / n) | 0, j = p - i * n;
      voisins[k * 4] = i > 0 ? p - n : -1;
      voisins[k * 4 + 1] = i < m - 1 ? p + n : -1;
      voisins[k * 4 + 2] = j > 0 ? p - 1 : -1;
      voisins[k * 4 + 3] = j < n - 1 ? p + 1 : -1;
    }

    const src = courante.data;
    const canaux = [0, 1, 2].map(function (c) {
      // F*K : l'image connue, mise à zéro sur le masque
      const FK = new Float64Array(m * n);
      for (let i = 0; i < m; i++) for (let j = 0; j < n; j++) {
        const p = i * n + j;
        FK[p] = M[p] ? 0 : src[((y0 + i) * W + (x0 + j)) * 4 + c];
      }
      // R = -(Lm (F*K) + (F*K) Ln) * M
      const R = new Float64Array(m * n);
      for (let k = 0; k < masque.length; k++) {
        const p = masque[k];
        let v = -4 * FK[p];
        for (let q = 0; q < 4; q++) { const nb = voisins[k * 4 + q]; if (nb >= 0) v += FK[nb]; }
        R[p] = -v;
      }
      // X0 = 0, donc grad = A(X0) - R = -R et d = R
      const X = new Float64Array(m * n);
      const g = new Float64Array(m * n);
      const d = new Float64Array(m * n);
      for (let k = 0; k < masque.length; k++) { const p = masque[k]; g[p] = -R[p]; d[p] = R[p]; }
      return { FK: FK, X: X, g: g, d: d, Ad: new Float64Array(m * n), Ag: new Float64Array(m * n),
               norme: norme(d, masque), cpt: 0, fini: false };
    });

    return { x0: x0, y0: y0, m: m, n: n, masque: masque, voisins: voisins, canaux: canaux,
             maxIter: maxIter, epsilon: epsilon, historique: [], tempsCalcul: 0 };
  }

  function norme(v, masque) {
    let s = 0;
    for (let k = 0; k < masque.length; k++) { const x = v[masque[k]]; s += x * x; }
    return Math.sqrt(s);
  }

  // A(X) = (Lm X + X Ln) * M, calculé uniquement là où M = 1
  function appliquerA(X, out, masque, voisins) {
    for (let k = 0; k < masque.length; k++) {
      const p = masque[k], b = k * 4;
      let v = -4 * X[p];
      let nb = voisins[b];     if (nb >= 0) v += X[nb];
      nb = voisins[b + 1];     if (nb >= 0) v += X[nb];
      nb = voisins[b + 2];     if (nb >= 0) v += X[nb];
      nb = voisins[b + 3];     if (nb >= 0) v += X[nb];
      out[p] = v;
    }
  }

  /* Une itération de grad_conj() :
       t    = -<d, grad> / <d, A d>
       X    = X + t d
       beta = <d, A grad> / <d, A d>
       d    = -grad + beta d
     Le gradient A(X) - R est mis à jour par grad += t A d (même valeur, sans
     réappliquer A). */
  function iteration(c, st) {
    if (c.fini) return;
    if (!(c.norme > st.epsilon) || c.cpt >= st.maxIter) { c.fini = true; return; }
    const masque = st.masque, X = c.X, g = c.g, d = c.d, Ad = c.Ad, Ag = c.Ag;
    appliquerA(d, Ad, masque, st.voisins);
    let dAd = 0, dg = 0;
    for (let k = 0; k < masque.length; k++) { const p = masque[k]; dAd += d[p] * Ad[p]; dg += d[p] * g[p]; }
    if (dAd === 0) { c.fini = true; return; }
    const t = -dg / dAd;
    for (let k = 0; k < masque.length; k++) { const p = masque[k]; X[p] += t * d[p]; g[p] += t * Ad[p]; }
    appliquerA(g, Ag, masque, st.voisins);
    let dAg = 0;
    for (let k = 0; k < masque.length; k++) { const p = masque[k]; dAg += d[p] * Ag[p]; }
    const beta = dAg / dAd;
    let s = 0;
    for (let k = 0; k < masque.length; k++) { const p = masque[k]; const v = -g[p] + beta * d[p]; d[p] = v; s += v * v; }
    c.norme = Math.sqrt(s);
    c.cpt++;
  }

  /* Final = clip(X, 0, 255) + F*K, recollé dans l'image complète */
  function rendre(st) {
    if (!st.sortie) st.sortie = new ImageData(new Uint8ClampedArray(courante.data), courante.width, courante.height);
    const sortie = st.sortie;
    const W = courante.width, out = sortie.data, n = st.n;
    for (let k = 0; k < st.masque.length; k++) {
      const p = st.masque[k], i = (p / n) | 0, j = p - i * n;
      const o = ((st.y0 + i) * W + (st.x0 + j)) * 4;
      for (let c = 0; c < 3; c++) {
        const v = st.canaux[c].X[p];
        out[o + c] = Math.max(0, Math.min(255, v)) + st.canaux[c].FK[p];
      }
    }
    ctx.putImageData(sortie, 0, 0, st.x0, st.y0, st.n, st.m);
    return sortie;
  }

  /* ---------- Boucle d'animation ---------- */

  let resultat = null;

  function lancer() {
    if (calcul) { stopper(); return; }
    const st = preparer(+$("ip-iter").value, +$("ip-eps").value);
    if (!st) { message("Peignez d'abord la zone à effacer sur l'image.", true); return; }
    calcul = st;
    resultat = null;
    stage.classList.add("is-running");
    $("ip-run").textContent = "Arrêter";
    $("ip-px").textContent = st.masque.length.toLocaleString("fr-FR");
    $("ip-compare").disabled = true;
    $("ip-download").disabled = true;
    message("Résolution sur un rectangle de " + st.n + " × " + st.m + " pixels, canal par canal.");
    requestAnimationFrame(boucle);
  }

  function boucle() {
    const st = calcul;
    if (!st) return;
    const debut = performance.now();
    // Le calcul est rapide : on le ralentit volontairement (environ 150 images
    // pour aller jusqu'à maxIter) pour qu'on voie le remplissage progresser.
    const parImage = Math.max(1, Math.round(st.maxIter / 150));
    let n = 0;
    do {
      st.canaux.forEach(function (c) { iteration(c, st); });
      st.historique.push(Math.max(st.canaux[0].norme, st.canaux[1].norme, st.canaux[2].norme));
      n++;
    } while (!termine(st) && n < parImage && performance.now() - debut < 12);
    st.tempsCalcul += performance.now() - debut;

    resultat = rendre(st);
    majStats(st);
    if (termine(st)) {
      finir(st);
    } else {
      requestAnimationFrame(boucle);
    }
  }

  function termine(st) { return st.canaux.every(function (c) { return c.fini || !(c.norme > st.epsilon) || c.cpt >= st.maxIter; }); }

  function finir(st) {
    const it = Math.max.apply(null, st.canaux.map(function (c) { return c.cpt; }));
    const converge = st.canaux.every(function (c) { return !(c.norme > st.epsilon); });
    calcul = null;
    courante = resultat;
    effacerMasque();
    stage.classList.remove("is-running");
    $("ip-run").textContent = "Lancer la restauration";
    $("ip-compare").disabled = false;
    $("ip-download").disabled = false;
    message(converge
      ? "Terminé : le résidu est passé sous ε en " + it + " itérations. Vous pouvez peindre une nouvelle zone pour continuer."
      : "Arrêt après " + it + " itérations, le résidu n'est pas encore sous ε. Augmentez le nombre d'itérations pour un remplissage plus abouti.");
  }

  function stopper() {
    if (!calcul) return;
    const st = calcul;
    calcul = null;
    stage.classList.remove("is-running");
    $("ip-run").textContent = "Lancer la restauration";
    if (resultat) { courante = resultat; $("ip-compare").disabled = false; $("ip-download").disabled = false; }
    effacerMasque();
    message("Calcul interrompu à l'itération " + Math.max.apply(null, st.canaux.map(function (c) { return c.cpt; })) + ".");
  }

  $("ip-run").addEventListener("click", lancer);

  /* ---------- Statistiques et courbe de convergence ---------- */

  const chart = $("ip-chart");
  const cctx = chart.getContext("2d");

  function reinitialiserStats() {
    $("ip-it").textContent = "0";
    $("ip-res").textContent = "·";
    $("ip-px").textContent = "0";
    $("ip-time").textContent = "·";
    resultat = null;
    tracerCourbe([]);
  }

  function formatNombre(v) {
    if (v === 0) return "0";
    if (v >= 1000 || v < 0.01) return v.toExponential(1).replace("e+", "e");
    return v.toFixed(2);
  }

  function majStats(st) {
    const it = Math.max.apply(null, st.canaux.map(function (c) { return c.cpt; }));
    $("ip-it").textContent = it + " / " + st.maxIter;
    $("ip-res").textContent = formatNombre(st.historique[st.historique.length - 1] || 0);
    const ms = st.tempsCalcul;
    $("ip-time").textContent = ms < 1000 ? Math.round(ms) + " ms" : (ms / 1000).toFixed(2) + " s";
    tracerCourbe(st.historique, st.epsilon);
  }

  function tracerCourbe(h, eps) {
    const W = chart.width, H = chart.height, pad = 14;
    cctx.clearRect(0, 0, W, H);
    cctx.strokeStyle = "rgba(255,255,255,0.06)";
    cctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = Math.round(H * i / 4) + 0.5; cctx.beginPath(); cctx.moveTo(0, y); cctx.lineTo(W, y); cctx.stroke(); }
    const pts = h.filter(function (v) { return v > 0; });
    if (pts.length < 2) return;
    const logs = pts.map(Math.log10);
    let lo = Math.min.apply(null, logs), hi = Math.max.apply(null, logs);
    if (eps) lo = Math.min(lo, Math.log10(eps));
    if (hi - lo < 1e-6) hi = lo + 1;
    const X = function (i) { return pad + (W - 2 * pad) * i / (logs.length - 1); };
    const Y = function (v) { return pad + (H - 2 * pad) * (hi - v) / (hi - lo); };

    if (eps) {
      cctx.setLineDash([6, 6]);
      cctx.strokeStyle = "rgba(74,222,128,0.55)";
      cctx.beginPath(); cctx.moveTo(pad, Y(Math.log10(eps))); cctx.lineTo(W - pad, Y(Math.log10(eps))); cctx.stroke();
      cctx.setLineDash([]);
      cctx.fillStyle = "rgba(74,222,128,0.8)";
      cctx.font = "20px JetBrains Mono, monospace";
      cctx.fillText("ε", W - pad - 14, Y(Math.log10(eps)) - 8);
    }

    const grad = cctx.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, "#a855f7");
    grad.addColorStop(1, "#6366f1");
    cctx.strokeStyle = grad;
    cctx.lineWidth = 3;
    cctx.lineJoin = "round";
    cctx.beginPath();
    const pas = Math.max(1, Math.floor(logs.length / W));
    for (let i = 0; i < logs.length; i += pas) { if (i) cctx.lineTo(X(i), Y(logs[i])); else cctx.moveTo(X(i), Y(logs[i])); }
    cctx.lineTo(X(logs.length - 1), Y(logs[logs.length - 1]));
    cctx.stroke();
  }

  /* ---------- Comparer, télécharger, recommencer ---------- */

  const cmp = $("ip-compare");
  function montrerOriginal(e) { if (cmp.disabled) return; e.preventDefault(); ctx.putImageData(original, 0, 0); }
  function montrerResultat() { if (!calcul && courante) ctx.putImageData(courante, 0, 0); }
  cmp.addEventListener("pointerdown", montrerOriginal);
  cmp.addEventListener("pointerup", montrerResultat);
  cmp.addEventListener("pointerleave", montrerResultat);
  cmp.addEventListener("pointercancel", montrerResultat);
  cmp.addEventListener("keydown", function (e) { if (e.key === " " || e.key === "Enter") montrerOriginal(e); });
  cmp.addEventListener("keyup", montrerResultat);

  $("ip-download").addEventListener("click", function () {
    // Le fichier est fabriqué dans le navigateur et enregistré directement sur votre machine.
    canvas.toBlob(function (blob) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "restauration.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }, "image/png");
  });

  $("ip-reset").addEventListener("click", function () {
    stopper();
    if (!original) return;
    courante = original;
    ctx.putImageData(original, 0, 0);
    effacerMasque();
    reinitialiserStats();
    $("ip-compare").disabled = true;
    $("ip-download").disabled = true;
    message("Image d'origine rétablie. Peignez la zone à effacer.");
  });

  function message(texte, erreur) {
    help.textContent = texte;
    help.classList.toggle("is-error", !!erreur);
  }

  chargerPAF();
})();
