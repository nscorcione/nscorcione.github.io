/* ==============================================================
   DÉMO DÉTECTION DE SPAM (projet IA, partie I)
   KNN, Naive Bayes et LDA appliqués au SMS tapé par le visiteur.
   Calculs dans ia-core.js. Rien n'est envoyé à un serveur.
   ============================================================== */
(function () {
  "use strict";

  const D = window.IA_DATA, IA = window.IA;
  if (!D || !IA || !document.getElementById("classification")) return;
  const $ = function (id) { return document.getElementById(id); };
  const pct = function (v) { return (v * 100).toFixed(2).replace(".", ",") + " %"; };

  const sms = IA.preparerSMS(D.sms);
  const entree = $("spam-input");

  function verdict(id, classe) {
    const el = $(id);
    el.textContent = classe === null ? "·" : classe ? "SPAM" : "HAM";
    el.className = "verdict" + (classe === null ? "" : classe ? " is-spam" : " is-ham");
  }

  function certitude(p) {
    const c = Math.max(p, 1 - p);
    if (c > 0.9999) return "certitude > 99,99 %";
    return "certitude " + (c * 100).toFixed(1).replace(".", ",") + " %";
  }

  function majPrecisions() {
    const k = $("knn-k").value, p = $("knn-p").value;
    const texte = "Précision sur les 1 115 SMS de test : ";
    $("a-knn").textContent = texte + pct(D.sms.acc.knn[k + "-" + p]);
    $("a-nb").textContent = texte + pct($("nb-eps").value === "1e-3" ? D.sms.acc.nb3 : D.sms.acc.nb15);
    $("a-lda").textContent = texte + pct(D.sms.acc.lda);
  }

  function echapper(s) {
    return s.replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }

  const algos = ["knn", "nb", "lda"];

  function analyser() {
    majPrecisions();
    const texte = entree.value;
    const v = IA.vectoriser(sms, texte);
    if (!v.mots.length) {
      algos.forEach(function (a) { verdict("v-" + a, null); $("d-" + a).innerHTML = "&nbsp;"; });
      $("spam-words").innerHTML = '<span class="faint">Les mots de votre message apparaîtront ici.</span>';
      return;
    }
    if (!v.x.size) {
      algos.forEach(function (a) { verdict("v-" + a, null); $("d-" + a).textContent = "aucun mot connu du modèle"; });
    } else {
      const k = +$("knn-k").value, p = +$("knn-p").value;
      const rk = IA.knnSMS(sms, v.x, k, p);
      verdict("v-knn", rk.classe);
      $("d-knn").textContent = rk.votesSpam + " voisin" + (rk.votesSpam > 1 ? "s" : "") + " sur " + k + " " +
        (rk.votesSpam > 1 ? "sont des spams" : "est un spam");

      const rn = IA.nbSMS(sms, v.x, +$("nb-eps").value);
      verdict("v-nb", rn.classe);
      $("d-nb").textContent = certitude(rn.proba);

      const rl = IA.ldaSMS(sms, v.x);
      verdict("v-lda", rl.classe);
      $("d-lda").textContent = certitude(rl.proba);
    }

    // Mots colorés selon leur poids dans la LDA
    const morceaux = texte.split(/([\p{L}\p{N}_]+)/u);
    let max = 0;
    morceaux.forEach(function (m) {
      const i = sms.index.get(m.toLowerCase());
      if (i !== undefined) max = Math.max(max, Math.abs(sms.ldaW[i]));
    });
    $("spam-words").innerHTML = morceaux.map(function (m, j) {
      if (j % 2 === 0 || m.length < 2) return echapper(m);
      const i = sms.index.get(m.toLowerCase());
      if (i === undefined) return '<span class="w-unknown" title="mot inconnu du modèle">' + echapper(m) + "</span>";
      const w = sms.ldaW[i], f = max ? Math.min(1, Math.abs(w) / max) : 0;
      const coul = w > 0 ? "248,113,113" : "74,222,128";
      return '<span class="w-known" style="background:rgba(' + coul + "," + (0.12 + 0.55 * f).toFixed(2) +
        ')" title="poids LDA : ' + w.toFixed(3) + '">' + echapper(m) + "</span>";
    }).join("");
  }

  let attente = null;
  entree.addEventListener("input", function () { clearTimeout(attente); attente = setTimeout(analyser, 120); });
  ["knn-k", "knn-p", "nb-eps"].forEach(function (id) { $(id).addEventListener("change", analyser); });
  document.querySelectorAll(".chip-btn[data-ex]").forEach(function (b) {
    b.addEventListener("click", function () { entree.value = b.dataset.ex; analyser(); });
  });
  analyser();
})();
