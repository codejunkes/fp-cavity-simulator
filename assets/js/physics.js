/*
 * Fabry–Pérot Cavity Simulator — physics engine
 * ---------------------------------------------
 * Pure functions, SI units throughout, no DOM access. Works in the browser
 * (exposed as window.FPPhysics) and in Node (module.exports) for testing.
 *
 * Key references
 *  [Siegman]  A. E. Siegman, Lasers (University Science Books, 1986), ch. 19–21.
 *  [Black]    E. D. Black, Am. J. Phys. 69, 79 (2001) — PDH locking.
 *  [Numata]   K. Numata, A. Kemery, J. Camp, PRL 93, 250602 (2004).
 *  [Kessler]  T. Kessler, T. Legero, U. Sterr, JOSA B 29, 178 (2012).
 *  [Legero]   T. Legero, T. Kessler, U. Sterr, JOSA B 27, 914 (2010).
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.FPPhysics = lib;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CONST = Object.freeze({
    c: 299792458,            // m/s (exact)
    h: 6.62607015e-34,       // J s (exact)
    kB: 1.380649e-23,        // J/K (exact)
    sigmaSB: 5.670374419e-8, // W m^-2 K^-4
  });
  const T20 = 293.15;        // 20 °C in kelvin, reference for linear CTE models
  const PI = Math.PI;

  /* ------------------------------------------------------------------ */
  /* Material library (typical values; all editable in the UI)           */
  /* ------------------------------------------------------------------ */
  // phi = mechanical loss angle = 1/Q.  CTE models:
  //   'zero'   alpha(T) = a (T - T0) + b (T - T0)^2           (zero-crossing glass)
  //   'linear' alpha(T) = alpha20 + slope (T - 293.15 K)
  const MATERIALS = Object.freeze({
    ule: {
      name: 'ULE (Corning 7972)', E: 67.6e9, sigma: 0.17, phi: 1.6e-5, rho: 2210, cp: 767,
      cte: { model: 'zero', T0: 302.97, a: 2.4e-9, b: 0, alpha20: 0, slope: 0 },
    },
    fs: {
      name: 'Fused silica (Corning 7980)', E: 73.1e9, sigma: 0.17, phi: 1e-6, rho: 2201, cp: 740,
      cte: { model: 'linear', alpha20: 500e-9, slope: 2.2e-9, T0: 0, a: 0, b: 0 },
    },
    zerodur: {
      name: 'Zerodur (class 0)', E: 90.3e9, sigma: 0.243, phi: 3.2e-4, rho: 2530, cp: 800,
      cte: { model: 'linear', alpha20: 20e-9, slope: 0, T0: 0, a: 0, b: 0 },
    },
    clearceram: {
      name: 'Clearceram-Z HS', E: 90.2e9, sigma: 0.25, phi: 3.3e-4, rho: 2550, cp: 780,
      cte: { model: 'linear', alpha20: 20e-9, slope: 0, T0: 0, a: 0, b: 0 },
    },
    sapphire: {
      name: 'Sapphire (room temp.)', E: 400e9, sigma: 0.29, phi: 1e-8, rho: 3980, cp: 750,
      cte: { model: 'linear', alpha20: 5.5e-6, slope: 0, T0: 0, a: 0, b: 0 },
    },
  });

  /* ------------------------------------------------------------------ */
  /* Small numeric helpers                                               */
  /* ------------------------------------------------------------------ */
  const isNum = (x) => typeof x === 'number' && !Number.isNaN(x);
  const curvature = (roc) => (Number.isFinite(roc) ? 1 / roc : 0); // 1/R, 0 for flat
  const linspace = (a, b, n) => {
    const out = new Array(n);
    if (n === 1) { out[0] = a; return out; }
    for (let i = 0; i < n; i++) out[i] = a + ((b - a) * i) / (n - 1);
    return out;
  };
  const logspace = (a, b, n) => linspace(Math.log10(a), Math.log10(b), n).map((e) => 10 ** e);
  const mat2mul = (A, B) => [
    [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
    [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
  ];

  // Seeded PRNG (mulberry32) + standard normal (Box–Muller)
  function makeRng(seed) {
    let a = (seed >>> 0) || 1;
    const uni = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let spare = null;
    const normal = () => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0;
      while (u <= 1e-300) u = uni();
      v = uni();
      const r = Math.sqrt(-2 * Math.log(u));
      spare = r * Math.sin(2 * PI * v);
      return r * Math.cos(2 * PI * v);
    };
    return { uni, normal };
  }

  // Bessel functions of the first kind, integer order, power series (|x| < ~10)
  function besselJ(n, x) {
    let sum = 0, term = 1;
    for (let k = 1; k <= n; k++) term *= x / 2 / k; // (x/2)^n / n!
    for (let k = 0; k < 60; k++) {
      sum += term;
      term *= (-(x * x) / 4) / ((k + 1) * (k + 1 + n));
      if (Math.abs(term) < 1e-17 * Math.abs(sum)) break;
    }
    return sum;
  }

  /* ------------------------------------------------------------------ */
  /* 1. Cavity: resonator + Gaussian mode                                */
  /* ------------------------------------------------------------------ */
  /**
   * @param {object} p
   *   L       cavity length (m)
   *   roc1/2  mirror radii of curvature (m); Infinity = flat, <0 = convex
   *   lambda  vacuum wavelength (m)
   *   n       refractive index of the intracavity medium
   *   R1/R2   power reflectivities;  loss1/loss2 absorption+scatter (fraction)
   */
  function cavity(p) {
    const { L, roc1, roc2, lambda } = p;
    const n = p.n || 1;
    const c = CONST.c;
    const res = { input: p };
    res.nu = c / lambda;                     // optical frequency (Hz)
    res.FSR = c / (2 * n * L);               // free spectral range (Hz)
    res.lambdaMedium = lambda / n;

    // --- mirrors
    const R1 = p.R1, R2 = p.R2;
    const loss1 = p.loss1 || 0, loss2 = p.loss2 || 0;
    const T1 = 1 - R1 - loss1, T2 = 1 - R2 - loss2;
    const r1 = Math.sqrt(R1), r2 = Math.sqrt(R2);
    const rr = r1 * r2;                      // round-trip amplitude factor
    Object.assign(res, { R1, R2, T1, T2, loss1, loss2, r1, r2, rr });
    res.coefFinesse = (4 * rr) / (1 - rr) ** 2;            // "F" in Airy function
    const arg = (1 - rr) / (2 * Math.sqrt(rr));
    res.finesseExact = arg <= 1 ? PI / (2 * Math.asin(arg)) : NaN; // FWHM-based
    res.finesseApprox = (PI * Math.sqrt(rr)) / (1 - rr);
    res.peaksOverlap = !(arg <= 1);
    res.finesse = res.peaksOverlap ? res.finesseApprox : res.finesseExact;
    res.fwhm = res.FSR / res.finesse;          // linewidth (Hz)
    res.hwhm = res.fwhm / 2;                   // cavity pole for frequency noise
    res.Q = res.nu / res.fwhm;
    res.tauStorage = 1 / (2 * PI * res.fwhm);  // intracavity energy decay time
    res.roundTripTime = (2 * n * L) / c;
    res.lengthFwhm = res.lambdaMedium / (2 * res.finesse); // resonance width in length
    // on resonance
    res.transRes = (T1 * T2) / (1 - rr) ** 2;
    const fRes = (-r1 + r2 * (R1 + T1)) / (1 - rr);       // reflection amplitude [Black sign]
    res.reflRes = fRes * fRes;
    res.circGain = T1 / (1 - rr) ** 2;                    // P_circ / P_in (forward wave)
    res.lossRes = Math.max(0, 1 - res.transRes - res.reflRes);

    // --- geometry
    const C1 = curvature(roc1), C2 = curvature(roc2);
    const g1 = 1 - L * C1, g2 = 1 - L * C2, g = g1 * g2;
    Object.assign(res, { C1, C2, g1, g2, g });
    const tol = 1e-12;
    if (g > tol && g < 1 - tol) res.stability = 'stable';
    else if (Math.abs(g) <= tol || Math.abs(g - 1) <= tol) res.stability = 'marginal';
    else res.stability = 'unstable';

    // round-trip ABCD, reference plane just after M1, travelling towards M2
    const P = [[1, L], [0, 1]];
    const M1 = [[1, 0], [-2 * C1, 1]], M2 = [[1, 0], [-2 * C2, 1]];
    const M = mat2mul(M1, mat2mul(P, mat2mul(M2, P)));
    res.abcd = M;
    res.abcdDet = M[0][0] * M[1][1] - M[0][1] * M[1][0];
    res.halfTrace = (M[0][0] + M[1][1]) / 2;           // = 2 g1 g2 - 1

    res.hasMode = res.stability === 'stable';
    if (res.hasMode) {
      const k = (res.lambdaMedium * L) / PI;
      res.w1 = Math.sqrt(k * Math.sqrt(g2 / (g1 * (1 - g))));
      res.w2 = Math.sqrt(k * Math.sqrt(g1 / (g2 * (1 - g))));
      const den = g1 + g2 - 2 * g;
      res.w0 = Math.sqrt(k * Math.sqrt((g * (1 - g)) / (den * den)));
      res.z1 = (L * g2 * (1 - g1)) / den;              // waist position from M1
      res.zR = (PI * res.w0 * res.w0) / res.lambdaMedium;
      res.divergence = res.lambdaMedium / (PI * res.w0); // far-field half angle (rad)
      // one-way Gouy phase; sign of g1 picks the correct branch [Siegman]
      res.gouy = Math.acos(Math.sign(g1) * Math.sqrt(g));
      res.tms = (res.FSR * res.gouy) / PI;             // transverse mode spacing (Hz)
      res.tmsFrac = res.gouy / PI;                     // in units of FSR
    }
    return res;
  }

  /** Beam radius along the cavity axis (z measured from M1). */
  function beamProfile(cav, nPts = 241) {
    if (!cav.hasMode) return null;
    const L = cav.input.L;
    const z = linspace(0, L, nPts);
    const w = z.map((zz) => cav.w0 * Math.sqrt(1 + ((zz - cav.z1) / cav.zR) ** 2));
    return { z, w };
  }

  /** Airy response vs detuning from resonance (Hz). */
  function airy(cav, df) {
    const { r1, r2, R1, T1, T2, FSR } = cav;
    const rr = r1 * r2;
    const trans = new Array(df.length), refl = new Array(df.length), circ = new Array(df.length);
    for (let i = 0; i < df.length; i++) {
      const ph = (2 * PI * df[i]) / FSR;
      const cr = Math.cos(ph), sr = Math.sin(ph);
      const den = 1 + rr * rr - 2 * rr * cr;             // |1 - rr e^{i ph}|^2
      trans[i] = (T1 * T2) / den;
      circ[i] = T1 / den;
      // F = (-r1 + r2 (R1+T1) e^{i ph}) / (1 - rr e^{i ph})
      const nr = -r1 + r2 * (R1 + T1) * cr, ni = r2 * (R1 + T1) * sr;
      refl[i] = (nr * nr + ni * ni) / den;
    }
    return { trans, refl, circ };
  }

  /** Non-uniform detuning grid dense around given centres (Hz). */
  function featureGrid(span, centres, width, nCoarse = 1500, nFine = 301) {
    const pts = linspace(-span, span, nCoarse);
    for (const c0 of centres) {
      for (const x of linspace(c0 - 12 * width, c0 + 12 * width, nFine)) {
        if (x >= -span && x <= span) pts.push(x);
      }
      for (const x of linspace(c0 - 400 * width, c0 + 400 * width, nFine)) {
        if (x >= -span && x <= span) pts.push(x);
      }
    }
    pts.sort((a, b) => a - b);
    const out = [];
    for (const x of pts) if (!out.length || x - out[out.length - 1] > 1e-12 * span) out.push(x);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 2. Stability analysis                                               */
  /* ------------------------------------------------------------------ */
  const REFERENCE_CAVITIES = [
    { name: 'Plane–parallel', g1: 1, g2: 1, rule: 'R₁ = R₂ = ∞' },
    { name: 'Symmetric confocal', g1: 0, g2: 0, rule: 'R₁ = R₂ = L' },
    { name: 'Symmetric concentric', g1: -1, g2: -1, rule: 'R₁ = R₂ = L/2' },
    { name: 'Hemispherical', g1: 0, g2: 1, rule: 'R₁ = L, R₂ = ∞' },
    { name: 'Plano–concave (R = 2L)', g1: 0.5, g2: 1, rule: 'R₁ = 2L, R₂ = ∞' },
    { name: 'Symmetric (R = 2L)', g1: 0.5, g2: 0.5, rule: 'R₁ = R₂ = 2L' },
    { name: 'Concave–convex', g1: 2, g2: 1 / 3, rule: 'R₁ = −L, R₂ = 3L/2' },
    { name: 'Concentric–confocal', g1: -1, g2: 0, rule: 'R₁ = L/2, R₂ = L' },
  ];

  /** Geometry presets: mirror radii as functions of the current length. */
  const GEOMETRY_PRESETS = {
    'plane-parallel':  { label: 'Plane–parallel (marginal)', roc: (L) => [Infinity, Infinity] },
    'plano-concave':   { label: 'Plano–concave, R = 2L', roc: (L) => [2 * L, Infinity] },
    hemispherical:     { label: 'Hemispherical, R = L (marginal)', roc: (L) => [L, Infinity] },
    'symmetric-2L':    { label: 'Symmetric, R = 2L', roc: (L) => [2 * L, 2 * L] },
    confocal:          { label: 'Symmetric confocal, R = L (marginal)', roc: (L) => [L, L] },
    'near-concentric': { label: 'Near-concentric, R = 0.524 L', roc: (L) => [0.524 * L, 0.524 * L] },
    concentric:        { label: 'Symmetric concentric, R = L/2 (marginal)', roc: (L) => [L / 2, L / 2] },
    'concave-concave': { label: 'Asymmetric concave, R₁ = 2L, R₂ = 3L', roc: (L) => [2 * L, 3 * L] },
    'convex-concave':  { label: 'Convex–concave, R₁ = −L, R₂ = 3L/2', roc: (L) => [-L, 1.5 * L] },
  };

  /** Stable length intervals for fixed mirrors: 0 < g1 g2 < 1. */
  function stableLengthIntervals(roc1, roc2, Lmax) {
    const C1 = curvature(roc1), C2 = curvature(roc2);
    const crit = [0];
    for (const R of [roc1, roc2, roc1 + roc2]) if (Number.isFinite(R) && R > 0) crit.push(R);
    crit.push(Lmax);
    const pts = [...new Set(crit.filter((x) => x <= Lmax))].sort((a, b) => a - b);
    const gOf = (L) => (1 - L * C1) * (1 - L * C2);
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const mid = (pts[i] + pts[i + 1]) / 2;
      const gm = gOf(mid);
      if (gm > 0 && gm < 1) {
        if (out.length && Math.abs(out[out.length - 1][1] - pts[i]) < 1e-15) out[out.length - 1][1] = pts[i + 1];
        else out.push([pts[i], pts[i + 1]]);
      }
    }
    return out;
  }

  /** Sweep of g-factors and mode sizes versus length with fixed mirrors. */
  function lengthSweep(base, Lmax, nPts = 600) {
    const Ls = linspace(Lmax / nPts, Lmax, nPts);
    const out = { L: Ls, g: [], w0: [], w1: [], w2: [] };
    for (const L of Ls) {
      const cv = cavity({ ...base, L });
      out.g.push(cv.g);
      out.w0.push(cv.hasMode ? cv.w0 : null);
      out.w1.push(cv.hasMode ? cv.w1 : null);
      out.w2.push(cv.hasMode ? cv.w2 : null);
    }
    return out;
  }

  /**
   * Exact change of g = g1 g2 for small length / curvature changes,
   * written to avoid catastrophic cancellation (the original subtracted
   * nearly equal numbers at the 1e-16 level).
   */
  function gSensitivity(cav, dL, dR) {
    const { C1, C2, g1, g2 } = cav;
    const L = cav.input.L;
    const roc1 = cav.input.roc1;
    const byL = dL.map((d) => -d * (C1 + C2) + C1 * C2 * (2 * L * d + d * d));
    const byR1 = Number.isFinite(roc1)
      ? dR.map((d) => ((L * d) / (roc1 * (roc1 + d))) * g2)
      : dR.map(() => 0);
    const dgdL = -(C1 * g2 + C2 * g1);
    return { byL, byR1, dgdL };
  }

  /* ------------------------------------------------------------------ */
  /* 3. Higher-order (Hermite–Gauss) modes                               */
  /* ------------------------------------------------------------------ */
  /**
   * Transverse-mode spectrum. For mode order N = m + n the resonance offset
   * from the nearest TEM00 resonance is N·ψ/π (mod 1) FSR; the relative
   * transmission when the laser sits on the TEM00 resonance (equal input
   * coupling) is 1 / (1 + F sin²(N ψ)).
   */
  function homSpectrum(cav, Nmax) {
    if (!cav.hasMode) return null;
    const out = [];
    for (let N = 0; N <= Nmax; N++) {
      let frac = ((N * cav.gouy) / PI) % 1;
      if (frac > 0.5) frac -= 1;
      const s = Math.sin(N * cav.gouy);
      out.push({
        N, degeneracy: N + 1,
        offsetFrac: frac, offsetHz: frac * cav.FSR,
        rel: 1 / (1 + cav.coefFinesse * s * s),
        offsetLinewidths: (frac * cav.FSR) / cav.fwhm,
      });
    }
    return out;
  }

  /** Relative transmission of order-N modes as a function of g = g1 g2 (g1,g2 > 0). */
  function homVsG(coefFinesse, Nmax, gs) {
    const series = [];
    for (let N = 1; N <= Nmax; N++) {
      series.push(gs.map((g) => {
        const psi = Math.acos(Math.sqrt(Math.min(1, Math.max(0, g))));
        const s = Math.sin(N * psi);
        return 1 / (1 + coefFinesse * s * s);
      }));
    }
    const sum = gs.map((_, i) => series.reduce((acc, s) => acc + s[i], 0));
    return { series, sum };
  }

  /** Relative transmission of order-N mode vs cavity length (fixed mirrors). */
  function homVsLength(base, N, Ls) {
    return Ls.map((L) => {
      const cv = cavity({ ...base, L });
      if (!cv.hasMode) return null;
      const s = Math.sin(N * cv.gouy);
      return 1 / (1 + cv.coefFinesse * s * s);
    });
  }

  /** Physicists' Hermite polynomial H_n(x). */
  function hermite(n, x) {
    if (n === 0) return 1;
    let h0 = 1, h1 = 2 * x;
    for (let k = 1; k < n; k++) { const h2 = 2 * x * h1 - 2 * k * h0; h0 = h1; h1 = h2; }
    return h1;
  }

  /** Normalised intensity of HG_mn on a square grid (coordinates in m). */
  function hgIntensity(m, n, w, extent, N = 121) {
    const xs = linspace(-extent, extent, N);
    const fx = xs.map((x) => hermite(m, (Math.SQRT2 * x) / w) * Math.exp(-(x * x) / (w * w)));
    const fy = xs.map((y) => hermite(n, (Math.SQRT2 * y) / w) * Math.exp(-(y * y) / (w * w)));
    let max = 0;
    const z = fy.map((vy) => fx.map((vx) => { const v = (vx * vy) ** 2; if (v > max) max = v; return v; }));
    for (const row of z) for (let i = 0; i < row.length; i++) row[i] /= max || 1;
    return { x: xs, y: xs, z };
  }

  /** Fraction of TEM00 power outside a circular aperture of radius a. */
  const clipLoss = (w, a) => Math.exp((-2 * a * a) / (w * w));

  /* ------------------------------------------------------------------ */
  /* 4. Brownian thermal noise [Numata 2004; Kessler 2012]               */
  /* ------------------------------------------------------------------ */
  /**
   * Displacement PSDs (m²/Hz, one-sided) of spacer, both substrates and both
   * coatings, total; fractional-frequency PSD S_y = S_x/L² and the flicker
   * floor of the Allan deviation σ_y = sqrt(2 ln2 · f · S_y(f)).
   */
  function thermalNoise(cav, p, freqs) {
    if (!cav.hasMode) return null;
    const { kB } = CONST;
    const T = p.T, L = cav.input.L;
    const sp = p.spacer, mr = p.mirror;
    const area = PI * (p.Rsp * p.Rsp - p.rbore * p.rbore);
    // coefficients C so that S(f) = C / f
    const cSp = (4 * kB * T * L * sp.phi) / (2 * PI * sp.E * area);
    const subC = (w) => (4 * kB * T * (1 - mr.sigma ** 2) * mr.phi) / (2 * PI * Math.sqrt(PI) * mr.E * w);
    const coatC = (w) => subC(w) * (2 / Math.sqrt(PI)) * ((1 - 2 * mr.sigma) / (1 - mr.sigma)) * (p.coatPhi / mr.phi) * (p.coatD / w);
    const c = {
      spacer: cSp,
      substrate1: subC(cav.w1), substrate2: subC(cav.w2),
      coating1: coatC(cav.w1), coating2: coatC(cav.w2),
    };
    c.substrates = c.substrate1 + c.substrate2;
    c.coatings = c.coating1 + c.coating2;
    c.total = c.spacer + c.substrates + c.coatings;
    const floor = (C) => Math.sqrt((2 * Math.LN2 * C) / (L * L)); // f·S_y(f) = C/L²
    const comp = ['spacer', 'substrates', 'coatings', 'total'];
    const out = { coef: c, floor: {}, share: {}, f: freqs, Sx: {}, asdX: {}, asdY: {}, asdNu: {} };
    for (const k of comp) {
      out.floor[k] = floor(c[k]);
      out.share[k] = c[k] / c.total;
      out.Sx[k] = freqs.map((f) => c[k] / f);
      out.asdX[k] = out.Sx[k].map((s) => Math.sqrt(s));
      out.asdY[k] = out.asdX[k].map((a) => a / L);
      out.asdNu[k] = out.asdY[k].map((a) => a * cav.nu);
    }
    // displacement noise at 1 Hz (m/sqrt(Hz)) for the summary
    out.asdX1Hz = Math.sqrt(c.total);
    return out;
  }

  /* ------------------------------------------------------------------ */
  /* 5. Thermal expansion [Legero 2010]                                  */
  /* ------------------------------------------------------------------ */
  /** CTE model → polynomial in u = T − 293.15 K: alpha(u) = c0 + c1 u + c2 u². */
  function ctePoly(cte) {
    if (cte.model === 'zero') {
      const u0 = cte.T0 - T20, a = cte.a, b = cte.b || 0;
      return [-a * u0 + b * u0 * u0, a - 2 * b * u0, b];
    }
    return [cte.alpha20, cte.slope || 0, 0];
  }
  const polyEval = (c, u) => c[0] + c[1] * u + c[2] * u * u;
  const polyInt = (c, u) => c[0] * u + (c[1] * u * u) / 2 + (c[2] * u * u * u) / 3;

  /**
   * Effective cavity CTE with mirrors bonded to the spacer [Legero eq. 1]:
   *   alpha_eff = alpha_s + 2 δ (R_m / L) (alpha_m − alpha_s)
   * (two identical mirrors). Returns helpers in absolute temperature (K).
   */
  function cteModel(spacerCte, mirrorCte, delta, Rm, L) {
    const k = (2 * delta * Rm) / L;
    const ps = ctePoly(spacerCte), pm = ctePoly(mirrorCte);
    const pe = [0, 1, 2].map((i) => (1 - k) * ps[i] + k * pm[i]);
    const alphaS = (T) => polyEval(ps, T - T20);
    const alphaM = (T) => polyEval(pm, T - T20);
    const alphaEff = (T) => polyEval(pe, T - T20);
    // ΔL/L relative to a reference temperature (exact integral)
    const fracLen = (T, Tref) => polyInt(pe, T - T20) - polyInt(pe, Tref - T20);
    // zero crossing(s) of the effective CTE within ±150 K of 20 °C
    const roots = [];
    const [c0, c1, c2] = pe;
    if (Math.abs(c2) > 1e-30) {
      const disc = c1 * c1 - 4 * c2 * c0;
      if (disc >= 0) {
        const s = Math.sqrt(disc);
        // numerically stable quadratic roots
        const q = -0.5 * (c1 + Math.sign(c1 || 1) * s);
        const ra = q / c2, rb = q !== 0 ? c0 / q : NaN;
        for (const r of [ra, rb]) if (Number.isFinite(r)) roots.push(r + T20);
      }
    } else if (Math.abs(c1) > 1e-30) roots.push(-c0 / c1 + T20);
    const plausible = roots.filter((T) => T > T20 - 150 && T < T20 + 150);
    // choose the crossing with positive slope (a minimum of ΔL/L) closest to the spacer T0
    const target = spacerCte.model === 'zero' ? spacerCte.T0 : T20;
    plausible.sort((a, b) => Math.abs(a - target) - Math.abs(b - target));
    const T0eff = plausible.length ? plausible[0] : null;
    return { k, ps, pm, pe, alphaS, alphaM, alphaEff, fracLen, T0eff, roots: plausible };
  }

  /* ------------------------------------------------------------------ */
  /* 6. Thermal shields: lumped radiative + conductive network           */
  /* ------------------------------------------------------------------ */
  /** Linearised radiative conductance between an inner body and its enclosure. */
  function radConductance(Tm, Ainner, eInner, Aouter, eOuter) {
    const Rth = 1 / (Ainner * eInner) + (1 / Aouter) * (1 / eOuter - 1);
    return (4 * CONST.sigmaSB * Tm ** 3) / Rth;
  }
  const condConductance = (nContacts, k, area, len) => (nContacts * k * area) / len;

  /** Build the node network P2, P3 (and the cavity). Returns A, B and per-stage data. */
  function shieldNetwork(s) {
    const Tm = s.Tmean;
    const useRad = s.useRadiation !== false, useCond = s.useConduction !== false;
    const stage = (rad, cond) => ({ rad: useRad ? rad : 0, cond: useCond ? cond : 0 });
    const st12 = stage(
      radConductance(Tm, s.A2out, s.e2out, s.A1in, s.e1in),
      condConductance(s.n12, s.k12, s.a12, s.l12),
    );
    const st23 = stage(
      radConductance(Tm, s.A3out, s.e3out, s.A2in, s.e2in),
      condConductance(s.n23, s.k23, s.a23, s.l23),
    );
    const C2 = s.m2 * s.c2, C3 = s.m3 * s.c3;
    const nodes = ['P2', 'P3'];
    const G12 = st12.rad + st12.cond, G23 = st23.rad + st23.cond;
    let A, B, Cs, stages;
    stages = [
      { name: 'P1 → P2', G: G12, Grad: st12.rad, Gcond: st12.cond, C: C2 },
      { name: 'P2 → P3', G: G23, Grad: st23.rad, Gcond: st23.cond, C: C3 },
    ];
    if (s.includeCavity) {
      const st3c = stage(
        radConductance(Tm, s.Acav, s.ecav, s.A3in, s.e3in),
        condConductance(s.n3c, s.k3c, s.a3c, s.l3c),
      );
      const G3c = st3c.rad + st3c.cond;
      const Cc = s.Ccav;
      stages.push({ name: 'P3 → cavity', G: G3c, Grad: st3c.rad, Gcond: st3c.cond, C: Cc });
      nodes.push('Cavity');
      A = [
        [-(G12 + G23) / C2, G23 / C2, 0],
        [G23 / C3, -(G23 + G3c) / C3, G3c / C3],
        [0, G3c / Cc, -G3c / Cc],
      ];
      B = [G12 / C2, 0, 0];
      Cs = [C2, C3, Cc];
    } else {
      A = [[-(G12 + G23) / C2, G23 / C2], [G23 / C3, -G23 / C3]];
      B = [G12 / C2, 0];
      Cs = [C2, C3];
    }
    for (const sg of stages) {
      sg.tau = sg.G > 0 ? sg.C / sg.G : Infinity;          // isolated-stage time constant
      sg.tauRad = sg.Grad > 0 ? sg.C / sg.Grad : Infinity;
      sg.tauCond = sg.Gcond > 0 ? sg.C / sg.Gcond : Infinity;
    }
    return { A, B, C: Cs, nodes, stages };
  }

  // --- small dense linear algebra (n ≤ 3) ---------------------------------
  const matMul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((s, a, k) => s + a * B[k][j], 0)));
  const matVec = (A, v) => A.map((row) => row.reduce((s, a, k) => s + a * v[k], 0));
  const eye = (n) => Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  function solve(A, b) { // Gaussian elimination with partial pivoting (real)
    const n = b.length;
    const M = A.map((r, i) => [...r, b[i]]);
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
      [M[col], M[piv]] = [M[piv], M[col]];
      for (let r = col + 1; r < n; r++) {
        const f = M[r][col] / M[col][col];
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
      }
    }
    const x = new Array(n).fill(0);
    for (let r = n - 1; r >= 0; r--) {
      let s = M[r][n];
      for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
      x[r] = s / M[r][r];
    }
    return x;
  }
  function solveComplex(Are, Aim, bre, bim) { // (Are + i Aim) x = bre + i bim
    const n = bre.length;
    // embed in real 2n system
    const A = [], b = [];
    for (let i = 0; i < n; i++) {
      A.push([...Are[i], ...Aim[i].map((v) => -v)]); b.push(bre[i]);
    }
    for (let i = 0; i < n; i++) {
      A.push([...Aim[i], ...Are[i]]); b.push(bim[i]);
    }
    const x = solve(A, b);
    return { re: x.slice(0, n), im: x.slice(n) };
  }
  function expm(A) { // scaling and squaring with Taylor series (small, well-conditioned)
    const n = A.length;
    const norm = Math.max(...A.map((r) => r.reduce((s, v) => s + Math.abs(v), 0)));
    let sPow = Math.max(0, Math.ceil(Math.log2(norm || 1)) + 1);
    const scale = 2 ** -sPow;
    const As = A.map((r) => r.map((v) => v * scale));
    let E = eye(n), term = eye(n);
    for (let k = 1; k <= 20; k++) {
      term = matMul(term, As).map((r) => r.map((v) => v / k));
      E = E.map((r, i) => r.map((v, j) => v + term[i][j]));
    }
    for (let i = 0; i < sPow; i++) E = matMul(E, E);
    return E;
  }
  /** Eigenvalues of the network matrix (real, negative) via symmetrisation + Jacobi. */
  function networkEigenvalues(net) {
    const n = net.A.length;
    // A = -C^{-1} K with K symmetric; S = C^{1/2} A C^{-1/2} is symmetric
    const sq = net.C.map(Math.sqrt);
    let S = net.A.map((r, i) => r.map((v, j) => (sq[i] * v) / sq[j]));
    for (let sweep = 0; sweep < 50; sweep++) {
      let off = 0;
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += S[i][j] ** 2;
      if (off < 1e-30) break;
      for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
        if (Math.abs(S[p][q]) < 1e-300) continue;
        const theta = (S[q][q] - S[p][p]) / (2 * S[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
        const R = eye(n); R[p][p] = cs; R[q][q] = cs; R[p][q] = sn; R[q][p] = -sn;
        const Rt = R.map((r, i) => r.map((_, j) => R[j][i]));
        S = matMul(Rt, matMul(S, R));
      }
    }
    return S.map((r, i) => r[i]).sort((a, b) => b - a); // least negative first
  }

  /** Response of all nodes to a P1 input history u(t) (ZOH), states start at 0. */
  function simulateNetwork(net, dt, nSteps, uOf) {
    const n = net.A.length;
    const Phi = expm(net.A.map((r) => r.map((v) => v * dt)));
    // Gamma = A^{-1} (Phi - I) B
    const PmI = Phi.map((r, i) => r.map((v, j) => v - (i === j ? 1 : 0)));
    const Gamma = solve(net.A, matVec(PmI, net.B));
    let x = new Array(n).fill(0);
    const t = [0], X = net.nodes.map(() => [0]), U = [uOf(0)];
    for (let k = 0; k < nSteps; k++) {
      const u = uOf(k * dt);
      const xn = matVec(Phi, x).map((v, i) => v + Gamma[i] * u);
      x = xn;
      t.push((k + 1) * dt);
      xn.forEach((v, i) => X[i].push(v));
      U.push(uOf((k + 1) * dt));
    }
    return { t, X, U };
  }

  /** Complex frequency response H(iω) = (iωI − A)^{-1} B for each node. */
  function networkResponse(net, omegas) {
    const n = net.A.length;
    return omegas.map((w) => {
      const Are = net.A.map((r) => r.map((v) => -v));
      const Aim = eye(n).map((r) => r.map((v) => v * w));
      const sol = solveComplex(Are, Aim, net.B, new Array(n).fill(0));
      return sol.re.map((re, i) => ({ re, im: sol.im[i], amp: Math.hypot(re, sol.im[i]), phase: Math.atan2(sol.im[i], re) }));
    });
  }

  /* ------------------------------------------------------------------ */
  /* 7. Residual gas & radiation pressure                                */
  /* ------------------------------------------------------------------ */
  // Static polarisability volumes α' (10⁻³⁰ m³ = Å³), CRC Handbook values.
  const GASES = {
    H2: { name: 'Hydrogen, H₂', alpha: 0.8045e-30 },
    He: { name: 'Helium, He', alpha: 0.2050e-30 },
    N2: { name: 'Nitrogen, N₂', alpha: 1.7403e-30 },
    H2O: { name: 'Water vapour, H₂O', alpha: 1.501e-30 },
    Ar: { name: 'Argon, Ar', alpha: 1.6411e-30 },
    CO2: { name: 'Carbon dioxide, CO₂', alpha: 2.911e-30 },
  };
  /** Refractivity change of an ideal gas: Δn = 2π α' Δp / (k_B T)  (Δp in Pa). */
  const gasRefractivity = (alphaVol, dpPa, T) => (2 * PI * alphaVol * dpPa) / (CONST.kB * T);

  /** Static compliance (m/N) of a half-space under a Gaussian load of 1/e² radius w. */
  const halfSpaceCompliance = (E, sigma, w) => (1 - sigma * sigma) / (Math.sqrt(PI) * E * w);

  /**
   * Radiation-pressure effects with the laser on resonance.
   *  - static length change from local mirror deformation and spacer stretch
   *  - quantum (shot-noise) radiation-pressure length noise (white, low f)
   *  - technical: laser RIN converted to length noise
   */
  function radiationPressure(cav, p, Pin) {
    if (!cav.hasMode) return null;
    const { c, h } = CONST;
    const chi1 = halfSpaceCompliance(p.mirror.E, p.mirror.sigma, cav.w1);
    const chi2 = halfSpaceCompliance(p.mirror.E, p.mirror.sigma, cav.w2);
    const area = PI * (p.Rsp * p.Rsp - p.rbore * p.rbore);
    const chiSpacer = cav.input.L / (p.spacer.E * area);       // spacer stretch per N
    const Pc = Pin.map((P) => P * cav.circGain);
    // forces: forward wave hits M2 with Pc, backward wave hits M1 with R2·Pc
    const kF = ((1 + cav.R2) * chi2 + (1 + cav.R1) * cav.R2 * chi1 + ((1 + cav.R2) + (1 + cav.R1) * cav.R2) / 2 * chiSpacer) / c;
    const dL = Pc.map((P) => kF * P);                            // m
    const dnu = dL.map((d) => (-cav.nu * d) / cav.input.L);      // Hz
    // intracavity power shot noise: S_Pc = 2 h ν Pc (ΣT + losses)/(1 - r1 r2)^2
    const portSum = cav.T1 + cav.T2 + cav.loss1 + cav.loss2;
    const enh = portSum / (1 - cav.rr) ** 2;                      // ≈ 2F/π
    const asdLq = Pc.map((P) => kF * Math.sqrt(2 * h * cav.nu * P * enh));
    const asdLrin = Pc.map((P) => kF * P * (p.rin || 0));
    return {
      Pc, dL, dnu, asdLq, asdLrin, chi1, chi2, chiSpacer, enh, kF,
      asdYq: asdLq.map((a) => a / cav.input.L),
      asdYrin: asdLrin.map((a) => a / cav.input.L),
      dnuPerWatt: (-cav.nu * kF * cav.circGain) / cav.input.L,
    };
  }

  /* ------------------------------------------------------------------ */
  /* 8. Pound–Drever–Hall [Black 2001]                                   */
  /* ------------------------------------------------------------------ */
  /** Complex reflection coefficient F(Δf) = (−r1 + r2(R1+T1)e^{iφ}) / (1 − r1 r2 e^{iφ}). */
  function makeReflection(cav) {
    const { r1, r2, R1, T1, FSR } = cav;
    const a = r2 * (R1 + T1), rr = r1 * r2;
    const k = (2 * PI) / FSR;
    return function F(df) {
      const ph = k * df;
      const cr = Math.cos(ph), sr = Math.sin(ph);
      const nr = -r1 + a * cr, ni = a * sr;
      const dr = 1 - rr * cr, di = -rr * sr;
      const d2 = dr * dr + di * di;
      return [(nr * dr + ni * di) / d2, (ni * dr - nr * di) / d2];
    };
  }
  // Im[A · conj(B)]
  const imAconjB = (A, B) => A[1] * B[0] - A[0] * B[1];

  /**
   * Fast-modulation PDH error signal (Q quadrature), including the beat of the
   * first- and second-order sidebands:
   *   ε = 2√(Pc Ps) Im[F(ω)F*(ω+Ω) − F*(ω)F(ω−Ω)]
   *     + 2√(Ps Ps2) Im[F(ω+Ω)F*(ω+2Ω) − F*(ω−Ω)F(ω−2Ω)]
   */
  function makePdh(cav, pdh) {
    const F = makeReflection(cav);
    const fm = pdh.fm, Pc = pdh.Pc, Ps = pdh.Ps, Ps2 = pdh.Ps2 || 0;
    const k1 = 2 * Math.sqrt(Pc * Ps), k2 = 2 * Math.sqrt(Ps * Ps2);
    function error(df) {
      const F0 = F(df), Fp = F(df + fm), Fm = F(df - fm);
      // Im[F0·conj(Fp)] − Im[conj(F0)·Fm]
      let e = k1 * (imAconjB(F0, Fp) - imAconjB([F0[0], -F0[1]], [Fm[0], -Fm[1]]));
      if (k2 > 0) {
        const Fpp = F(df + 2 * fm), Fmm = F(df - 2 * fm);
        e += k2 * (imAconjB(Fp, Fpp) - imAconjB([Fm[0], -Fm[1]], [Fmm[0], -Fmm[1]]));
      }
      return e;
    }
    function reflected(df) {
      const sq = (z) => z[0] * z[0] + z[1] * z[1];
      let P = Pc * sq(F(df)) + Ps * (sq(F(df + fm)) + sq(F(df - fm)));
      if (Ps2 > 0) P += Ps2 * (sq(F(df + 2 * fm)) + sq(F(df - 2 * fm)));
      return P;
    }
    const hstep = cav.fwhm * 1e-4;
    const slope = (error(hstep) - error(-hstep)) / (2 * hstep); // W/Hz at resonance
    return { F, error, reflected, slope };
  }

  /** Modulation depth β from the sideband/carrier power ratio J1²/J0². */
  function modulationDepth(ratio) {
    if (!(ratio > 0)) return 0;
    let lo = 0, hi = 2.404; // first zero of J0
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      const r = (besselJ(1, mid) / besselJ(0, mid)) ** 2;
      if (r < ratio) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  }

  /** Discrete PID (Tustin integrator with clamping, band-limited derivative on measurement). */
  function makePid(o) {
    const st = { integ: 0, prevErr: 0, diff: 0, prevMeas: 0, out: 0 };
    return {
      st,
      update(setpoint, meas) {
        const err = setpoint - meas;
        const P = o.Kp * err;
        st.integ += 0.5 * o.Ki * o.T * (err + st.prevErr);
        // dynamic integrator clamp: integrator alone may not exceed limits
        if (st.integ > o.limMax) st.integ = o.limMax;
        else if (st.integ < o.limMin) st.integ = o.limMin;
        // Bilinear transform of Kd·s/(τs+1) applied to −measurement. Note the
        // sign of the memory term: the template used by the MATLAB code had
        // −(2τ−T)·d[k−1], which places the filter pole at z<0 (Nyquist ringing).
        st.diff = (-2 * o.Kd * (meas - st.prevMeas) + (2 * o.tau - o.T) * st.diff) / (2 * o.tau + o.T);
        let out = P + st.integ + st.diff;
        if (out > o.limMax) out = o.limMax; else if (out < o.limMin) out = o.limMin;
        st.prevErr = err; st.prevMeas = meas; st.out = out;
        return out;
      },
    };
  }

  /** Ornstein–Uhlenbeck sequence (stationary std sigma, correlation time tau). */
  function ouNoise(rng, n, dt, sigma, tau) {
    const out = new Float64Array(n);
    if (!(sigma > 0)) return out;
    const a = Math.exp(-dt / tau), b = sigma * Math.sqrt(1 - a * a);
    let x = sigma * rng.normal();
    for (let i = 0; i < n; i++) { out[i] = x; x = a * x + b * rng.normal(); }
    return out;
  }

  /**
   * Time-domain PDH lock simulation (quasi-static error signal, cavity pole
   * at the half linewidth, fast current loop + optional slow piezo offload).
   */
  function simulateLock(cav, pdhCfg, sim) {
    const pdh = makePdh(cav, pdhCfg);
    const n = Math.max(1000, Math.floor(sim.duration / sim.dt));
    const dt = sim.dt;
    const rng = makeRng(sim.seed);
    const drift = ouNoise(rng, n, dt, sim.driftRms, sim.driftTau);
    const jitter = ouNoise(rng, n, dt, sim.jitterRms, sim.jitterTau);
    const free = new Float64Array(n);
    for (let i = 0; i < n; i++) free[i] = sim.offset + drift[i] + jitter[i];

    const Gpd = sim.Gpd;                    // V/W
    const polarity = pdh.slope < 0 ? 1 : -1; // choose negative feedback automatically
    const pid1 = makePid({ ...sim.pid1, T: dt });
    const pid2 = makePid({ ...sim.pid2, T: dt });
    const aPole = Math.exp(-dt * 2 * PI * cav.hwhm);          // cavity pole
    const aPz = Math.exp(-dt * 2 * PI * sim.piezoBandwidth);  // piezo response

    const err = new Float64Array(n), fErr = new Float64Array(n);
    const xFast = new Float64Array(n), xSlow = new Float64Array(n);
    const u1s = new Float64Array(n), u2s = new Float64Array(n);
    let fEff = free[0], xf = 0, xs = 0, xsCmd = 0, u1 = 0, u2 = 0;
    const iOn = Math.floor(sim.tOn / dt);
    for (let i = 0; i < n; i++) {
      const fe = free[i] + xf + xs;                     // laser detuning from resonance
      fEff = aPole * fEff + (1 - aPole) * fe;           // cavity low-pass
      const e = pdh.error(fEff) * Gpd;                  // volts
      fErr[i] = fe; err[i] = e;
      if (i >= iOn) {
        u1 = pid1.update(0, polarity * e);
        if (sim.slowEnabled) u2 = pid2.update(0, -u1);  // offload the fast actuator
      }
      u1s[i] = u1; u2s[i] = u2;
      xf = -sim.Kact1 * u1;                             // Hz
      xsCmd = -sim.Kact2 * u2;
      xs = aPz * xs + (1 - aPz) * xsCmd;
      xFast[i] = xf; xSlow[i] = xs;
    }
    // --- metrics
    const t = (i) => i * dt;
    const half = cav.fwhm / 2;
    let acq = null;
    const holdN = Math.max(1, Math.floor(sim.holdTime / dt));
    for (let i = iOn, run = 0; i < n; i++) {
      if (Math.abs(fErr[i]) < half) { run++; if (run >= holdN) { acq = t(i - holdN + 1) - sim.tOn; break; } }
      else run = 0;
    }
    const winStart = Math.max(iOn, Math.floor(n - (n - iOn) / 2));
    const stats = (arr, a, b) => {
      let m = 0; for (let i = a; i < b; i++) m += arr[i]; m /= (b - a);
      let v = 0; for (let i = a; i < b; i++) v += (arr[i] - m) ** 2;
      return { mean: m, rms: Math.sqrt(v / (b - a)), rmsAbs: Math.sqrt(arr.slice(a, b).reduce((s, x) => s + x * x, 0) / (b - a)) };
    };
    const lockedStats = stats(fErr, winStart, n);
    const freeStats = stats(free, winStart, n);
    let maxAbs = 0, inside = 0;
    for (let i = winStart; i < n; i++) {
      const a = Math.abs(fErr[i]);
      if (a > maxAbs) maxAbs = a;
      if (a < half) inside++;
    }
    const inFrac = inside / Math.max(1, n - winStart);
    const locked = acq !== null && inFrac >= 0.99;
    return {
      n, dt, iOn, free, fErr, err, xFast, xSlow, u1: u1s, u2: u2s,
      slope: pdh.slope, slopeV: pdh.slope * Gpd, polarity,
      acquisition: acq, locked, inFrac, maxAbs, lockedStats, freeStats,
      suppression: freeStats.rms / Math.max(lockedStats.rmsAbs, 1e-300),
    };
  }

  /**
   * Open-loop analysis of the fast loop (static PDH discriminator, cavity
   * pole, one-sample delay, discrete PID). Returns UGF and phase margin.
   */
  function loopAnalysis(cav, slopeVperHz, Kact, pid, dt) {
    const fmax = 0.5 / dt;
    const fs = logspace(1, fmax * 0.999, 600);
    const plant = Math.abs(slopeVperHz) * Kact;     // Hz/Hz (dimensionless)
    const mag = [], phase = [];
    let ugf = null, pm = null;
    for (const f of fs) {
      const w = 2 * PI * f * dt;
      const z = [Math.cos(w), Math.sin(w)];        // e^{iωT}
      const zi = [Math.cos(w), -Math.sin(w)];      // z^{-1}
      // PID(z) = Kp + Ki T/2 (1+z^-1)/(1-z^-1) + Kd 2(1-z^-1)/((2τ+T)-(2τ-T) z^-1)
      const cdiv = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
      const I = cdiv([1 + zi[0], zi[1]], [1 - zi[0], -zi[1]]).map((v) => (v * pid.Ki * dt) / 2);
      const D = cdiv([2 * (1 - zi[0]), -2 * zi[1]], [(2 * pid.tau + dt) - (2 * pid.tau - dt) * zi[0], -(2 * pid.tau - dt) * zi[1]]).map((v) => v * pid.Kd);
      let C = [pid.Kp + I[0] + D[0], I[1] + D[1]];
      // cavity pole and one-sample delay
      const pole = cdiv([1, 0], [1, f / cav.hwhm]);
      const mul = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
      let Lg = mul(mul(C, pole), zi).map((v) => v * plant);
      const m = Math.hypot(Lg[0], Lg[1]);
      const ph = (Math.atan2(Lg[1], Lg[0]) * 180) / PI;
      mag.push(m); phase.push(ph);
      if (ugf === null && mag.length > 1 && mag[mag.length - 2] >= 1 && m < 1) {
        ugf = f; pm = 180 + ph; if (pm > 180) pm -= 360;
      }
      void z;
    }
    return { f: fs, mag, phase, ugf, phaseMargin: pm, plantGain: plant };
  }

  /* ------------------------------------------------------------------ */
  /* 9. Spectral estimation                                              */
  /* ------------------------------------------------------------------ */
  function fft(re, im) { // in-place radix-2
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < len / 2; k++) {
          const a = i + k, b = a + len / 2;
          const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
        }
      }
    }
  }
  /** One-sided PSD by Welch's method (Hann window, 50 % overlap). */
  function welch(x, dt, seg = 4096) {
    let M = 1; while (M * 2 <= Math.min(seg, x.length)) M *= 2;
    const win = new Float64Array(M);
    let wss = 0;
    for (let i = 0; i < M; i++) { win[i] = 0.5 - 0.5 * Math.cos((2 * PI * i) / M); wss += win[i] ** 2; }
    const psd = new Float64Array(M / 2 + 1);
    let count = 0;
    for (let s = 0; s + M <= x.length; s += M / 2) {
      let mean = 0; for (let i = 0; i < M; i++) mean += x[s + i]; mean /= M;
      const re = new Float64Array(M), im = new Float64Array(M);
      for (let i = 0; i < M; i++) re[i] = (x[s + i] - mean) * win[i];
      fft(re, im);
      for (let k = 0; k <= M / 2; k++) psd[k] += re[k] * re[k] + im[k] * im[k];
      count++;
    }
    const fsamp = 1 / dt;
    const f = [], P = [];
    for (let k = 1; k <= M / 2; k++) {
      const scale = (k === M / 2 ? 1 : 2) / (fsamp * wss * count);
      f.push((k * fsamp) / M); P.push(psd[k] * scale);
    }
    return { f, P };
  }

  /** Min/max decimation for plotting long traces (keeps extrema). */
  function decimate(t, y, maxPts = 4000) {
    const n = y.length;
    if (n <= maxPts) return { t: Array.from(t), y: Array.from(y) };
    const bins = Math.floor(maxPts / 2), size = n / bins;
    const to = [], yo = [];
    for (let b = 0; b < bins; b++) {
      const a = Math.floor(b * size), e = Math.min(n, Math.floor((b + 1) * size));
      let iMin = a, iMax = a;
      for (let i = a; i < e; i++) { if (y[i] < y[iMin]) iMin = i; if (y[i] > y[iMax]) iMax = i; }
      const [i1, i2] = iMin < iMax ? [iMin, iMax] : [iMax, iMin];
      to.push(t[i1], t[i2]); yo.push(y[i1], y[i2]);
    }
    return { t: to, y: yo };
  }

  return {
    CONST, T20, MATERIALS, GASES, REFERENCE_CAVITIES, GEOMETRY_PRESETS,
    linspace, logspace, makeRng, besselJ, isNum,
    cavity, beamProfile, airy, featureGrid,
    stableLengthIntervals, lengthSweep, gSensitivity,
    homSpectrum, homVsG, homVsLength, hermite, hgIntensity, clipLoss,
    thermalNoise, ctePoly, cteModel,
    radConductance, shieldNetwork, simulateNetwork, networkResponse, networkEigenvalues, expm,
    gasRefractivity, halfSpaceCompliance, radiationPressure,
    makeReflection, makePdh, modulationDepth, makePid, ouNoise, simulateLock, loopAnalysis,
    fft, welch, decimate,
  };
});
