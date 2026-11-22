/* ==============================================================
   PROJET IA : détection de spam par KNN, Naive Bayes et LDA
   Traduction des classes de IA_part_I.py.
   Fichier sans interface (testable à part avec Node).
   ============================================================== */
(function (racine) {
  "use strict";

  function decoder(b64, Type) {
    const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const octets = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) octets[i] = bin.charCodeAt(i);
    return new Type(octets.buffer);
  }

  /* ---------------------------------------------------------- SMS */

  function preparerSMS(d) {
    const m = {
      vocab: d.vocab, P: d.P, n: d.n, priors: d.priors,
      index: new Map(d.vocab.map(function (mot, i) { return [mot, i]; })),
      indptr: decoder(d.indptr, Uint32Array), indices: decoder(d.indices, Uint16Array),
      counts: decoder(d.counts, Uint8Array), labels: decoder(d.labels, Uint8Array),
      means: decoder(d.means, Float32Array), vars: decoder(d.vars, Float32Array),
      ldaW: decoder(d.ldaW, Float32Array), ldaB: d.ldaB, acc: d.acc, baseNB: {}
    };
    return m;
  }

  /* CountVectorizer par défaut : minuscules, mots d'au moins 2 caractères \w */
  function vectoriser(m, texte) {
    const mots = (texte.toLowerCase().match(/[\p{L}\p{N}_]+/gu) || []).filter(function (w) { return w.length >= 2; });
    const x = new Map(), inconnus = [];
    mots.forEach(function (w) {
      const i = m.index.get(w);
      if (i === undefined) inconnus.push(w);
      else x.set(i, (x.get(i) || 0) + 1);
    });
    return { x: x, mots: mots, inconnus: inconnus };
  }

  /* KNN : distance de Minkowski d'ordre p avec chaque SMS d'entraînement.
     dist^p = Σ|x|^p + Σ_{i ∈ b} (|x_i − b_i|^p − |x_i|^p) : on ne parcourt que les mots présents. */
  function knnSMS(m, x, k, p) {
    let S = 0;
    x.forEach(function (v) { S += Math.pow(v, p); });
    const d = new Float64Array(m.n);
    for (let r = 0; r < m.n; r++) {
      let s = S;
      for (let j = m.indptr[r]; j < m.indptr[r + 1]; j++) {
        const xi = x.get(m.indices[j]) || 0;
        s += Math.pow(Math.abs(xi - m.counts[j]), p) - Math.pow(xi, p);
      }
      d[r] = s;
    }
    const ordre = Array.from(d.keys()).sort(function (a, b) { return d[a] - d[b] || a - b; }).slice(0, k);
    const spam = ordre.reduce(function (s, r) { return s + m.labels[r]; }, 0);
    // Comme le dictionnaire du code Python : en cas d'égalité, la première classe (ham) l'emporte
    return { classe: spam > k - spam ? 1 : 0, votesSpam: spam, k: k,
             distances: ordre.map(function (r) { return Math.pow(d[r], 1 / p); }) };
  }

  /* Naive Bayes gaussien : -0.5 Σ ((x−μ)²/σ² + log σ²) + log π, avec σ² + eps */
  function nbSMS(m, x, eps) {
    if (!m.baseNB[eps]) {
      // Score pour un message vide (tous les x_i = 0), calculé une fois par valeur d'eps
      m.baseNB[eps] = [0, 1].map(function (c) {
        let s = 0;
        for (let i = 0; i < m.P; i++) {
          const mu = m.means[c * m.P + i], v = m.vars[c * m.P + i] + eps;
          s += mu * mu / v + Math.log(v);
        }
        return -0.5 * s + Math.log(m.priors[c]);
      });
    }
    const score = m.baseNB[eps].slice();
    const contrib = new Map();
    x.forEach(function (xi, i) {
      const delta = [0, 1].map(function (c) {
        const mu = m.means[c * m.P + i], v = m.vars[c * m.P + i] + eps;
        return -0.5 * ((xi - mu) * (xi - mu) - mu * mu) / v;
      });
      score[0] += delta[0];
      score[1] += delta[1];
      contrib.set(i, delta[1] - delta[0]);
    });
    const ecart = score[1] - score[0];
    return { classe: score[1] > score[0] ? 1 : 0, proba: 1 / (1 + Math.exp(-ecart)), ecart: ecart, contrib: contrib };
  }

  /* LDA : la différence des scores des deux classes est linéaire en x,
     δ(x) = xᵀ Σ⁻¹(μ1 − μ0) − ½(μ1ᵀΣ⁻¹μ1 − μ0ᵀΣ⁻¹μ0) + log(π1/π0) = w·x + b */
  function ldaSMS(m, x) {
    let s = m.ldaB;
    const contrib = new Map();
    x.forEach(function (xi, i) { const c = m.ldaW[i] * xi; s += c; contrib.set(i, c); });
    return { classe: s > 0 ? 1 : 0, proba: 1 / (1 + Math.exp(-s)), ecart: s, contrib: contrib };
  }

  const api = { preparerSMS: preparerSMS, vectoriser: vectoriser, knnSMS: knnSMS, nbSMS: nbSMS, ldaSMS: ldaSMS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.IA = api;
})(this);
