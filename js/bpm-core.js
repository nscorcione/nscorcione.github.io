/* ==============================================================
   CALCUL DU BPM : traduction de Ma312_BE_lib.py
   FFT (avec zéro-padding), suppression_de_bruit (seuillage
   spectral), filtre_pb (passe-bande) et autocorrelation.
   Fichier sans interface, pour pouvoir le tester à part.
   ============================================================== */
(function (racine) {
  "use strict";

  /* FFT complexe radix-2, en place. re et im ont une longueur 2^k. */
  function fftComplexe(re, im, inverse) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (inverse ? 2 : -2) * Math.PI / len;
      const wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
    if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
  }

  /* np.fft.rfft d'un signal réel de longueur 2^k : renvoie N/2 + 1 coefficients */
  function rfft(x) {
    const n = x.length, re = Float64Array.from(x), im = new Float64Array(n);
    fftComplexe(re, im, false);
    return { re: re.slice(0, n / 2 + 1), im: im.slice(0, n / 2 + 1) };
  }

  /* np.fft.irfft : à partir de N/2 + 1 coefficients, renvoie un signal réel de longueur N */
  function irfft(X) {
    const m = X.re.length, n = 2 * (m - 1);
    const re = new Float64Array(n), im = new Float64Array(n);
    for (let k = 0; k < m; k++) { re[k] = X.re[k]; im[k] = X.im[k]; }
    im[0] = 0; im[m - 1] = 0;                       // numpy ignore ces parties imaginaires
    for (let k = 1; k < m - 1; k++) { re[n - k] = X.re[k]; im[n - k] = -X.im[k]; }
    fftComplexe(re, im, true);
    return re;
  }

  /* FFT(signal, fe) de Ma312_BE_lib : normalisation, retrait de la moyenne,
     zéro-padding à 2**int(log2(n)+1), puis rfft. */
  function FFT(signal, fe) {
    const n = signal.length;
    let max = 0;
    for (const v of signal) max = Math.max(max, Math.abs(v));
    // np.float32 dans le code Python : on arrondit pareil
    const s = Float32Array.from(signal, function (v) { return v / (max + 1e-12); });
    let moy = 0;
    for (const v of s) moy += v;
    moy /= n;
    const taille = Math.pow(2, Math.floor(Math.log2(n) + 1));
    const z = new Float64Array(taille);
    for (let i = 0; i < n; i++) z[i] = s[i] - moy;
    const spectre = rfft(z);
    const freq = new Float64Array(spectre.re.length);
    for (let k = 0; k < freq.length; k++) freq[k] = k * fe / taille;
    const abs = new Float64Array(spectre.re.length);
    for (let k = 0; k < abs.length; k++) abs[k] = Math.hypot(spectre.re[k], spectre.im[k]);
    return { spectre: spectre, freq: freq, abs: abs };
  }

  /* suppression_de_bruit : on annule les composantes d'amplitude <= tau */
  function suppressionDeBruit(son, fe, tau) {
    const r = FFT(son, fe);
    for (let k = 0; k < r.abs.length; k++) if (r.abs[k] <= tau) { r.spectre.re[k] = 0; r.spectre.im[k] = 0; }
    return irfft(r.spectre).slice(0, son.length);
  }

  /* filtre_pb : on ne garde que fmin < f < fmax */
  function filtrePB(son, fe, fmin, fmax) {
    const r = FFT(son, fe);
    for (let k = 0; k < r.freq.length; k++) {
      if (r.freq[k] <= fmin || r.freq[k] >= fmax) { r.spectre.re[k] = 0; r.spectre.im[k] = 0; }
    }
    return irfft(r.spectre);
  }

  /* autocorrelation : irfft(X * conj(X)), puis plus grand pic entre fe/fmax et fe/fmin */
  function autocorrelation(signal, fe, fmin, fmax) {
    const X = FFT(signal, fe).spectre;
    const P = { re: new Float64Array(X.re.length), im: new Float64Array(X.re.length) };
    for (let k = 0; k < X.re.length; k++) P.re[k] = X.re[k] * X.re[k] + X.im[k] * X.im[k];
    const ac = irfft(P);
    const debut = Math.floor(fe / fmax), fin = Math.floor(fe / fmin);
    let T = debut, best = -Infinity;
    for (let i = debut; i < fin; i++) if (ac[i] > best) { best = ac[i]; T = i; }
    return { f0: fe / T, T: T, autocor: ac };
  }

  /* Retrait de la tendance linéaire (moindres carrés) */
  function retirerTendance(signal) {
    const n = signal.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < n; i++) { sx += i; sy += signal[i]; sxx += i * i; sxy += i * signal[i]; }
    const pente = (n * sxy - sx * sy) / (n * sxx - sx * sx), orig = (sy - pente * sx) / n;
    return Float64Array.from(signal, function (v, i) { return v - (orig + pente * i); });
  }

  /* Spectre fin (zéro-padding jusqu'à >= 8192 points) restreint à [fmin, fmax] :
     pic interpolé (parabole), courbe normalisée et indice de qualité
     (hauteur du pic / amplitude moyenne de la bande). */
  function spectreFin(s, fe, fmin, fmax) {
    const n = s.length;
    let moy = 0;
    for (let i = 0; i < n; i++) moy += s[i];
    moy /= n;
    let N = 8192;
    while (N < 4 * n) N *= 2;
    const z = new Float64Array(N);
    for (let i = 0; i < n; i++) z[i] = s[i] - moy;
    const X = rfft(z);
    const k0 = Math.ceil(fmin * N / fe), k1 = Math.floor(fmax * N / fe);
    const abs = new Float64Array(k1 + 2);
    let kMax = k0, max = 0, somme = 0;
    for (let k = Math.max(0, k0 - 1); k <= k1 + 1 && k < X.re.length; k++) {
      abs[k] = Math.hypot(X.re[k], X.im[k]);
      if (k >= k0 && k <= k1) { somme += abs[k]; if (abs[k] > max) { max = abs[k]; kMax = k; } }
    }
    let decal = 0;
    const a = abs[kMax - 1], b = abs[kMax], c = abs[kMax + 1];
    if (kMax > k0 && kMax < k1 && a - 2 * b + c !== 0) decal = Math.max(-0.5, Math.min(0.5, 0.5 * (a - c) / (a - 2 * b + c)));
    const bande = [];
    const pas = Math.max(1, Math.floor((k1 - k0) / 400));
    for (let k = k0; k <= k1; k += pas) bande.push([k * fe / N * 60, max ? abs[k] / max : 0]);
    return { bpm: (kMax + decal) * fe / N * 60, qualite: max / (somme / (k1 - k0 + 1) || 1), bande: bande };
  }

  /* Seuillage spectral relatif : comme suppression_de_bruit, mais le seuil vaut
     `ratio` x la plus grande composante de la bande cardiaque au lieu d'une
     valeur fixe. */
  function seuillageRelatif(son, fe, ratio, fmin, fmax) {
    const r = FFT(son, fe);
    let max = 0;
    for (let k = 0; k < r.abs.length; k++) if (r.freq[k] > fmin && r.freq[k] < fmax && r.abs[k] > max) max = r.abs[k];
    for (let k = 0; k < r.abs.length; k++) if (r.abs[k] < ratio * max) { r.spectre.re[k] = 0; r.spectre.im[k] = 0; }
    return irfft(r.spectre).slice(0, son.length);
  }

  /* Analyse complète, chaque étape pouvant être activée ou non.
     Ordre de la V2 du BE : seuillage spectral -> passe-bande -> calcul du BPM.
     options :
       tendance   : true/false  retrait de la dérive lente
       seuillage  : "off" | "tau6" (valeur fixe du BE) | nombre entre 0 et 1 (relatif)
       passeBande : true/false  filtre_pb entre bpmMin et bpmMax
     Renvoie les deux estimations (pic de la FFT et autocorrélation),
     de quoi tracer les courbes, et un indice de qualité. */
  function analyser(signal, fe, options) {
    const o = Object.assign({ tendance: true, seuillage: 0.3, passeBande: true, bpmMin: 45, bpmMax: 180 }, options || {});
    const fmin = o.bpmMin / 60, fmax = o.bpmMax / 60;
    const n = signal.length;

    let s = Float64Array.from(signal);
    if (o.tendance) s = retirerTendance(s);
    if (o.seuillage === "tau6") s = suppressionDeBruit(s, fe, 6);
    else if (typeof o.seuillage === "number") s = seuillageRelatif(s, fe, o.seuillage, fmin, fmax);
    if (o.passeBande) s = filtrePB(s, fe, fmin, fmax).slice(0, n);

    let energie = 0, moy = 0;
    for (let i = 0; i < n; i++) moy += s[i];
    moy /= n;
    for (let i = 0; i < n; i++) energie += (s[i] - moy) * (s[i] - moy);
    if (!(energie > 1e-12)) return { vide: true, signal: s };

    const sp = spectreFin(s, fe, fmin, fmax);
    const bpmFFT = sp.bpm;
    // Qualité jugée sur le signal brut (seulement sans dérive), pour qu'elle ne
    // dépende pas des réglages : le seuillage gonflerait artificiellement le pic.
    const qualite = spectreFin(retirerTendance(signal), fe, fmin, fmax).qualite;
    const bande = sp.bande;

    // Autocorrélation (fonction du BE) et courbe en fonction du BPM
    const ac = autocorrelation(s, fe, fmin, fmax);
    const courbeAC = [];
    for (let T = Math.max(1, Math.floor(fe / fmax)); T <= Math.ceil(fe / fmin); T++) {
      courbeAC.push([60 * fe / T, ac.autocor[T] / ac.autocor[0]]);
    }

    return { vide: false, signal: s, bpmFFT: bpmFFT, bpmAC: ac.f0 * 60, qualite: qualite,
             bande: bande, courbeAC: courbeAC, fe: fe };
  }

  /* Rééchantillonnage linéaire sur une grille régulière (les images de la
     webcam n'arrivent pas à intervalles parfaitement égaux). */
  function reechantillonner(temps, valeurs, fe) {
    const t0 = temps[0], duree = temps[temps.length - 1] - t0;
    const n = Math.floor(duree * fe) + 1;
    const out = new Float64Array(n);
    let j = 0;
    for (let i = 0; i < n; i++) {
      const t = t0 + i / fe;
      while (j < temps.length - 2 && temps[j + 1] < t) j++;
      const a = temps[j], b = temps[j + 1];
      const u = b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : 0;
      out[i] = valeurs[j] * (1 - u) + valeurs[j + 1] * u;
    }
    return out;
  }

  const api = { FFT: FFT, rfft: rfft, irfft: irfft, suppressionDeBruit: suppressionDeBruit,
                filtrePB: filtrePB, autocorrelation: autocorrelation, analyser: analyser,
                retirerTendance: retirerTendance, seuillageRelatif: seuillageRelatif,
                reechantillonner: reechantillonner };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else racine.BPM = api;
})(this);
