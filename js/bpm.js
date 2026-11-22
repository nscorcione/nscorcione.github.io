/* ==============================================================
   DÉMO POULS PAR WEBCAM (Ma312 BE BPM)
   - La vidéo est lue par le navigateur (getUserMedia) et dessinée
     dans un canvas. Aucune image n'est envoyée ni enregistrée :
     de chaque image on ne garde que la moyenne du vert sur le front.
   - Le calcul (FFT, passe-bande, seuillage spectral) est dans
     bpm-core.js.
   ============================================================== */
(function () {
  "use strict";

  const canvas = document.getElementById("bpm-video");
  if (!canvas || !window.BPM) return;

  const $ = function (id) { return document.getElementById(id); };
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const W = canvas.width, H = canvas.height;
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;

  // Cadre du visage (centré) et zone du front, avec les mêmes proportions que
  // le BE : front_x = x + w/3, front_y = y + h/7, largeur w/3.
  const visage = { w: Math.round(W * 0.36) };
  visage.h = Math.round(visage.w * 1.3);
  visage.x = Math.round((W - visage.w) / 2);
  visage.y = Math.round(H * 0.13);
  const front = {
    x: visage.x + Math.round(visage.w / 3),
    y: visage.y + Math.round(visage.h / 7),
    w: Math.round(visage.w / 3),
    h: Math.max(14, Math.round(visage.h * 0.09))
  };

  let flux = null;          // MediaStream
  let mesure = null;        // { debut, duree, temps: [], vert: [] }
  let apercu = { temps: [], vert: [] };   // derniers instants, pour la courbe en direct
  let dernierTempsVideo = -1;
  let derniereEstimation = 0;

  /* ---------- Caméra ---------- */

  async function allumer() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      message("Ce navigateur ne donne pas accès à la caméra ici. Essayez un navigateur récent, et une page en https ou ouverte en local.", true);
      return;
    }
    message("Autorisez l'accès à la caméra dans la fenêtre du navigateur.");
    try {
      flux = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 }, facingMode: "user" },
        audio: false
      });
    } catch (e) {
      const raisons = {
        NotAllowedError: "Accès à la caméra refusé. Vous pouvez le réautoriser depuis l'icône de caméra dans la barre d'adresse.",
        NotFoundError: "Aucune caméra trouvée sur cet appareil.",
        NotReadableError: "La caméra est déjà utilisée par une autre application."
      };
      message(raisons[e.name] || "Impossible d'ouvrir la caméra (" + e.name + ").", true);
      return;
    }
    video.srcObject = flux;
    await video.play();
    $("bpm-off").hidden = true;
    $("bpm-run").disabled = false;
    $("bpm-stop").disabled = false;
    apercu = { temps: [], vert: [] };
    message("Placez votre visage dans le cadre, la zone verte sur le front, puis lancez la mesure. Idéalement face à une fenêtre, sans lampe allumée.");
    boucle();
  }

  function couper(texte) {
    if (flux) flux.getTracks().forEach(function (t) { t.stop(); });
    flux = null;
    video.srcObject = null;
    if (mesure) annulerMesure();
    ctx.clearRect(0, 0, W, H);
    $("bpm-off").hidden = false;
    $("bpm-run").disabled = true;
    $("bpm-stop").disabled = true;
    if (texte) message(texte);
  }

  $("bpm-cam").addEventListener("click", allumer);
  $("bpm-stop").addEventListener("click", function () { couper("Caméra coupée."); });
  window.addEventListener("pagehide", function () { couper(); });

  /* ---------- Boucle image par image ---------- */

  function planifier() {
    if (!flux) return;
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(boucle);
    else requestAnimationFrame(boucle);
  }

  function boucle() {
    if (!flux) return;
    // Nouvelle image seulement (requestAnimationFrame peut tourner plus vite que la caméra)
    if (video.readyState >= 2 && video.currentTime !== dernierTempsVideo) {
      dernierTempsVideo = video.currentTime;
      traiterImage(performance.now() / 1000);
    }
    planifier();
  }

  function traiterImage(t) {
    // Image en miroir, plus naturel pour se placer
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(video, 0, 0, W, H);
    ctx.restore();

    // Moyenne du canal vert sur le front (la zone est centrée, le miroir ne change rien)
    const px = ctx.getImageData(front.x, front.y, front.w, front.h).data;
    let vert = 0, lum = 0;
    for (let i = 0; i < px.length; i += 4) { vert += px[i + 1]; lum += px[i] + px[i + 1] + px[i + 2]; }
    const nb = px.length / 4;
    vert /= nb;
    lum /= 3 * nb;

    dessinerGuide();

    apercu.temps.push(t);
    apercu.vert.push(vert);
    while (apercu.temps.length && t - apercu.temps[0] > 10) { apercu.temps.shift(); apercu.vert.shift(); }
    tracerSignal(apercu.temps, apercu.vert);

    if (mesure) {
      mesure.temps.push(t);
      mesure.vert.push(vert);
      if (lum < 45) mesure.sombre++;
      const ecoule = t - mesure.debut;
      $("bpm-bar").style.width = Math.min(100, ecoule / mesure.duree * 100) + "%";
      // Estimation en direct une fois par seconde, après 8 s
      if (ecoule > 8 && t - derniereEstimation > 1) {
        derniereEstimation = t;
        afficherResultat(calculer(mesure), true);
      }
      if (ecoule >= mesure.duree) terminerMesure();
      else message("Mesure en cours, restez immobile… " + Math.ceil(mesure.duree - ecoule) + " s");
    } else if (lum < 45) {
      message("L'image est sombre : rapprochez-vous d'une fenêtre (la lumière du jour donne un meilleur signal qu'une lampe).");
    }
  }

  function dessinerGuide() {
    // Voile en dehors du cadre du visage
    ctx.save();
    ctx.fillStyle = "rgba(9, 8, 15, 0.45)";
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.ellipse(visage.x + visage.w / 2, visage.y + visage.h / 2, visage.w / 2, visage.h / 2, 0, 0, Math.PI * 2);
    ctx.fill("evenodd");
    ctx.lineWidth = 2;
    ctx.strokeStyle = mesure ? "#a855f7" : "rgba(255,255,255,0.7)";
    ctx.setLineDash(mesure ? [] : [8, 8]);
    ctx.beginPath();
    ctx.ellipse(visage.x + visage.w / 2, visage.y + visage.h / 2, visage.w / 2, visage.h / 2, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#4ade80";
    ctx.strokeRect(front.x, front.y, front.w, front.h);
    ctx.fillStyle = "#4ade80";
    ctx.font = "600 13px Poppins, sans-serif";
    ctx.fillText("front", front.x, front.y - 6);
    ctx.restore();
  }

  /* ---------- Mesure ---------- */

  function lancer() {
    if (!flux) return;
    if (mesure) { annulerMesure(); message("Mesure annulée."); return; }
    mesure = { debut: performance.now() / 1000, duree: +$("bpm-duree").value, temps: [], vert: [], sombre: 0 };
    derniereEstimation = 0;
    $("bpm-run").textContent = "Annuler";
    $("bpm-value").textContent = "··";
    $("bpm-quality").textContent = "mesure en cours";
    $("bpm-quality").className = "bpm-quality";
    $("bpm-titre-signal").textContent = "Vert moyen du front (signal brut, 10 dernières s)";
    tracerSpectre(null);
  }

  function annulerMesure() {
    mesure = null;
    $("bpm-run").textContent = "Lancer la mesure";
    $("bpm-bar").style.width = "0%";
  }

  /* ---------- Paramètres du rapport (Ma312_BE_BPM.py, V2) ----------
     seuillage spectral tau = 6, filtre passe-bande 60-180 BPM, autocorrélation.
     Seul ajout : le retrait de la dérive lente avant le seuillage. Sans lui,
     FFT() divise le signal par le niveau de vert (~150) avant d'enlever la
     moyenne, le pouls passe sous tau = 6 et tout le signal est effacé. */
  const PARAMS = { tendance: true, seuillage: "tau6", passeBande: true, bpmMin: 60, bpmMax: 180 };
  const BPM_MIN = PARAMS.bpmMin, BPM_MAX = PARAMS.bpmMax;

  function calculer(m) {
    if (m.temps.length < 60) return null;
    const n = m.temps.length;
    const fe = (n - 1) / (m.temps[n - 1] - m.temps[0]);      // fréquence d'échantillonnage réelle
    const signal = BPM.reechantillonner(m.temps, m.vert, fe);
    const r = BPM.analyser(signal, fe, PARAMS);
    r.fe = fe;
    return r;
  }

  function terminerMesure() {
    const m = mesure;
    const r = calculer(m);
    annulerMesure();
    $("bpm-bar").style.width = "100%";
    afficherResultat(r, false);
    if (r) tracerTraite(r);
    const sombre = m.sombre > m.temps.length / 3;
    couper(
      (r ? "Mesure terminée sur " + m.temps.length + " images (" + r.fe.toFixed(1) + " images/s). " : "") +
      (sombre ? "L'éclairage était faible, ce qui rend le signal bruité. " : "") +
      "La caméra est coupée et aucune image n'a été gardée."
    );
  }

  function afficherResultat(r, provisoire) {
    const q = $("bpm-quality");
    if (!r) { $("bpm-value").textContent = "··"; q.textContent = "pas assez d'images"; q.className = "bpm-quality"; return; }
    if (r.vide) {
      $("bpm-value").textContent = "··";
      q.textContent = "signal trop faible : le seuillage a tout effacé";
      q.className = "bpm-quality is-bad";
      tracerSpectre(null);
      return;
    }
    $("bpm-value").textContent = Math.round(r.bpmAC);
    let niveau, texte;
    if (r.qualite >= 6) { niveau = "is-good"; texte = "signal net"; }
    else if (r.qualite >= 4) { niveau = "is-mid"; texte = "signal moyen, à confirmer"; }
    else { niveau = "is-bad"; texte = "signal trop faible, résultat peu fiable"; }
    q.textContent = (provisoire ? "estimation en direct · " : "") + texte;
    q.className = "bpm-quality " + niveau;
    tracerSpectre(r);
  }

  $("bpm-run").addEventListener("click", lancer);

  /* ---------- Graphiques ---------- */

  function grille(c, g) {
    g.clearRect(0, 0, c.width, c.height);
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = Math.round(c.height * i / 4) + 0.5; g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
  }

  const sigCanvas = $("bpm-signal"), sctx = sigCanvas.getContext("2d");
  function tracerSignal(t, v) {
    grille(sigCanvas, sctx);
    if (v.length < 2) return;
    let lo = Infinity, hi = -Infinity;
    for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
    if (hi - lo < 0.5) { const m = (hi + lo) / 2; lo = m - 0.25; hi = m + 0.25; }
    const pad = 10, Wc = sigCanvas.width, Hc = sigCanvas.height, t1 = t[t.length - 1];
    sctx.strokeStyle = "#4ade80";
    sctx.lineWidth = 2.5;
    sctx.lineJoin = "round";
    sctx.beginPath();
    for (let i = 0; i < v.length; i++) {
      const x = pad + (Wc - 2 * pad) * (1 - (t1 - t[i]) / 10);
      const y = pad + (Hc - 2 * pad) * (hi - v[i]) / (hi - lo);
      if (i) sctx.lineTo(x, y); else sctx.moveTo(x, y);
    }
    sctx.stroke();
  }

  /* Après la mesure : le signal traité (selon les réglages), sur toute la durée */
  function tracerTraite(r) {
    $("bpm-titre-signal").textContent = r.vide
      ? "Signal après traitement : entièrement effacé par le seuillage"
      : "Signal après traitement (toute la mesure)";
    const t = Array.from(r.signal, function (_, i) { return i / r.fe; });
    const duree = t[t.length - 1] || 1;
    // tracerSignal affiche une fenêtre de 10 s : on remet le temps à l'échelle
    tracerSignal(t.map(function (x) { return x * 10 / duree; }), Array.from(r.signal));
  }

  const speCanvas = $("bpm-spectre"), pctx = speCanvas.getContext("2d");
  function tracerSpectre(r) {
    grille(speCanvas, pctx);
    const Wc = speCanvas.width, Hc = speCanvas.height, pad = 12, bas = Hc - 26;
    const X = function (bpm) { return pad + (Wc - 2 * pad) * (bpm - BPM_MIN) / (BPM_MAX - BPM_MIN); };
    pctx.fillStyle = "rgba(165,161,184,0.7)";
    pctx.font = "18px JetBrains Mono, monospace";
    pctx.textAlign = "center";
    [60, 90, 120, 150, 180].forEach(function (b) { pctx.fillText(String(b), Math.max(24, Math.min(X(b), Wc - 24)), Hc - 4); });
    if (!r || r.vide) return;
    const grad = pctx.createLinearGradient(0, 0, Wc, 0);
    grad.addColorStop(0, "#a855f7");
    grad.addColorStop(1, "#6366f1");
    pctx.strokeStyle = grad;
    pctx.fillStyle = "#a855f7";
    pctx.lineWidth = 2.5;
    // Autocorrélation normalisée (-1 à 1), un point par décalage d'une image
    const pts = r.courbeAC.filter(function (p) { return p[0] >= BPM_MIN && p[0] <= BPM_MAX; });
    const Y = function (v) { return pad + (bas - pad) * (1 - (v + 1) / 2); };
    pctx.beginPath();
    pts.forEach(function (p, i) { if (i) pctx.lineTo(X(p[0]), Y(p[1])); else pctx.moveTo(X(p[0]), Y(p[1])); });
    pctx.stroke();
    pts.forEach(function (p) { pctx.beginPath(); pctx.arc(X(p[0]), Y(p[1]), 3.5, 0, Math.PI * 2); pctx.fill(); });
    const xp = X(r.bpmAC);
    pctx.strokeStyle = "rgba(74,222,128,0.8)";
    pctx.setLineDash([5, 5]);
    pctx.beginPath(); pctx.moveTo(xp, pad); pctx.lineTo(xp, bas); pctx.stroke();
    pctx.setLineDash([]);
  }

  function message(texte, erreur) {
    const h = $("bpm-help");
    h.textContent = texte;
    h.classList.toggle("is-error", !!erreur);
  }

  tracerSignal([], []);
  tracerSpectre(null);
})();
