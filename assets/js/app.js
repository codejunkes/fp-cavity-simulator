/*
 * Fabry–Pérot Cavity Simulator — user interface
 * Parameters (UI units) live in S.p; physics runs in SI via FPPhysics.
 */
(function () {
  'use strict';
  const P = window.FPPhysics;
  const Plots = window.FPPlots;
  const Hero = window.FPHero;
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const byId = (id) => document.getElementById(id);
  const PI = Math.PI;
  const K0 = 273.15;

  /* ================================================================ formatting */
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const minus = (s) => s.replace(/-/g, '−');
  const trim0 = (s) => (s.includes('.') && !s.includes('e') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
  const special = (x) => (x === Infinity ? '∞' : x === -Infinity ? '−∞' : '—');
  function sci(x, n = 3) {
    if (!Number.isFinite(x)) return special(x);
    if (x === 0) return '0';
    let e = Math.floor(Math.log10(Math.abs(x)));
    let m = trim0((x / 10 ** e).toFixed(n - 1));
    if (Math.abs(parseFloat(m)) >= 10) { e += 1; m = trim0((x / 10 ** e).toFixed(n - 1)); }
    const es = String(e).split('').map((ch) => SUP[ch] || ch).join('');
    return minus(`${m} × 10${es}`);
  }
  function sig(x, n = 4) {
    if (!Number.isFinite(x)) return special(x);
    if (x === 0) return '0';
    const a = Math.abs(x);
    if (a >= 1e-3 && a < 1e6) {
      const d = Math.max(0, n - 1 - Math.floor(Math.log10(a)));
      return minus(trim0(x.toFixed(Math.min(d, 12))));
    }
    return sci(x, n);
  }
  const PREF = [[1e12, 'T'], [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'], [1e-15, 'f']];
  function si(x, unit, n = 4) {
    if (!Number.isFinite(x)) return special(x);
    if (x === 0) return `0 ${unit}`;
    const a = Math.abs(x);
    if (a >= 1e15 || a < 0.99995e-15) return `${sci(x, n)} ${unit}`;
    for (const [f, p] of PREF) if (a >= f * 0.99995) return `${sig(x / f, n)} ${p}${unit}`;
    return `${sci(x, n)} ${unit}`;
  }
  const pct = (x) => (x >= 1e-3 ? `${sig(x * 100, 4)} %` : x > 0 ? `${sig(x * 1e6, 4)} ppm` : '0');
  function fmtDuration(s) {
    if (!Number.isFinite(s)) return 'no heat path';
    if (s >= 2 * 86400) return `${sig(s / 86400, 3)} d`;
    if (s >= 2 * 3600) return `${sig(s / 3600, 3)} h`;
    if (s >= 120) return `${sig(s / 60, 3)} min`;
    return si(s, 's', 3);
  }
  const fUnit = (x) => { const a = Math.abs(x); return a >= 1e9 ? { k: 1e9, u: 'GHz' } : a >= 1e6 ? { k: 1e6, u: 'MHz' } : a >= 1e3 ? { k: 1e3, u: 'kHz' } : { k: 1, u: 'Hz' }; };
  const lUnit = (x) => { const a = Math.abs(x); return a >= 1 ? { k: 1, u: 'm' } : a >= 1e-3 ? { k: 1e-3, u: 'mm' } : a >= 1e-6 ? { k: 1e-6, u: 'µm' } : { k: 1e-9, u: 'nm' }; };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function rgba(c, a) {
    c = String(c).trim();
    let m = /^#([0-9a-f]{6})$/i.exec(c);
    if (m) { const v = parseInt(m[1], 16); return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`; }
    m = /^rgba?\(([^)]+)\)$/i.exec(c);
    if (m) { const p = m[1].split(',').slice(0, 3).map((s) => s.trim()); return `rgba(${p.join(', ')}, ${a})`; }
    return c;
  }

  /* ================================================================ schema */
  const MAT_KEYS = Object.keys(P.MATERIALS);
  const SHORT = { ule: 'ULE', fs: 'Fused silica', zerodur: 'Zerodur', clearceram: 'Clearceram', sapphire: 'Sapphire' };
  const matOptions = MAT_KEYS.map((k) => [k, P.MATERIALS[k].name]);
  const gasOptions = Object.keys(P.GASES).map((k) => [k, P.GASES[k].name]).concat([['custom', 'Other (enter the polarisability)']]);

  const F = (key, group, label, unit, def, o = {}) => Object.assign({ key, group, label, unit, def }, o);
  const pos = { min: 0, exMin: true };
  const nonneg = { min: 0 };
  const emis = { min: 0, max: 1, exMin: true, help: 'Thermal-infrared emissivity between 0 and 1.' };
  const isZero = (pre) => (p) => p[pre + 'CteModel'] === 'zero';
  const isLin = (pre) => (p) => p[pre + 'CteModel'] === 'linear';
  const rocHelp = 'Positive for a mirror concave towards the cavity, negative for convex. Type inf for a flat mirror.';
  const modelOpts = [['zero', 'Zero-crossing glass'], ['linear', 'Linear around 20 °C']];

  const FIELDS = [
    F('L', 'geometry', 'Cavity length', 'mm', 95.5, { sym: 'L', ...pos, help: 'Mirror-to-mirror distance on the optical axis.' }),
    F('roc1', 'geometry', 'Mirror 1 radius of curvature', 'mm', 50, { sym: 'R₁', allowInf: true, nonzero: true, help: rocHelp }),
    F('roc2', 'geometry', 'Mirror 2 radius of curvature', 'mm', 50, { sym: 'R₂', allowInf: true, nonzero: true, help: rocHelp }),
    F('R1', 'mirrors', 'Mirror 1 reflectivity', '', 0.9972, { sym: 'ℛ₁', min: 0, max: 1, exMin: true, exMax: true, step: 'refl', help: 'Power reflectivity. Transmission is 1 − ℛ − loss.' }),
    F('R2', 'mirrors', 'Mirror 2 reflectivity', '', 0.9972, { sym: 'ℛ₂', min: 0, max: 1, exMin: true, exMax: true, step: 'refl', help: 'Power reflectivity. Transmission is 1 − ℛ − loss.' }),
    F('loss1', 'mirrors', 'Mirror 1 loss', 'ppm', 0, { ...nonneg, help: 'Absorption plus scatter.' }),
    F('loss2', 'mirrors', 'Mirror 2 loss', 'ppm', 0, { ...nonneg, help: 'Absorption plus scatter.' }),
    F('Rm', 'mirrors', 'Mirror substrate radius', 'mm', 12.7, { ...pos, help: 'Aperture for clipping and lever arm for thermal expansion; 12.7 mm is a 1-inch optic.' }),
    F('lambda', 'light', 'Wavelength in vacuum', 'nm', 1550, { sym: 'λ', min: 150, max: 20000 }),
    F('n', 'light', 'Refractive index between the mirrors', '', 1, { sym: 'n', min: 1, max: 4, help: '1 for an evacuated cavity.' }),
    F('Rsp', 'spacer', 'Outer radius', 'mm', 50, { ...pos }),
    F('rbore', 'spacer', 'Bore radius', 'mm', 7.5, { ...pos, help: 'Radius of the central hole the beam passes through.' }),
    F('T', 'spacer', 'Cavity temperature', 'K', 300, { ...pos, help: 'Used for thermal noise and the residual-gas density.' }),
    F('spacerMat', 'mat-spacer', 'Material', '', 'ule', { type: 'select', options: matOptions }),
    F('spE', 'mat-spacer', "Young's modulus", 'GPa', 67.6, { sym: 'E', ...pos }),
    F('spSigma', 'mat-spacer', "Poisson's ratio", '', 0.17, { sym: 'σ', min: -1, max: 0.5, exMin: true, exMax: true }),
    F('spQ', 'mat-spacer', 'Mechanical quality factor', '', 62500, { sym: 'Q = 1/φ', ...pos }),
    F('mirrorMat', 'mat-mirror', 'Material', '', 'fs', { type: 'select', options: matOptions }),
    F('mrE', 'mat-mirror', "Young's modulus", 'GPa', 73.1, { sym: 'E', ...pos }),
    F('mrSigma', 'mat-mirror', "Poisson's ratio", '', 0.17, { sym: 'σ', min: -1, max: 0.5, exMin: true, exMax: true }),
    F('mrQ', 'mat-mirror', 'Mechanical quality factor', '', 1e6, { sym: 'Q = 1/φ', ...pos }),
    F('coatQ', 'coating', 'Mechanical quality factor', '', 2500, { sym: 'Q = 1/φ', ...pos, help: 'Ta₂O₅/SiO₂ stacks have φ ≈ 4 × 10⁻⁴, i.e. Q ≈ 2500.' }),
    F('coatD', 'coating', 'Total thickness', 'µm', 5.24, { sym: 'd', ...pos }),

    F('cavScale', 'cav-ctrl', 'Vertical scale of the Airy plots', '', 'log', { type: 'select', options: [['lin', 'Linear'], ['log', 'Logarithmic']] }),

    F('homNmax', 'hom', 'Highest order N = m + n', '', 10, { int: true, min: 1, max: 60, step: 'add' }),
    F('homM', 'hom-pattern', 'Index m (horizontal)', '', 0, { int: true, min: 0, max: 20, step: 'add' }),
    F('homN', 'hom-pattern', 'Index n (vertical)', '', 1, { int: true, min: 0, max: 20, step: 'add' }),
    F('homPlane', 'hom-pattern', 'Shown at', '', 'waist', { type: 'select', options: [['waist', 'Beam waist'], ['m1', 'Mirror 1'], ['m2', 'Mirror 2']] }),
    F('homSweepN', 'hom-sweep', 'Mode order to follow', '', 4, { int: true, min: 1, max: 60, step: 'add' }),
    F('homSweepRange', 'hom-sweep', 'Scan the length by', '± mm', 25, { ...pos }),

    F('fMin', 'noise', 'Lowest Fourier frequency', 'Hz', 0.01, { ...pos }),
    F('fMax', 'noise', 'Highest Fourier frequency', 'Hz', 100, { ...pos }),
    F('noiseView', 'noise', 'Show noise as', '', 'y', { type: 'select', options: [['y', 'Fractional frequency, 1/√Hz'], ['nu', 'Frequency, Hz/√Hz'], ['x', 'Length, m/√Hz']] }),
    F('lenMin', 'noise', 'Length scan from', 'mm', 20, { ...pos }),
    F('lenMax', 'noise', 'Length scan to', 'mm', 500, { ...pos }),

    F('spCteModel', 'cte-spacer', 'Model', '', 'zero', { type: 'select', options: modelOpts }),
    F('spT0', 'cte-spacer', 'Zero-crossing temperature', '°C', 29.82, { sym: 'T₀', min: -K0, exMin: true, when: isZero('sp') }),
    F('spA', 'cte-spacer', 'Linear coefficient', '10⁻⁹/K²', 2.4, { sym: 'a', when: isZero('sp'), help: 'Typically 1.8 to 2.4 × 10⁻⁹/K² for ULE.' }),
    F('spB', 'cte-spacer', 'Quadratic coefficient', '10⁻¹²/K³', 0, { sym: 'b', when: isZero('sp') }),
    F('spAlpha20', 'cte-spacer', 'CTE at 20 °C', '10⁻⁹/K', 0, { sym: 'α₂₀', when: isLin('sp') }),
    F('spSlope', 'cte-spacer', 'Change of CTE per kelvin', '10⁻⁹/K²', 0, { when: isLin('sp') }),
    F('mrCteModel', 'cte-mirror', 'Model', '', 'linear', { type: 'select', options: modelOpts }),
    F('mrT0', 'cte-mirror', 'Zero-crossing temperature', '°C', 29.82, { sym: 'T₀', min: -K0, exMin: true, when: isZero('mr') }),
    F('mrA', 'cte-mirror', 'Linear coefficient', '10⁻⁹/K²', 2.4, { sym: 'a', when: isZero('mr') }),
    F('mrB', 'cte-mirror', 'Quadratic coefficient', '10⁻¹²/K³', 0, { sym: 'b', when: isZero('mr') }),
    F('mrAlpha20', 'cte-mirror', 'CTE at 20 °C', '10⁻⁹/K', 500, { sym: 'α₂₀', when: isLin('mr') }),
    F('mrSlope', 'cte-mirror', 'Change of CTE per kelvin', '10⁻⁹/K²', 2.2, { when: isLin('mr') }),
    F('delta', 'cte-general', 'Mirror–spacer coupling', '', 0.48, { sym: 'δ', min: -1, max: 1, help: 'About 0.37 for a 32 mm spacer diameter, approaching 0.49 for wide spacers, close to 0 with ULE rings on the mirror backs (Legero et al. 2010).' }),
    F('Top', 'cte-general', 'Operating temperature', '°C', 20, { min: -K0, exMin: true, help: 'Used for dν/dT and the material comparison.' }),
    F('cteSpan', 'cte-general', 'Temperature range shown', '± K', 20, { ...pos }),

    F('shPreset', 'sh-main', 'Shield geometry', '', 'cuboid', { type: 'select', options: [['cuboid', 'IUCAA boxes (cuboid shields)'], ['cylinder', 'IUCAA cylinders'], ['custom', 'Custom values']] }),
    F('useRad', 'sh-main', 'Radiation between shields', '', true, { type: 'check' }),
    F('useCond', 'sh-main', 'Conduction through supports', '', true, { type: 'check' }),
    F('incCav', 'sh-main', 'Include the cavity as the innermost mass', '', true, { type: 'check' }),
    F('Ti', 'sh-step', 'Temperature before the step', 'K', 293.2, { ...pos }),
    F('Tf', 'sh-step', 'Set-point after the step', 'K', 294.2, { ...pos }),
    F('Tavg', 'sh-sin', 'Mean temperature of P1', 'K', 293, { ...pos }),
    F('sinAmp', 'sh-sin', 'Amplitude', 'K', 1, { ...pos }),
    F('sinPeriod', 'sh-sin', 'Period', 'h', 50, { ...pos }),
    F('cavOffset', 'sh-sin', 'Cavity offset from its zero crossing', 'mK', 20, { help: 'Operating point relative to the effective zero-crossing temperature in the thermal-expansion tab.' }),
    F('A1in', 'sh-geom', 'P1 inner surface', 'm²', 0.6768, { ...pos }),
    F('e1in', 'sh-geom', 'P1 inner emissivity', '', 0.04, emis),
    F('A2out', 'sh-geom', 'P2 outer surface', 'm²', 0.568, { ...pos }),
    F('e2out', 'sh-geom', 'P2 outer emissivity', '', 0.04, emis),
    F('A2in', 'sh-geom', 'P2 inner surface', 'm²', 0.49, { ...pos }),
    F('e2in', 'sh-geom', 'P2 inner emissivity', '', 0.04, emis),
    F('m2', 'sh-geom', 'P2 mass', 'kg', 14.27, { ...pos }),
    F('c2', 'sh-geom', 'P2 specific heat', 'J/(kg·K)', 900, { ...pos }),
    F('A3out', 'sh-geom', 'P3 outer surface', 'm²', 0.396, { ...pos }),
    F('e3out', 'sh-geom', 'P3 outer emissivity', '', 0.04, emis),
    F('A3in', 'sh-geom', 'P3 inner surface', 'm²', 0.3292, { ...pos }),
    F('e3in', 'sh-geom', 'P3 inner emissivity', '', 0.04, emis),
    F('m3', 'sh-geom', 'P3 mass', 'kg', 9.78, { ...pos }),
    F('c3', 'sh-geom', 'P3 specific heat', 'J/(kg·K)', 900, { ...pos }),
    F('ecav', 'sh-geom', 'Cavity emissivity', '', 0.9, emis),
    F('n12', 'sh-cond', 'P1 → P2 supports', '', 1, { int: true, min: 0, step: 'add' }),
    F('k12', 'sh-cond', 'P1 → P2 conductivity', 'W/(m·K)', 0.19, { ...pos }),
    F('a12', 'sh-cond', 'P1 → P2 area of each', 'mm²', 78.5, { ...pos }),
    F('l12', 'sh-cond', 'P1 → P2 path length', 'mm', 10, { ...pos }),
    F('n23', 'sh-cond', 'P2 → P3 supports', '', 1, { int: true, min: 0, step: 'add' }),
    F('k23', 'sh-cond', 'P2 → P3 conductivity', 'W/(m·K)', 0.19, { ...pos }),
    F('a23', 'sh-cond', 'P2 → P3 area of each', 'mm²', 78.5, { ...pos }),
    F('l23', 'sh-cond', 'P2 → P3 path length', 'mm', 10, { ...pos }),
    F('n3c', 'sh-cond', 'P3 → cavity supports', '', 4, { int: true, min: 0, step: 'add' }),
    F('k3c', 'sh-cond', 'P3 → cavity conductivity', 'W/(m·K)', 0.25, { ...pos }),
    F('a3c', 'sh-cond', 'P3 → cavity area of each', 'mm²', 19.6, { ...pos }),
    F('l3c', 'sh-cond', 'P3 → cavity path length', 'mm', 5, { ...pos }),

    F('gas', 'gas', 'Gas', '', 'H2', { type: 'select', options: gasOptions }),
    F('gasAlpha', 'gas', 'Polarisability volume', 'Å³', 0.8045, { sym: 'α′', ...pos }),
    F('pMin', 'gas', 'Pressure change from', 'mbar', 1e-11, { ...pos }),
    F('pMax', 'gas', 'Pressure change to', 'mbar', 1e-6, { ...pos }),
    F('targetY', 'gas', 'Target fractional stability', '', 1e-16, { ...pos }),
    F('PinMin', 'rp', 'Input power from', 'W', 1e-9, { ...pos }),
    F('PinMax', 'rp', 'Input power to', 'W', 1e-2, { ...pos }),
    F('rin', 'rp', 'Laser intensity noise', '1/√Hz', 1e-6, { ...nonneg, help: 'Relative intensity noise at the Fourier frequencies of interest.' }),

    F('fm', 'pdh-mod', 'Modulation frequency', 'MHz', 35.15, { sym: 'Ω/2π', ...pos }),
    F('Pc', 'pdh-mod', 'Carrier power', 'mW', 16, { sym: 'P<sub>c</sub>', ...pos }),
    F('Ps', 'pdh-mod', 'Each first-order sideband', 'mW', 0.72, { sym: 'P<sub>s</sub>', ...pos }),
    F('Ps2', 'pdh-mod', 'Each second-order sideband', 'µW', 5, { sym: 'P<sub>s2</sub>', ...nonneg }),
    F('Gpd', 'pdh-mod', 'Detector and mixer gain', 'V/W', 1000, { ...pos, help: 'Converts demodulated optical power into volts at the controller input.' }),
    F('kp1', 'pdh-fast', 'Proportional gain', '', 0.01, { sym: 'K<sub>p</sub>', ...nonneg }),
    F('ki1', 'pdh-fast', 'Integral gain', '1/s', 3e4, { sym: 'K<sub>i</sub>', ...nonneg }),
    F('kd1', 'pdh-fast', 'Derivative gain', 's', 0, { sym: 'K<sub>d</sub>', ...nonneg }),
    F('tau1', 'pdh-fast', 'Derivative filter time', 'µs', 1, { sym: 'τ', ...pos }),
    F('act1', 'pdh-fast', 'Current tuning coefficient', 'MHz/V', 1, { ...pos }),
    F('lim1', 'pdh-fast', 'Output limit', '± V', 10, { ...pos }),
    F('slowOn', 'pdh-slow', 'Use the piezo loop', '', true, { type: 'check' }),
    F('kp2', 'pdh-slow', 'Proportional gain', '', 0, { sym: 'K<sub>p</sub>', ...nonneg }),
    F('ki2', 'pdh-slow', 'Integral gain', '1/s', 200, { sym: 'K<sub>i</sub>', ...nonneg }),
    F('kd2', 'pdh-slow', 'Derivative gain', 's', 0, { sym: 'K<sub>d</sub>', ...nonneg }),
    F('act2', 'pdh-slow', 'Piezo tuning coefficient', 'MHz/V', 1, { ...pos }),
    F('pzBw', 'pdh-slow', 'Piezo bandwidth', 'kHz', 2, { ...pos }),
    F('lim2', 'pdh-slow', 'Output limit', '± V', 1000, { ...pos }),
    F('dt', 'pdh-sim', 'Time step', 'µs', 0.5, { ...pos }),
    F('dur', 'pdh-sim', 'Duration', 'ms', 50, { ...pos }),
    F('tOn', 'pdh-sim', 'Engage the lock at', 'ms', 5, { ...nonneg }),
    F('off', 'pdh-noise', 'Initial offset', 'kHz', 300),
    F('driftRms', 'pdh-noise', 'Slow drift, rms', 'kHz', 600, { ...nonneg }),
    F('driftTau', 'pdh-noise', 'Drift correlation time', 'ms', 20, { ...pos }),
    F('jitRms', 'pdh-noise', 'Fast jitter, rms', 'kHz', 20, { ...nonneg }),
    F('jitTau', 'pdh-noise', 'Jitter correlation time', 'µs', 5, { ...pos }),
    F('seed', 'pdh-noise', 'Random seed', '', 1, { int: true, min: 1, step: 'add' }),
  ];
  const FMAP = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
  const SHIELD_KEYS = new Set(['A1in', 'e1in', 'A2out', 'e2out', 'A2in', 'e2in', 'm2', 'c2', 'A3out', 'e3out', 'A3in', 'e3in', 'm3', 'c3']);

  const box = (a, b, c) => 2 * (a * b + b * c + a * c);
  const cyl = (d, h) => 2 * PI * (d / 2) * (d / 2 + h);
  const r4 = (x) => +x.toFixed(4);
  const SHIELD_PRESETS = {
    cuboid: {
      A1in: r4(box(0.63, 0.23, 0.225)), e1in: 0.04, A2out: r4(box(0.6, 0.2, 0.205)), e2out: 0.04,
      A2in: r4(box(0.58, 0.18, 0.185)), e2in: 0.04, m2: 14.27, c2: 900,
      A3out: r4(box(0.55, 0.15, 0.165)), e3out: 0.04, A3in: r4(box(0.53, 0.13, 0.145)), e3in: 0.04, m3: 9.78, c3: 900,
    },
    cylinder: {
      A1in: r4(cyl(0.23, 0.65)), e1in: 0.2, A2out: r4(cyl(0.205, 0.6)), e2out: 0.2,
      A2in: r4(cyl(0.185, 0.6)), e2in: 0.2, m2: 9.9252, c2: 900,
      A3out: r4(cyl(0.165, 0.55)), e3out: 0.2, A3in: r4(cyl(0.145, 0.53)), e3in: 0.2, m3: 7.23, c3: 900,
    },
  };

  const EXAMPLES = [
    { key: 'iucaa', label: 'IUCAA test cavity (dt.xlsx values)', p: {} },
    {
      key: 'ultrastable', label: '10 cm ULE reference cavity, 1064 nm',
      p: {
        L: 100, roc1: Infinity, roc2: 500, lambda: 1064, R1: 0.99999, R2: 0.99999, loss1: 2, loss2: 2,
        Rsp: 30, rbore: 5, T: 293.15, fm: 20, Pc: 0.05, Ps: 0.002, Ps2: 0.02, Gpd: 10000,
        kp1: 0.1, ki1: 2000, act1: 1, off: 3, driftRms: 10, jitRms: 0.5,
      },
    },
    {
      key: 'long', label: '48.5 cm cavity, 1064 nm (original scripts)',
      p: {
        L: 485, roc1: 1000, roc2: Infinity, lambda: 1064, R1: 0.9999791, R2: 0.9999791, loss1: 15.9, loss2: 15.9,
        fm: 20, Pc: 0.05, Ps: 0.002, Ps2: 0.02, Gpd: 10000, kp1: 3, ki1: 56000, act1: 0.1, off: 2, driftRms: 5, jitRms: 0.3,
      },
    },
  ];

  /* ================================================================ state */
  const STORE = 'fp-sim-params-v1';
  const TABS = ['cavity', 'stability', 'modes', 'noise', 'expansion', 'thermal', 'gasrp', 'pdh', 'notes'];
  const defaults = () => Object.fromEntries(FIELDS.map((f) => [f.key, f.def]));
  const S = { p: defaults(), tab: 'cavity', dirty: new Set(TABS), invalid: new Map(), undo: null };

  function serialise(p, onlyChanged) {
    const d = defaults(), out = {};
    for (const f of FIELDS) {
      const v = p[f.key];
      if (onlyChanged && v === d[f.key]) continue;
      out[f.key] = v === Infinity ? 'inf' : v;
    }
    return out;
  }
  function deserialise(obj) {
    const p = defaults();
    if (!obj || typeof obj !== 'object') return p;
    for (const f of FIELDS) {
      if (!(f.key in obj)) continue;
      let v = obj[f.key];
      if (f.type === 'check') { p[f.key] = !!v; continue; }
      if (f.type === 'select') { if (f.options.some(([k]) => k === v)) p[f.key] = v; continue; }
      if (v === 'inf' || v === '-inf') v = Infinity;
      if (typeof v === 'string') v = Number(v);
      if (typeof v === 'number' && !single(f, v).err) p[f.key] = v;
    }
    return p;
  }
  function readHash() {
    const m = /[#&]p=([A-Za-z0-9_-]+)/.exec(location.hash);
    if (!m) return null;
    try { return JSON.parse(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) { return null; }
  }
  function writeHash() {
    const diff = serialise(S.p, true);
    const enc = Object.keys(diff).length ? '#p=' + btoa(JSON.stringify(diff)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '';
    try { history.replaceState(null, '', location.pathname + location.search + enc); } catch (e) { /* file:// in some browsers */ }
  }
  function persist() {
    try { localStorage.setItem(STORE, JSON.stringify(serialise(S.p, false))); } catch (e) { /* storage unavailable */ }
  }

  /* ================================================================ validation */
  const plain = (x) => minus(String(x));
  function single(f, v) {
    if (f.allowInf && v === Infinity) return { v };
    if (!Number.isFinite(v)) return { err: 'Enter a finite number.' };
    if (f.int && !Number.isInteger(v)) return { err: 'Enter a whole number.' };
    if (f.nonzero && v === 0) return { err: 'Zero is not allowed; type inf for a flat mirror.' };
    if (f.min !== undefined && (f.exMin ? v <= f.min : v < f.min)) return { err: `Must be ${f.exMin ? 'greater than' : 'at least'} ${plain(f.min)}.` };
    if (f.max !== undefined && (f.exMax ? v >= f.max : v > f.max)) return { err: `Must be ${f.exMax ? 'less than' : 'at most'} ${plain(f.max)}.` };
    return { v };
  }
  function parseInput(f, raw) {
    const s = String(raw).trim().replace(/\u2212/g, '-').replace(/\s+/g, '');
    if (s === '') return { err: 'Enter a value.' };
    if (f.allowInf && /^[+-]?(inf|infinity|∞|flat)$/i.test(s)) return { v: Infinity };
    if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) {
      return { err: f.allowInf ? 'Enter a number, or inf for a flat mirror.' : 'Enter a number such as 1.5 or 2e-3.' };
    }
    return single(f, Number(s));
  }
  const pair = (other, below, msg) => (v, p) => ((below ? v >= p[other] : v <= p[other]) ? msg : null);
  function stepsMsg(durMs, dtUs) {
    const n = (durMs * 1e-3) / (dtUs * 1e-6);
    if (n > 400000) return `That is ${Math.round(n).toLocaleString('en')} time steps; keep it under 400 000.`;
    if (n < 2000) return 'Use at least 2000 time steps.';
    return null;
  }
  const sumMsg = 'Reflectivity plus loss must stay below 1.';
  const CROSS = {
    R1: (v, p) => (v + p.loss1 * 1e-6 >= 1 ? sumMsg : null),
    loss1: (v, p) => (p.R1 + v * 1e-6 >= 1 ? sumMsg : null),
    R2: (v, p) => (v + p.loss2 * 1e-6 >= 1 ? sumMsg : null),
    loss2: (v, p) => (p.R2 + v * 1e-6 >= 1 ? sumMsg : null),
    rbore: pair('Rsp', true, 'Must be smaller than the spacer radius.'),
    Rsp: pair('rbore', false, 'Must be larger than the bore radius.'),
    fMin: pair('fMax', true, 'Must be below the highest frequency.'),
    fMax: pair('fMin', false, 'Must be above the lowest frequency.'),
    lenMin: pair('lenMax', true, 'Must be below the end of the scan.'),
    lenMax: pair('lenMin', false, 'Must be above the start of the scan.'),
    pMin: pair('pMax', true, 'Must be below the upper pressure.'),
    pMax: pair('pMin', false, 'Must be above the lower pressure.'),
    PinMin: pair('PinMax', true, 'Must be below the upper power.'),
    PinMax: pair('PinMin', false, 'Must be above the lower power.'),
    tOn: pair('dur', true, 'Must be before the end of the run.'),
    dur: (v, p) => (v <= p.tOn ? 'Must be longer than the time the lock is engaged.' : stepsMsg(v, p.dt)),
    dt: (v, p) => stepsMsg(p.dur, v),
  };

  /* ================================================================ fields UI */
  function fieldEl(f) {
    const wrap = document.createElement('div');
    const id = 'f-' + f.key;
    wrap.dataset.key = f.key;
    const help = f.help ? `<p class="fhelp" id="h-${f.key}">${f.help}</p>` : '';
    if (f.type === 'check') {
      wrap.className = 'field check';
      wrap.innerHTML = `<label for="${id}"><input type="checkbox" id="${id}"><span>${f.label}</span></label>${help}`;
    } else if (f.type === 'select') {
      wrap.className = 'field select';
      const opts = f.options.map(([k, l]) => `<option value="${esc(k)}">${esc(l)}</option>`).join('');
      wrap.innerHTML = `<label for="${id}"><span class="flabel">${f.label}</span></label><select id="${id}">${opts}</select>${help}`;
    } else {
      wrap.className = 'field';
      wrap.innerHTML = `<label for="${id}"><span class="flabel">${f.label}</span>${f.sym ? `<span class="fsym">${f.sym}</span>` : ''}</label>` +
        `<div class="finput"><input id="${id}" type="text" autocomplete="off" spellcheck="false" aria-describedby="e-${f.key}${f.help ? ' h-' + f.key : ''}">` +
        `${f.unit ? `<span class="funit">${f.unit}</span>` : ''}</div>${help}<p class="ferr" id="e-${f.key}" aria-live="polite"></p>`;
    }
    return wrap;
  }
  function buildFields() {
    for (const box of $$('[data-fields]')) {
      const g = box.dataset.fields;
      for (const f of FIELDS) if (f.group === g) box.appendChild(fieldEl(f));
    }
  }
  const fmtInput = (v) => (v === Infinity ? '∞' : String(Number(Number(v).toPrecision(10))));
  function syncInput(key) {
    const f = FMAP[key], el = byId('f-' + key);
    if (!f || !el) return;
    const v = S.p[key];
    if (f.type === 'check') el.checked = !!v;
    else if (f.type === 'select') el.value = v;
    else el.value = fmtInput(v);
  }
  function syncAll() {
    for (const f of FIELDS) { syncInput(f.key); setError(f.key, null); }
    updateVisibility();
  }
  function setError(key, msg) {
    const wrap = document.querySelector(`.field[data-key="${key}"]`);
    const e = byId('e-' + key);
    if (wrap) wrap.classList.toggle('invalid', !!msg);
    if (e) e.textContent = msg || '';
    const input = byId('f-' + key);
    if (input && input.tagName === 'INPUT' && input.type === 'text') input.setAttribute('aria-invalid', msg ? 'true' : 'false');
    if (msg) S.invalid.set(key, msg); else S.invalid.delete(key);
  }
  function updateVisibility() {
    for (const f of FIELDS) {
      if (!f.when) continue;
      const wrap = document.querySelector(`.field[data-key="${f.key}"]`);
      if (wrap) wrap.hidden = !f.when(S.p);
    }
  }
  function tryValue(f, raw) {
    const r = parseInput(f, raw);
    if (r.err) return r;
    const cross = CROSS[f.key] && CROSS[f.key](r.v, S.p);
    return cross ? { err: cross } : r;
  }
  function revalidate() {
    for (const key of [...S.invalid.keys()]) {
      const f = FMAP[key], el = byId('f-' + key);
      if (!f || !el) continue;
      const r = tryValue(f, el.value);
      if (!r.err) { S.p[key] = r.v; setError(key, null); }
    }
  }
  function onFieldChange(f, el) {
    let v;
    if (f.type === 'check') v = el.checked;
    else if (f.type === 'select') v = el.value;
    else {
      const r = tryValue(f, el.value);
      if (r.err) { setError(f.key, r.err); return; }
      v = r.v;
    }
    setError(f.key, null);
    S.p[f.key] = v;
    if (f.key === 'spacerMat') applyMaterial('sp', v);
    if (f.key === 'mirrorMat') applyMaterial('mr', v);
    if (f.key === 'gas' && P.GASES[v]) { S.p.gasAlpha = +(P.GASES[v].alpha * 1e30).toPrecision(6); syncInput('gasAlpha'); setError('gasAlpha', null); }
    if (f.key === 'shPreset' && SHIELD_PRESETS[v]) { Object.assign(S.p, SHIELD_PRESETS[v]); for (const k of SHIELD_KEYS) { syncInput(k); setError(k, null); } }
    if (SHIELD_KEYS.has(f.key) && S.p.shPreset !== 'custom') { S.p.shPreset = 'custom'; syncInput('shPreset'); }
    if (f.key === 'gasAlpha' && S.p.gas !== 'custom') { S.p.gas = 'custom'; syncInput('gas'); }
    if (f.when || /CteModel$/.test(f.key)) updateVisibility();
    revalidate();
    changed();
  }
  function applyMaterial(pre, key) {
    const m = P.MATERIALS[key];
    if (!m) return;
    const c = m.cte;
    const upd = {
      [pre + 'E']: +(m.E / 1e9).toPrecision(6), [pre + 'Sigma']: m.sigma, [pre + 'Q']: Math.round(1 / m.phi),
      [pre + 'CteModel']: c.model,
    };
    if (c.model === 'zero') Object.assign(upd, { [pre + 'T0']: +(c.T0 - K0).toFixed(3), [pre + 'A']: +(c.a * 1e9).toPrecision(6), [pre + 'B']: +((c.b || 0) * 1e12).toPrecision(6) });
    else Object.assign(upd, { [pre + 'Alpha20']: +(c.alpha20 * 1e9).toPrecision(6), [pre + 'Slope']: +((c.slope || 0) * 1e9).toPrecision(6) });
    Object.assign(S.p, upd);
    for (const k of Object.keys(upd)) { syncInput(k); setError(k, null); }
    updateVisibility();
  }
  function stepValue(f, v, dir, big) {
    if (!Number.isFinite(v)) return v;
    if (f.int || f.step === 'add') return v + dir * (big ? 10 : 1);
    const fac = big ? 1.1 : 1.01;
    if (f.step === 'refl') { const q = 1 - v; return 1 - (dir > 0 ? q / fac : q * fac); }
    if (v === 0) return dir * 1e-3;
    return dir > 0 ? v + Math.abs(v) * (fac - 1) : v - Math.abs(v) * (1 - 1 / fac);
  }
  function bindFields() {
    document.addEventListener('input', (e) => {
      const el = e.target;
      if (!el.id || !el.id.startsWith('f-')) return;
      const f = FMAP[el.id.slice(2)];
      if (f && f.type !== 'select' && f.type !== 'check') onFieldChange(f, el);
    });
    document.addEventListener('change', (e) => {
      const el = e.target;
      if (!el.id || !el.id.startsWith('f-')) return;
      const f = FMAP[el.id.slice(2)];
      if (!f) return;
      if (f.type === 'select' || f.type === 'check') onFieldChange(f, el);
      else if (!S.invalid.has(f.key)) syncInput(f.key);
    });
    document.addEventListener('keydown', (e) => {
      const el = e.target;
      if (!el.id || !el.id.startsWith('f-') || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      const f = FMAP[el.id.slice(2)];
      if (!f || f.type) return;
      const cur = parseInput(f, el.value);
      if (cur.err) return;
      e.preventDefault();
      const nv = stepValue(f, cur.v, e.key === 'ArrowUp' ? 1 : -1, e.shiftKey);
      const r = tryValue(f, String(nv));
      if (r.err) return;
      el.value = fmtInput(+nv.toPrecision(10));
      onFieldChange(f, el);
    });
  }

  /* ================================================================ compute */
  const mmToM = (v) => (Number.isFinite(v) ? v * 1e-3 : Infinity);
  function cteOf(pre) {
    const p = S.p;
    return p[pre + 'CteModel'] === 'zero'
      ? { model: 'zero', T0: p[pre + 'T0'] + K0, a: p[pre + 'A'] * 1e-9, b: p[pre + 'B'] * 1e-12 }
      : { model: 'linear', alpha20: p[pre + 'Alpha20'] * 1e-9, slope: p[pre + 'Slope'] * 1e-9 };
  }
  const libMat = (k) => ({ E: P.MATERIALS[k].E, sigma: P.MATERIALS[k].sigma, phi: P.MATERIALS[k].phi });
  function core() {
    const p = S.p;
    S.base = { L: p.L * 1e-3, roc1: mmToM(p.roc1), roc2: mmToM(p.roc2), lambda: p.lambda * 1e-9, n: p.n, R1: p.R1, R2: p.R2, loss1: p.loss1 * 1e-6, loss2: p.loss2 * 1e-6 };
    S.cav = P.cavity(S.base);
    S.tnp = {
      T: p.T, Rsp: p.Rsp * 1e-3, rbore: p.rbore * 1e-3,
      spacer: { E: p.spE * 1e9, sigma: p.spSigma, phi: 1 / p.spQ },
      mirror: { E: p.mrE * 1e9, sigma: p.mrSigma, phi: 1 / p.mrQ },
      coatPhi: 1 / p.coatQ, coatD: p.coatD * 1e-6,
    };
    S.tn1 = P.thermalNoise(S.cav, S.tnp, [1]);
    S.cte = P.cteModel(cteOf('sp'), cteOf('mr'), p.delta, p.Rm * 1e-3, p.L * 1e-3);
  }
  function stabilityWord(c) {
    if (c.stability === 'stable') return { word: 'stable', cls: 'ok' };
    if (c.stability === 'marginal') return { word: 'marginally stable', cls: 'warn' };
    return { word: 'unstable', cls: 'bad' };
  }
  function denseGrid(lo, hi, centres, width, nCoarse = 1200, nFine = 201) {
    const pts = P.linspace(lo, hi, nCoarse);
    for (const c0 of centres) {
      for (const sc of [5, 50, 500]) {
        for (const x of P.linspace(c0 - sc * width, c0 + sc * width, nFine)) if (x >= lo && x <= hi) pts.push(x);
      }
    }
    pts.sort((a, b) => a - b);
    const out = [];
    const tol = (hi - lo) * 1e-12;
    for (const x of pts) if (!out.length || x - out[out.length - 1] > tol) out.push(x);
    return out;
  }

  /* ================================================================ output helpers */
  function results(id, groups) {
    const el = byId(id);
    if (!el) return;
    el.innerHTML = groups.map((g) => `<div class="rgroup"><h3>${g.title}</h3><dl>${g.rows.map((r) =>
      `<div class="row"><dt>${r[0]}</dt><dd${r[2] ? ` class="${r[2]}"` : ''}>${esc(r[1])}</dd></div>`).join('')}</dl></div>`).join('');
  }
  function callout(tab, msgs) {
    const el = byId('cl-' + tab);
    if (!el) return;
    const list = (Array.isArray(msgs) ? msgs : [msgs]).filter(Boolean);
    el.className = 'callout' + (list.some((m) => m.bad) ? ' bad' : '');
    el.innerHTML = list.map((m) => `<p>${esc(m.text || m)}</p>`).join('');
  }
  function plot(id, traces, o = {}) {
    Plots.render(byId(id), traces, { name: 'fp-' + id.replace(/^pl-/, ''), ...o });
  }
  function emptyPlot(id, msg) {
    plot(id, [], { legend: false, x: { extra: { visible: false } }, y: { extra: { visible: false } }, annotations: [{ text: msg, xref: 'paper', yref: 'paper', x: 0.5, y: 0.5 }] });
  }
  const vline = (x, color, dash = 'dash', yref = 'paper') => ({ type: 'line', xref: 'x', yref, x0: x, x1: x, y0: 0, y1: 1, line: { color, width: 1.2, dash } });
  const hline = (y, color, dash = 'dash', yref = 'y') => ({ type: 'line', xref: 'paper', yref, x0: 0, x1: 1, y0: y, y1: y, line: { color, width: 1.2, dash } });
  // log-axis range from just below the transmission floor to above 1, so an exactly
  // impedance-matched reflection dip (R → 0) does not stretch the axis to 1e-20
  const logRange = (arr) => {
    let lo = Infinity, hi = 0;
    for (const v of arr) { if (v > 0 && v < lo) lo = v; if (v > hi) hi = v; }
    return [Math.log10(Math.max(1e-14, lo / 4)), Math.log10(Math.max(1.6, hi * 1.6))];
  };
  const clipText = (x) => (x < 1e-100 ? 'negligible (below 10⁻¹⁰⁰)' : sci(x, 2));
  const noModeMsg = (c) => `No Gaussian mode: the cavity is ${stabilityWord(c).word} (g₁g₂ = ${sig(c.g, 4)}).`;

  /* ================================================================ hero */
  function renderHero() {
    const c = S.cav, p = S.p;
    const svg = byId('cavity-svg');
    const width = svg.getBoundingClientRect().width || svg.parentElement.clientWidth || 1000;
    const note = byId('hero-note');
    Hero.draw(svg, {
      cav: c, L: p.L * 1e-3, roc1: S.base.roc1, roc2: S.base.roc2, Rm: p.Rm * 1e-3, Rsp: p.Rsp * 1e-3,
      rbore: p.rbore * 1e-3, lambdaNm: p.lambda, width,
      fmt: { len: (m) => si(m, 'm', 3), mm: (m) => si(m, 'm', 4), g: (g) => sig(g, 4) },
      onNote: (txt, cls, band) => {
        const bandTxt = band === 'visible' ? '' : ` ${sig(p.lambda, 5)} nm is ${band}; the beam is shown in false colour.`;
        note.textContent = txt + bandTxt;
        note.style.color = cls === 'bad' ? 'var(--bad)' : '';
      },
    });
    const st = stabilityWord(c);
    byId('ro-fsr').textContent = si(c.FSR, 'Hz');
    byId('ro-finesse').textContent = sig(c.finesse, 5);
    byId('ro-fwhm').textContent = si(c.fwhm, 'Hz');
    byId('ro-g').innerHTML = `${esc(sig(c.g, 4))}<span class="chip ${st.cls}">${st.word}</span>`;
    byId('ro-w0').textContent = c.hasMode ? si(c.w0, 'm', 3) : '—';
    byId('ro-w12').textContent = c.hasMode ? `${si(c.w1, 'm', 3)} / ${si(c.w2, 'm', 3)}` : '—';
    byId('ro-tms').innerHTML = c.hasMode ? `${esc(si(c.tms, 'Hz', 4))} <small>(${esc(sig(c.tmsFrac, 3))} FSR)</small>` : '—';
    byId('ro-floor').textContent = S.tn1 ? sci(S.tn1.floor.total, 2) : '—';
    const fr = (v) => (Number.isFinite(v) ? sig(v, 4) : '∞');
    byId('rail-summary').textContent = `L ${sig(p.L, 4)} mm, R ${fr(p.roc1)} / ${fr(p.roc2)} mm, λ ${sig(p.lambda, 5)} nm`;
  }

  /* ================================================================ tab: cavity */
  function renderCavity() {
    const c = S.cav, p = S.p, t = Plots.theme();
    const st = stabilityWord(c);
    const M = c.abcd;
    callout('cavity', [
      c.peaksOverlap && 'Reflectivities are so low that neighbouring resonances overlap: the half-maximum width is undefined, so the finesse shown is π√(r₁r₂)/(1 − r₁r₂).',
      !c.hasMode && { text: noModeMsg(c) + ' Mode-dependent results are not available.', bad: true },
    ]);
    const modeRows = c.hasMode ? [
      ['g₁, g₂', `${sig(c.g1, 5)}, ${sig(c.g2, 5)}`],
      ['g₁g₂', `${sig(c.g, 6)}, ${st.word}`, st.cls],
      ['Waist radius w₀', si(c.w0, 'm')],
      ['Waist position from M₁', si(c.z1, 'm')],
      ['Rayleigh range', si(c.zR, 'm')],
      ['Spot radius on M₁, M₂', `${si(c.w1, 'm')}, ${si(c.w2, 'm')}`],
      ['Divergence (half angle)', si(c.divergence, 'rad')],
      ['One-way Gouy phase ψ', `${sig(c.gouy, 5)} rad (${sig((c.gouy * 180) / PI, 5)}°)`],
      ['Transverse mode spacing', `${si(c.tms, 'Hz')} (${sig(c.tmsFrac, 4)} FSR)`],
    ] : [['g₁, g₂', `${sig(c.g1, 5)}, ${sig(c.g2, 5)}`], ['g₁g₂', `${sig(c.g, 6)}, ${st.word}`, st.cls], ['Gaussian mode', 'none']];
    results('res-cavity', [
      { title: 'Resonator', rows: [
        ['Free spectral range', si(c.FSR, 'Hz', 6)],
        ['Finesse 𝓕', sig(c.finesse, 6)],
        ['High-reflectivity approximation', sig(c.finesseApprox, 6)],
        ['Linewidth δν (FWHM)', si(c.fwhm, 'Hz', 5)],
        ['Cavity pole δν/2', si(c.hwhm, 'Hz', 4)],
        ['Quality factor ν/δν', sci(c.Q, 4)],
        ['Energy storage time 1/(2πδν)', si(c.tauStorage, 's')],
        ['Round-trip time', si(c.roundTripTime, 's')],
        ['Resonance width in length λ/(2𝓕)', si(c.lengthFwhm, 'm', 3)],
        ['Optical frequency', si(c.nu, 'Hz', 7)],
      ] },
      { title: 'On resonance', rows: [
        ['Transmission', pct(c.transRes)],
        ['Reflection', pct(c.reflRes)],
        ['Absorbed and scattered', pct(c.lossRes)],
        ['Circulating ÷ input power', sig(c.circGain, 5)],
        ['Mirror transmissions T₁, T₂', `${pct(c.T1)}, ${pct(c.T2)}`],
        ['Coefficient of finesse 4r₁r₂/(1 − r₁r₂)²', sci(c.coefFinesse, 4)],
      ] },
      { title: 'TEM₀₀ mode', rows: modeRows },
      { title: 'Round-trip ray matrix from M₁', rows: [
        ['A', sig(M[0][0], 6)], ['B', si(M[0][1], 'm', 6)], ['C', `${sig(M[1][0], 6)} m⁻¹`], ['D', sig(M[1][1], 6)],
        ['det M', sig(c.abcdDet, 8)], ['(A + D)/2 = 2g₁g₂ − 1', sig(c.halfTrace, 6)],
      ] },
    ]);

    const ylog = p.cavScale === 'log';
    const FSR = c.FSR, u = fUnit(FSR * 1.25);
    const grid = denseGrid(-0.25 * FSR, 1.25 * FSR, [0, FSR], c.fwhm);
    const a = P.airy(c, grid);
    const xs = grid.map((v) => v / u.k);
    plot('pl-airy', [
      { x: xs, y: a.trans, name: 'Transmission', line: { color: t.s[0], width: 2 }, hovertemplate: `%{x:.5g} ${u.u}<br>T = %{y:.4g}<extra></extra>` },
      { x: xs, y: a.refl, name: 'Reflection', line: { color: t.s[1], width: 1.5 }, hovertemplate: `%{x:.5g} ${u.u}<br>R = %{y:.4g}<extra></extra>` },
    ], { x: { title: `Laser detuning (${u.u})` }, y: { title: 'Fraction of input power', log: ylog, range: ylog ? logRange(a.trans) : [0, 1.04] }, shapes: [vline(0, t.faint, 'dot'), vline(FSR / u.k, t.faint, 'dot')] });

    const z = P.linspace(-4 * c.fwhm, 4 * c.fwhm, 801);
    const az = P.airy(c, z), uz = fUnit(4 * c.fwhm);
    const zs = z.map((v) => v / uz.k);
    plot('pl-closeup', [
      { x: zs, y: az.trans, name: 'Transmission', line: { color: t.s[0], width: 2 } },
      { x: zs, y: az.refl, name: 'Reflection', line: { color: t.s[1], width: 1.5 } },
    ], {
      x: { title: `Laser detuning (${uz.u})` }, y: { title: 'Fraction of input power', log: ylog, range: ylog ? logRange(az.trans) : [0, 1.04] },
      shapes: [vline(-c.hwhm / uz.k, t.ink, 'dash'), vline(c.hwhm / uz.k, t.ink, 'dash')],
      annotations: [{ text: `FWHM ${si(c.fwhm, 'Hz')}`, x: c.hwhm / uz.k, y: 0.5, xref: 'x', yref: 'paper', xanchor: 'left', xshift: 6 }],
    });

    if (!c.hasMode) { emptyPlot('pl-beam', noModeMsg(c)); return; }
    const prof = P.beamProfile(c, 301);
    const ul = lUnit(Math.max(c.w1, c.w2)), uzL = lUnit(p.L * 1e-3);
    const colour = Hero.beamColour(p.lambda).colour;
    const zz = prof.z.map((v) => v / uzL.k);
    plot('pl-beam', [
      { x: zz, y: prof.w.map((w) => -w / ul.k), name: '−w(z)', line: { color: colour, width: 1.4 }, hoverinfo: 'skip', showlegend: false },
      { x: zz, y: prof.w.map((w) => w / ul.k), name: 'w(z)', line: { color: colour, width: 2 }, fill: 'tonexty', fillcolor: rgba(colour, 0.18), hovertemplate: `z = %{x:.4g} ${uzL.u}<br>w = %{y:.4g} ${ul.u}<extra></extra>` },
      ...(c.z1 >= 0 && c.z1 <= p.L * 1e-3 ? [{ x: [c.z1 / uzL.k], y: [c.w0 / ul.k], mode: 'markers+text', text: [`w₀ = ${si(c.w0, 'm', 3)}`], textposition: 'top center', marker: { color: t.ink, size: 7 }, name: 'Waist', showlegend: false }] : []),
    ], { legend: false, x: { title: `Position from M₁ (${uzL.u})` }, y: { title: `Beam radius (${ul.u})` }, shapes: [vline(0, t.faint, 'solid'), vline((p.L * 1e-3) / uzL.k, t.faint, 'solid')] });
  }

  /* ================================================================ tab: stability */
  function renderStability() {
    const c = S.cav, p = S.p, b = S.base, t = Plots.theme();
    const st = stabilityWord(c);
    const crit = [b.roc1, b.roc2, b.roc1 + b.roc2].filter((r) => Number.isFinite(r) && r > 0);
    const Lmax = Math.max(1.6 * b.L, ...crit.map((r) => 1.15 * r));
    const iv = P.stableLengthIntervals(b.roc1, b.roc2, Lmax * 4);
    const ivText = iv.length ? iv.map(([a, z]) => `${sig(a * 1e3, 4)} to ${z >= Lmax * 4 * 0.999 ? '∞' : sig(z * 1e3, 4)} mm`).join('; ') : 'none';
    let edge = null;
    for (const r of crit) if (!edge || Math.abs(b.L - r) < Math.abs(b.L - edge)) edge = r;
    const sens = P.gSensitivity(c, [1e-9], [1e-9]);
    callout('stability', [
      !c.hasMode && { text: `${noModeMsg(c)} Stable lengths for these mirrors: ${ivText}.`, bad: true },
    ]);
    results('res-stability', [
      { title: 'Your cavity', rows: [
        ['g₁ = 1 − L/R₁', sig(c.g1, 6)],
        ['g₂ = 1 − L/R₂', sig(c.g2, 6)],
        ['g₁g₂', `${sig(c.g, 6)}, ${st.word}`, st.cls],
        ['Stable lengths with these mirrors', ivText],
        ['Nearest stability edge', edge ? `L = ${sig(edge * 1e3, 5)} mm, ${si(Math.abs(b.L - edge), 'm', 3)} away` : 'none for these mirrors'],
      ] },
      { title: 'Sensitivity', rows: [
        ['d(g₁g₂)/dL', `${sig(sens.dgdL * 1e-3, 4)} per mm`],
        ['Δ(g₁g₂) for ΔL = 1 nm', sci(sens.byL[0], 3)],
        ['Δ(g₁g₂) for ΔR₁ = 1 nm', Number.isFinite(b.roc1) ? sci(sens.byR1[0], 3) : 'R₁ is flat'],
      ] },
    ]);

    // --- stability diagram
    const lim = 2.2;
    const hyp = P.linspace(1 / lim, lim, 160);
    const fill = rgba(t.ok, 0.13);
    const traces = [
      { x: [0, 0, ...hyp, lim, 0], y: [0, lim, ...hyp.map((g) => 1 / g), 0, 0], fill: 'toself', fillcolor: fill, line: { width: 0 }, hoverinfo: 'skip', name: 'Stable', showlegend: false },
      { x: [0, 0, ...hyp.map((g) => -g), -lim, 0], y: [0, -lim, ...hyp.map((g) => -1 / g), 0, 0], fill: 'toself', fillcolor: fill, line: { width: 0 }, hoverinfo: 'skip', showlegend: false },
      { x: hyp, y: hyp.map((g) => 1 / g), mode: 'lines', line: { color: t.ok, width: 1, dash: 'dot' }, hoverinfo: 'skip', showlegend: false },
      { x: hyp.map((g) => -g), y: hyp.map((g) => -1 / g), mode: 'lines', line: { color: t.ok, width: 1, dash: 'dot' }, hoverinfo: 'skip', showlegend: false },
    ];
    const ref = P.REFERENCE_CAVITIES;
    traces.push({
      x: ref.map((r) => r.g1), y: ref.map((r) => r.g2), mode: 'markers', name: 'Reference cavities',
      marker: { symbol: 'square-open', size: 9, color: t.soft, line: { width: 1.5 } },
      text: ref.map((r) => `${r.name}<br>${r.rule}`), hovertemplate: '%{text}<br>g₁ = %{x:.3g}, g₂ = %{y:.3g}<extra></extra>',
    });
    const C1 = c.C1, C2 = c.C2;
    const ends = [C1, C2].filter((x) => x !== 0).map((x) => (1 + lim) / Math.abs(x));
    if (ends.length) {
      const Lend = Math.min(...ends);
      const Ls = P.linspace(0, Lend, 240);
      traces.push({
        x: Ls.map((L) => 1 - L * C1), y: Ls.map((L) => 1 - L * C2), mode: 'lines', name: 'Your mirrors as L varies',
        line: { color: t.s[0], width: 1.6, dash: 'dash' }, text: Ls.map((L) => `L = ${sig(L * 1e3, 4)} mm`), hovertemplate: '%{text}<extra></extra>',
      });
    }
    traces.push({
      x: [c.g1], y: [c.g2], mode: 'markers', name: 'Your cavity',
      marker: { size: 13, color: st.cls === 'ok' ? t.ok : st.cls === 'warn' ? t.warn : t.bad, line: { color: t.ink, width: 1.5 } },
      hovertemplate: `Your cavity<br>g₁ = %{x:.4g}, g₂ = %{y:.4g}<br>g₁g₂ = ${sig(c.g, 4)}<extra></extra>`,
    });
    plot('pl-gdiagram', traces, {
      x: { title: 'g₁ = 1 − L/R₁', range: [-lim, lim], extra: { zeroline: true, zerolinecolor: t.line } },
      y: { title: 'g₂ = 1 − L/R₂', range: [-lim, lim], extra: { zeroline: true, zerolinecolor: t.line, scaleanchor: 'x', scaleratio: 1 } },
    });

    // --- g vs L and mode sizes vs L
    const sw = P.lengthSweep(b, Lmax, 700);
    const Lmm = sw.L.map((L) => L * 1e3);
    plot('pl-gvsl', [
      { x: Lmm, y: sw.g, name: 'g₁g₂', line: { color: t.ink, width: 2 }, hovertemplate: 'L = %{x:.4g} mm<br>g₁g₂ = %{y:.4g}<extra></extra>' },
      { x: [p.L], y: [c.g], mode: 'markers', name: 'Your length', marker: { size: 11, color: t.s[0], line: { color: t.ink, width: 1 } } },
    ], {
      x: { title: 'Cavity length L (mm)' }, y: { title: 'g₁g₂', range: [-1.3, 2.3] },
      shapes: [{ type: 'rect', xref: 'paper', yref: 'y', x0: 0, x1: 1, y0: 0, y1: 1, fillcolor: fill, line: { width: 0 }, layer: 'below' }, vline(p.L, t.s[0], 'dot')],
    });
    const anyMode = sw.w1.some((w) => w !== null);
    if (!anyMode) emptyPlot('pl-wvsl', 'No stable length in the scanned range.');
    else {
      const um = (arr) => arr.map((w) => (w === null ? null : w * 1e6));
      plot('pl-wvsl', [
        { x: Lmm, y: um(sw.w1), name: 'Spot on M₁', line: { color: t.s[0], width: 2 } },
        { x: Lmm, y: um(sw.w2), name: 'Spot on M₂', line: { color: t.s[1], width: 2, dash: 'dash' } },
        { x: Lmm, y: um(sw.w0), name: 'Waist', line: { color: t.s[2], width: 1.6 } },
      ], { hovermode: 'x unified', x: { title: 'Cavity length L (mm)' }, y: { title: 'Radius (µm)', log: true }, shapes: [vline(p.L, t.faint, 'dot')] });
    }

    // --- sensitivity
    const d = P.logspace(1e-16, 1e-6, 120);
    const sl = P.gSensitivity(c, d, d);
    const tr = [{ x: d, y: sl.byL.map(Math.abs), name: '|Δ(g₁g₂)| for ΔL', line: { color: t.s[0], width: 2 } }];
    if (Number.isFinite(b.roc1)) tr.push({ x: d, y: sl.byR1.map(Math.abs), name: '|Δ(g₁g₂)| for ΔR₁', line: { color: t.s[1], width: 2, dash: 'dash' } });
    else if (Number.isFinite(b.roc2)) tr.push({ x: d, y: d.map((dd) => Math.abs(((b.L * dd) / (b.roc2 * (b.roc2 + dd))) * c.g1)), name: '|Δ(g₁g₂)| for ΔR₂', line: { color: t.s[1], width: 2, dash: 'dash' } });
    plot('pl-sens', tr, { x: { title: 'ΔL or ΔR (m)', log: true }, y: { title: '|Δ(g₁g₂)|', log: true } });
  }

  /* ================================================================ tab: modes */
  function renderModes() {
    const c = S.cav, p = S.p, t = Plots.theme();
    const ids = ['pl-homspec', 'pl-hombar', 'pl-homg', 'pl-homlen', 'pl-hg', 'pl-homsize'];
    if (!c.hasMode) {
      callout('modes', { text: noModeMsg(c), bad: true });
      results('res-modes', []);
      ids.forEach((id) => emptyPlot(id, 'No stable Gaussian mode.'));
      return;
    }
    const hom = P.homSpectrum(c, p.homNmax);
    const higher = hom.slice(1);
    const nearest = higher.reduce((a, h) => (Math.abs(h.offsetHz) < Math.abs(a.offsetHz) ? h : a), higher[0]);
    const strongest = higher.reduce((a, h) => (h.rel > a.rel ? h : a), higher[0]);
    const wMax = Math.max(c.w1, c.w2), rb = p.rbore * 1e-3, Rm = p.Rm * 1e-3;
    const nBore = Math.floor((rb / wMax) ** 2 - 1);
    callout('modes', [
      strongest.rel > 0.01 && { text: `Mode order ${strongest.N} is transmitted at ${sig(strongest.rel * 100, 3)} % of TEM₀₀: it lies within ${sig(Math.abs(strongest.offsetLinewidths), 3)} linewidths of the TEM₀₀ resonance. A small length or curvature change moves it away.`, bad: false },
      wMax >= rb && { text: 'The TEM₀₀ spot is larger than the bore: the mode will be clipped.', bad: true },
    ]);
    results('res-modes', [
      { title: 'Mode spacing', rows: [
        ['One-way Gouy phase', `${sig((c.gouy * 180) / PI, 5)}°`],
        ['Transverse mode spacing', `${si(c.tms, 'Hz')} (${sig(c.tmsFrac, 4)} FSR)`],
        [`Order closest to TEM₀₀ (N ≤ ${p.homNmax})`, `N = ${nearest.N}, ${si(nearest.offsetHz, 'Hz')} (${sig(nearest.offsetLinewidths, 3)} linewidths)`],
        ['Its relative transmission', sci(nearest.rel, 3)],
        ['Strongest higher order', `N = ${strongest.N}, ${sci(strongest.rel, 3)}`, strongest.rel > 0.01 ? 'warn' : ''],
      ] },
      { title: 'Apertures', rows: [
        ['Largest spot on a mirror', si(wMax, 'm', 3)],
        ['Highest order inside the bore', nBore >= 0 ? `N = ${nBore}` : 'none', nBore < 0 ? 'bad' : ''],
        ['TEM₀₀ power outside the bore', clipText(P.clipLoss(wMax, rb))],
        ['TEM₀₀ power outside the mirror', clipText(P.clipLoss(wMax, Rm))],
      ] },
    ]);

    // --- spectrum
    const FSR = c.FSR, u = fUnit(FSR / 2);
    const relMin = Math.max(1e-16, Math.min(...hom.map((h) => h.rel)) / 5);
    const sx = [], sy = [];
    for (const h of hom) { sx.push(h.offsetHz / u.k, h.offsetHz / u.k, null); sy.push(relMin, h.rel, null); }
    const ag = denseGrid(-FSR / 2, FSR / 2, [0], c.fwhm, 1500, 201);
    const airy = ag.map((d) => 1 / (1 + c.coefFinesse * Math.sin((PI * d) / FSR) ** 2));
    plot('pl-homspec', [
      { x: ag.map((d) => d / u.k), y: airy, name: 'TEM₀₀ resonance', line: { color: t.faint, width: 1 }, hoverinfo: 'skip' },
      { x: sx, y: sy, mode: 'lines', line: { color: t.s[0], width: 1.4 }, hoverinfo: 'skip', showlegend: false },
      {
        x: hom.map((h) => h.offsetHz / u.k), y: hom.map((h) => h.rel), mode: 'markers+text', name: 'Mode order N',
        text: hom.map((h) => String(h.N)), textposition: 'top center', textfont: { size: 11, color: t.soft },
        marker: { size: 8, color: hom.map((h) => (h.N === 0 ? t.ink : h.rel > 0.01 ? t.bad : t.s[0])) },
        customdata: hom.map((h) => [h.N, h.degeneracy, h.offsetLinewidths]),
        hovertemplate: `N = %{customdata[0]} (%{customdata[1]} modes)<br>offset %{x:.4g} ${u.u} = %{customdata[2]:.3g} linewidths<br>relative transmission %{y:.3g}<extra></extra>`,
      },
    ], { x: { title: `Offset from the TEM₀₀ resonance (${u.u})`, range: [-FSR / 2 / u.k, FSR / 2 / u.k] }, y: { title: 'Relative transmission', log: true, range: [Math.log10(relMin), 0.35] } });

    plot('pl-hombar', [{
      type: 'bar', x: higher.map((h) => h.N), y: higher.map((h) => h.rel), marker: { color: higher.map((h) => (h.rel > 0.01 ? t.bad : t.s[0])) },
      hovertemplate: 'N = %{x}<br>%{y:.3g}<extra></extra>', name: 'Relative transmission',
    }], { legend: false, x: { title: 'Mode order N = m + n', extra: { dtick: p.homNmax > 20 ? 5 : 1 } }, y: { title: 'Relative transmission', log: true } });

    // --- suppression vs g
    const gs = P.linspace(0.0005, 0.9995, 500);
    const vg = P.homVsG(c.coefFinesse, p.homNmax, gs);
    const nShow = Math.min(p.homNmax, 6);
    const tg = [];
    for (let i = 0; i < nShow; i++) tg.push({ x: gs, y: vg.series[i], name: `N = ${i + 1}`, line: { width: 1.2, color: t.s[i % 6] }, opacity: 0.85 });
    tg.push({ x: gs, y: vg.sum, name: `Sum to N = ${p.homNmax}`, line: { width: 2.4, color: t.ink } });
    plot('pl-homg', tg, { x: { title: 'g₁g₂' }, y: { title: 'Relative transmission', log: true }, shapes: [vline(c.g, t.ink, 'dash')] });

    // --- order N vs length
    const L0 = p.L * 1e-3, rng = p.homSweepRange * 1e-3;
    const Ls = P.linspace(Math.max(L0 - rng, L0 * 1e-3), L0 + rng, 900);
    const rel = P.homVsLength(S.base, p.homSweepN, Ls);
    plot('pl-homlen', [{ x: Ls.map((L) => L * 1e3), y: rel, name: `N = ${p.homSweepN}`, line: { color: t.s[0], width: 1.8 }, hovertemplate: 'L = %{x:.5g} mm<br>%{y:.3g}<extra></extra>' }],
      { legend: false, x: { title: 'Cavity length (mm)' }, y: { title: `Relative transmission, N = ${p.homSweepN}`, log: true }, shapes: [vline(p.L, t.ink, 'dash')] });

    // --- intensity pattern
    const w = p.homPlane === 'm1' ? c.w1 : p.homPlane === 'm2' ? c.w2 : c.w0;
    const mm = Math.max(p.homM, p.homN);
    const extent = w * (1.6 * Math.sqrt(2 * mm + 1) + 1.2);
    const ue = lUnit(extent);
    const hg = P.hgIntensity(p.homM, p.homN, w, extent, 141);
    const colour = Hero.beamColour(p.lambda).colour;
    const shapes = [{ type: 'circle', xref: 'x', yref: 'y', x0: -w / ue.k, x1: w / ue.k, y0: -w / ue.k, y1: w / ue.k, line: { color: t.ink, width: 1, dash: 'dash' } }];
    if (rb < extent * 1.5) shapes.push({ type: 'circle', xref: 'x', yref: 'y', x0: -rb / ue.k, x1: rb / ue.k, y0: -rb / ue.k, y1: rb / ue.k, line: { color: t.ink, width: 1.4 } });
    plot('pl-hg', [{
      type: 'heatmap', x: hg.x.map((v) => v / ue.k), y: hg.y.map((v) => v / ue.k), z: hg.z, showscale: false,
      colorscale: [[0, rgba(colour, 0)], [0.25, rgba(colour, 0.35)], [1, rgba(colour, 1)]],
      hovertemplate: `x %{x:.3g} ${ue.u}<br>y %{y:.3g} ${ue.u}<br>I/I<sub>max</sub> %{z:.3f}<extra></extra>`,
    }], {
      legend: false, shapes,
      x: { title: `x (${ue.u})`, range: [-extent / ue.k, extent / ue.k] },
      y: { title: `y (${ue.u})`, range: [-extent / ue.k, extent / ue.k], extra: { scaleanchor: 'x', scaleratio: 1 } },
      annotations: [{ text: `HG<sub>${p.homM}${p.homN}</sub>, w = ${si(w, 'm', 3)}`, xref: 'paper', yref: 'paper', x: 0, y: 1, xanchor: 'left', yanchor: 'bottom' }],
    });

    // --- mode size vs order
    const Ns = Array.from({ length: 201 }, (_, i) => i);
    plot('pl-homsize', [
      { x: Ns, y: Ns.map((N) => wMax * Math.sqrt(N + 1) * 1e3), name: 'Larger mirror spot × √(N + 1)', line: { color: t.s[0], width: 2 } },
      { x: Ns, y: Ns.map((N) => c.w0 * Math.sqrt(N + 1) * 1e3), name: 'Waist × √(N + 1)', line: { color: t.s[2], width: 1.6, dash: 'dash' } },
    ], {
      x: { title: 'Mode order N' }, y: { title: 'Radius (mm)', range: [0, 1.25 * Math.max(rb, Rm) * 1e3] },
      shapes: [hline(rb * 1e3, t.bad, 'dash'), hline(Rm * 1e3, t.soft, 'dot')],
      annotations: [
        { text: `bore ${si(rb, 'm', 3)}`, xref: 'paper', x: 1, xanchor: 'right', y: rb * 1e3, yanchor: 'bottom' },
        { text: `mirror ${si(Rm, 'm', 3)}`, xref: 'paper', x: 1, xanchor: 'right', y: Rm * 1e3, yanchor: 'bottom' },
      ],
    });
  }

  /* ================================================================ tab: thermal noise */
  function noiseFloor(tnp, base) {
    const cv = P.cavity(base);
    const tn = P.thermalNoise(cv, tnp, [1]);
    return tn ? tn.floor : null;
  }
  function renderNoise() {
    const c = S.cav, p = S.p, t = Plots.theme();
    const ids = ['pl-asd', 'pl-share', 'pl-matnoise', 'pl-floorlen'];
    if (!c.hasMode) {
      callout('noise', { text: noModeMsg(c) + ' Substrate and coating noise depend on the spot sizes.', bad: true });
      results('res-noise', []);
      ids.forEach((id) => emptyPlot(id, 'No stable Gaussian mode.'));
      return;
    }
    const fs = P.logspace(p.fMin, p.fMax, 160);
    const tn = P.thermalNoise(c, S.tnp, fs);
    const shareOf = { spacer: tn.share.spacer, substrates: tn.share.substrates, coatings: tn.share.coatings };
    const dom = Object.entries(shareOf).sort((a, b) => b[1] - a[1])[0];
    const domName = { spacer: 'spacer', substrates: 'mirror substrates', coatings: 'coatings' }[dom[0]];
    callout('noise', []);
    results('res-noise', [
      { title: 'Flicker floor of the Allan deviation', rows: [
        ['Total σ<sub>y</sub>', sci(tn.floor.total, 3)],
        ['Spacer', sci(tn.floor.spacer, 3)],
        ['Both substrates', sci(tn.floor.substrates, 3)],
        ['Both coatings', sci(tn.floor.coatings, 3)],
        ['Largest contribution', `${domName}, ${sig(dom[1] * 100, 3)} % of the noise power`],
      ] },
      { title: 'At 1 Hz', rows: [
        ['Length noise', `${sci(Math.sqrt(tn.coef.total), 3)} m/√Hz`],
        ['Fractional frequency noise', `${sci(Math.sqrt(tn.coef.total) / (p.L * 1e-3), 3)} /√Hz`],
        ['Frequency noise', `${sci((Math.sqrt(tn.coef.total) / (p.L * 1e-3)) * c.nu, 3)} Hz/√Hz`],
        ['Loss angles φ: spacer, substrate, coating', `${sci(1 / p.spQ, 2)}, ${sci(1 / p.mrQ, 2)}, ${sci(1 / p.coatQ, 2)}`],
        ['Spot radii used', `${si(c.w1, 'm', 3)}, ${si(c.w2, 'm', 3)}`],
      ] },
    ]);

    const view = p.noiseView;
    const key = view === 'x' ? 'asdX' : view === 'nu' ? 'asdNu' : 'asdY';
    const yTitle = view === 'x' ? 'Length noise (m/√Hz)' : view === 'nu' ? 'Frequency noise (Hz/√Hz)' : 'Fractional frequency noise (1/√Hz)';
    plot('pl-asd', [
      { x: fs, y: tn[key].spacer, name: 'Spacer', line: { color: t.s[2], width: 1.6, dash: 'dot' } },
      { x: fs, y: tn[key].substrates, name: 'Substrates', line: { color: t.s[0], width: 1.6, dash: 'dash' } },
      { x: fs, y: tn[key].coatings, name: 'Coatings', line: { color: t.s[1], width: 1.6, dash: 'dashdot' } },
      { x: fs, y: tn[key].total, name: 'Total', line: { color: t.ink, width: 2.6 } },
    ], { hovermode: 'x unified', x: { title: 'Fourier frequency (Hz)', log: true }, y: { title: yTitle, log: true } });

    const parts = [['Spacer', tn.coef.spacer], ['Substrate M₁', tn.coef.substrate1], ['Substrate M₂', tn.coef.substrate2], ['Coating M₁', tn.coef.coating1], ['Coating M₂', tn.coef.coating2]];
    plot('pl-share', [{
      type: 'bar', orientation: 'h', y: parts.map((x) => x[0]), x: parts.map((x) => (100 * x[1]) / tn.coef.total),
      marker: { color: [t.s[2], t.s[0], t.s[0], t.s[1], t.s[1]] }, text: parts.map((x) => `${sig((100 * x[1]) / tn.coef.total, 3)} %`),
      textposition: 'outside', cliponaxis: false, hovertemplate: '%{y}: %{x:.3g} %<extra></extra>',
    }], { legend: false, x: { title: 'Share of length-noise power (%)', range: [0, 115] }, y: { extra: { autorange: 'reversed' } }, layout: { margin: { l: 96, r: 16, t: 12, b: 46 } } });

    // material matrix
    const zr = [], tx = [];
    for (const mk of MAT_KEYS) {
      const row = [], trow = [];
      for (const sk of MAT_KEYS) {
        const fl = P.thermalNoise(c, { ...S.tnp, spacer: libMat(sk), mirror: libMat(mk) }, [1]).floor.total;
        row.push(Math.log10(fl)); trow.push(sci(fl, 2));
      }
      zr.push(row); tx.push(trow);
    }
    const names = MAT_KEYS.map((k) => SHORT[k]);
    const si0 = MAT_KEYS.indexOf(p.spacerMat), mi0 = MAT_KEYS.indexOf(p.mirrorMat);
    plot('pl-matnoise', [{
      type: 'heatmap', x: names, y: names, z: zr, text: tx, texttemplate: '%{text}', textfont: { size: 11, color: t.ink },
      colorscale: [[0, rgba(t.s[4], 0.55)], [0.5, rgba(t.s[5], 0.12)], [1, rgba(t.s[1], 0.55)]], showscale: false,
      hovertemplate: 'Spacer %{x}<br>Substrates %{y}<br>σ<sub>y</sub> = %{text}<extra></extra>', xgap: 2, ygap: 2,
    }], {
      legend: false, x: { title: 'Spacer' }, y: { title: 'Mirror substrates' },
      shapes: si0 >= 0 && mi0 >= 0 ? [{ type: 'rect', xref: 'x', yref: 'y', x0: si0 - 0.5, x1: si0 + 0.5, y0: mi0 - 0.5, y1: mi0 + 0.5, line: { color: t.ink, width: 2 } }] : [],
    });

    // floor vs length with fixed g-factors
    const Ls = P.logspace(p.lenMin * 1e-3, p.lenMax * 1e-3, 70);
    const rows = Ls.map((L) => {
      const roc = (g) => (g === 1 ? Infinity : L / (1 - g));
      return noiseFloor(S.tnp, { ...S.base, L, roc1: roc(c.g1), roc2: roc(c.g2) });
    });
    const Lmm = Ls.map((L) => L * 1e3);
    const get = (k) => rows.map((r) => (r ? r[k] : null));
    plot('pl-floorlen', [
      { x: Lmm, y: get('spacer'), name: 'Spacer', line: { color: t.s[2], width: 1.5, dash: 'dot' } },
      { x: Lmm, y: get('substrates'), name: 'Substrates', line: { color: t.s[0], width: 1.5, dash: 'dash' } },
      { x: Lmm, y: get('coatings'), name: 'Coatings', line: { color: t.s[1], width: 1.5, dash: 'dashdot' } },
      { x: Lmm, y: get('total'), name: 'Total', line: { color: t.ink, width: 2.4 } },
      { x: [p.L], y: [tn.floor.total], mode: 'markers', name: 'Your cavity', marker: { size: 10, color: t.s[0], line: { color: t.ink, width: 1 } } },
    ], { hovermode: 'x unified', x: { title: 'Cavity length (mm)', log: true }, y: { title: 'Flicker floor σ<sub>y</sub>', log: true } });
  }

  /* ================================================================ tab: thermal expansion */
  function renderExpansion() {
    const c = S.cav, p = S.p, cm = S.cte, t = Plots.theme();
    const nu = c.nu, Lm = p.L * 1e-3, Rm = p.Rm * 1e-3;
    const spC = cteOf('sp');
    const Top = p.Top + K0;
    const T0e = cm.T0eff;
    const Tc = T0e !== null ? T0e : spC.model === 'zero' ? spC.T0 : Top;
    const dAlpha = (T) => (cm.alphaEff(T + 1e-3) - cm.alphaEff(T - 1e-3)) / 2e-3;
    const aEff0 = T0e !== null ? dAlpha(T0e) : null;
    const dgdT = c.hasMode ? -(c.C1 * c.g2 + c.C2 * c.g1) * Lm * cm.alphaEff(Top) : null;
    const t0c = T0e !== null ? T0e - K0 : null;
    callout('expansion', [
      T0e === null && { text: 'The effective expansion coefficient has no zero crossing within ±150 K of 20 °C, so the cavity frequency always drifts with temperature.', bad: true },
      t0c !== null && (t0c < 5 || t0c > 40) && { text: `The cavity's zero crossing is at ${sig(t0c, 4)} °C, outside a convenient range. ULE rings on the mirror backs (smaller δ) or ULE mirrors move it back towards the spacer's value.`, bad: false },
    ]);
    results('res-expansion', [
      { title: 'Zero crossing', rows: [
        ['Lever factor 2δR<sub>m</sub>/L', sig(cm.k, 4)],
        ['Spacer zero crossing', spC.model === 'zero' ? `${sig(spC.T0 - K0, 5)} °C` : 'none (linear model)'],
        ['Cavity zero crossing', T0e !== null ? `${sig(T0e - K0, 5)} °C (${sig(T0e, 6)} K)` : 'none found', T0e === null ? 'bad' : ''],
        ['Shift caused by the mirrors', spC.model === 'zero' && T0e !== null ? `${sig(T0e - spC.T0, 4)} K` : '—'],
        ['Curvature dα<sub>eff</sub>/dT there', aEff0 !== null ? `${sig(aEff0 * 1e9, 4)} × 10⁻⁹/K²` : '—'],
        ['Δν for ±10 mK about the zero crossing', aEff0 !== null ? si((nu * Math.abs(aEff0) * 1e-4) / 2, 'Hz', 3) : '—'],
        ['Window for |Δν| < 1 Hz there', aEff0 !== null ? `±${si(Math.sqrt(2 / (nu * Math.abs(aEff0))), 'K', 3)}` : '—'],
      ] },
      { title: `At the operating temperature, ${sig(p.Top, 5)} °C`, rows: [
        ['Effective CTE', `${sig(cm.alphaEff(Top) * 1e9, 4)} × 10⁻⁹/K`],
        ['dν/dT', si(-nu * cm.alphaEff(Top), 'Hz/K', 4)],
        ['Spacer CTE', `${sig(cm.alphaS(Top) * 1e9, 4)} × 10⁻⁹/K`],
        ['Mirror CTE', `${sig(cm.alphaM(Top) * 1e9, 4)} × 10⁻⁹/K`],
        ['Change of g₁g₂ per kelvin', dgdT !== null ? `${sci(dgdT, 3)} /K` : '—'],
      ] },
    ]);

    const Ts = P.linspace(Tc - p.cteSpan, Tc + p.cteSpan, 401);
    const Tcel = Ts.map((T) => T - K0);
    const shapes = [hline(0, t.line, 'solid')];
    if (T0e !== null) shapes.push(vline(T0e - K0, t.ink, 'dash'));
    if (spC.model === 'zero') shapes.push(vline(spC.T0 - K0, t.s[0], 'dot'));
    plot('pl-cte', [
      { x: Tcel, y: Ts.map((T) => cm.alphaEff(T) * 1e9), name: 'Cavity (effective)', line: { color: t.ink, width: 2.5 } },
      { x: Tcel, y: Ts.map((T) => cm.alphaS(T) * 1e9), name: 'Spacer', line: { color: t.s[0], width: 1.6, dash: 'dash' } },
      { x: Tcel, y: Ts.map((T) => cm.alphaM(T) * 1e9), name: 'Mirror (right axis)', yaxis: 'y2', line: { color: t.s[1], width: 1.6, dash: 'dot' } },
    ], { hovermode: 'x unified', x: { title: 'Temperature (°C)' }, y: { title: 'CTE (10⁻⁹/K)' }, y2: { title: 'Mirror CTE (10⁻⁹/K)' }, shapes });

    const dnu = Ts.map((T) => -nu * cm.fracLen(T, Tc));
    const uf = fUnit(Math.max(...dnu.map(Math.abs)) || 1);
    plot('pl-dnu', [{ x: Tcel, y: dnu.map((v) => v / uf.k), name: 'Δν', line: { color: t.s[0], width: 2.2 }, hovertemplate: `%{x:.4g} °C<br>%{y:.4g} ${uf.u}<extra></extra>` }],
      { legend: false, x: { title: 'Temperature (°C)' }, y: { title: `Frequency shift (${uf.u})` }, shapes: [vline(p.Top, t.s[3], 'dot')], annotations: [{ text: 'operating temperature', x: p.Top, xref: 'x', y: 1, yref: 'paper', yanchor: 'bottom' }] });

    const dT = P.logspace(1e-6, 1, 130);
    const tr = [{ x: dT.map((d) => d * 1e3), y: dT.map((d) => nu * Math.abs(cm.fracLen(Top + d, Top))), name: `From ${sig(p.Top, 4)} °C`, line: { color: t.s[1], width: 2 } }];
    if (T0e !== null) tr.push({ x: dT.map((d) => d * 1e3), y: dT.map((d) => nu * Math.abs(cm.fracLen(T0e + d, T0e))), name: 'From the zero crossing', line: { color: t.s[0], width: 2, dash: 'dash' } });
    plot('pl-dnulog', tr, { x: { title: 'Temperature excursion ΔT (mK)', log: true }, y: { title: '|Δν| (Hz)', log: true } });

    // material matrix of |dν/dT|
    const zr = [], tx = [];
    for (const mk of MAT_KEYS) {
      const row = [], trow = [];
      for (const sk of MAT_KEYS) {
        const m2 = P.cteModel(P.MATERIALS[sk].cte, P.MATERIALS[mk].cte, p.delta, Rm, Lm);
        const v = Math.abs(nu * m2.alphaEff(Top));
        row.push(Math.log10(Math.max(v, 1e-3))); trow.push(si(v, 'Hz/K', 2));
      }
      zr.push(row); tx.push(trow);
    }
    const names = MAT_KEYS.map((k) => SHORT[k]);
    const si0 = MAT_KEYS.indexOf(p.spacerMat), mi0 = MAT_KEYS.indexOf(p.mirrorMat);
    plot('pl-matcte', [{
      type: 'heatmap', x: names, y: names, z: zr, text: tx, texttemplate: '%{text}', textfont: { size: 11, color: t.ink },
      colorscale: [[0, rgba(t.s[4], 0.55)], [0.5, rgba(t.s[5], 0.12)], [1, rgba(t.s[1], 0.55)]], showscale: false, xgap: 2, ygap: 2,
      hovertemplate: 'Spacer %{x}<br>Mirrors %{y}<br>|dν/dT| = %{text}<extra></extra>',
    }], {
      legend: false, x: { title: 'Spacer' }, y: { title: 'Mirror substrates' },
      shapes: si0 >= 0 && mi0 >= 0 ? [{ type: 'rect', xref: 'x', yref: 'y', x0: si0 - 0.5, x1: si0 + 0.5, y0: mi0 - 0.5, y1: mi0 + 0.5, line: { color: t.ink, width: 2 } }] : [],
    });

    const alphaAbs = MAT_KEYS.map((k) => {
      const poly = P.ctePoly(P.MATERIALS[k].cte), u = Top - P.T20;
      return Math.max(1e-3, Math.abs((poly[0] + poly[1] * u + poly[2] * u * u) * 1e9));
    });
    plot('pl-matprops', [
      { type: 'bar', x: names, y: alphaAbs, name: '|CTE| (10⁻⁹/K)', marker: { color: t.s[0] }, offsetgroup: 1, hovertemplate: '%{x}: %{y:.3g} × 10⁻⁹/K<extra></extra>' },
      { type: 'bar', x: names, y: MAT_KEYS.map((k) => 1 / P.MATERIALS[k].phi), name: 'Mechanical Q (right axis)', yaxis: 'y2', marker: { color: t.s[1] }, offsetgroup: 2, hovertemplate: '%{x}: Q = %{y:.3g}<extra></extra>' },
    ], { layout: { barmode: 'group' }, x: { title: '' }, y: { title: '|CTE| at the operating temperature (10⁻⁹/K)', log: true }, y2: { title: 'Mechanical Q', log: true } });
  }

  /* ================================================================ tab: temperature control */
  function shieldCfg(Tmean) {
    const p = S.p;
    const Lm = p.L * 1e-3, Rsp = p.Rsp * 1e-3, rb = p.rbore * 1e-3, Rm = p.Rm * 1e-3, tm = 6.35e-3;
    const sp = P.MATERIALS[p.spacerMat], mr = P.MATERIALS[p.mirrorMat];
    const Ccav = sp.rho * sp.cp * PI * (Rsp * Rsp - rb * rb) * Lm + 2 * mr.rho * mr.cp * PI * Rm * Rm * tm;
    const Acav = 2 * PI * Rsp * Lm + 2 * PI * Rsp * Rsp;
    return {
      Tmean, useRadiation: p.useRad, useConduction: p.useCond, includeCavity: p.incCav,
      A1in: p.A1in, e1in: p.e1in, A2out: p.A2out, e2out: p.e2out, A2in: p.A2in, e2in: p.e2in,
      A3out: p.A3out, e3out: p.e3out, A3in: p.A3in, e3in: p.e3in, m2: p.m2, c2: p.c2, m3: p.m3, c3: p.c3,
      n12: p.n12, k12: p.k12, a12: p.a12 * 1e-6, l12: p.l12 * 1e-3,
      n23: p.n23, k23: p.k23, a23: p.a23 * 1e-6, l23: p.l23 * 1e-3,
      n3c: p.n3c, k3c: p.k3c, a3c: p.a3c * 1e-6, l3c: p.l3c * 1e-3,
      Acav, ecav: p.ecav, Ccav,
    };
  }
  function unwrappedPhase(net, w) {
    const ws = P.logspace(w / 1e4, w, 80);
    const resp = P.networkResponse(net, ws);
    return net.nodes.map((_, i) => {
      let prev = 0, off = 0;
      for (const r of resp) {
        let ph = r[i].phase + off;
        while (ph - prev > PI) { ph -= 2 * PI; off -= 2 * PI; }
        while (ph - prev < -PI) { ph += 2 * PI; off += 2 * PI; }
        prev = ph;
      }
      return prev;
    });
  }
  function renderThermal() {
    const p = S.p, t = Plots.theme();
    const ids = ['pl-step', 'pl-atten', 'pl-sin', 'pl-sinnu'];
    const cfgStep = shieldCfg(p.Tf);
    const netStep = P.shieldNetwork(cfgStep);
    const dead = netStep.stages.filter((s) => !(s.G > 0));
    if (dead.length) {
      callout('thermal', { text: `${dead.map((s) => s.name).join(', ')} has no heat path. Enable radiation, or give it at least one support.`, bad: true });
      results('res-thermal', []);
      ids.forEach((id) => emptyPlot(id, 'No heat path.'));
      return;
    }
    const colours = [t.s[0], t.s[1], t.s[2]];
    const ev = P.networkEigenvalues(netStep);
    const tauSlow = -1 / ev[0];
    // ---- step
    const dT = p.Tf - p.Ti;
    const durStep = Math.min(9 * tauSlow, 3e9), nSt = 1500, dtSt = durStep / nSt;
    const st = P.simulateNetwork(netStep, dtSt, nSt, () => dT);
    const settle = st.X.map((arr) => {
      if (dT === 0) return 0;
      let last = -1;
      for (let i = 0; i < arr.length; i++) if (Math.abs(arr[i] - dT) > 0.01 * Math.abs(dT)) last = i;
      return (last + 1) * dtSt;
    });
    const days = st.t.map((x) => x / 86400);
    const stepTr = [{ x: [-0.03 * durStep / 86400, 0, 0, durStep / 86400], y: [p.Ti, p.Ti, p.Tf, p.Tf], name: 'P1 (controlled)', line: { color: t.faint, width: 1.6, dash: 'dash' } }];
    netStep.nodes.forEach((nm, i) => stepTr.push({ x: days, y: st.X[i].map((v) => p.Ti + v), name: nm, line: { color: colours[i], width: 2 } }));
    plot('pl-step', stepTr, { hovermode: 'x unified', x: { title: 'Time (days)' }, y: { title: 'Temperature (K)' } });

    // ---- periodic
    const cfgSin = shieldCfg(p.Tavg);
    const netSin = P.shieldNetwork(cfgSin);
    const Psec = p.sinPeriod * 3600, w = (2 * PI) / Psec;
    const H = P.networkResponse(netSin, [w])[0];
    const ph = unwrappedPhase(netSin, w);
    const periods = P.logspace(0.1, 1000, 160);
    const resp = P.networkResponse(netSin, periods.map((h) => (2 * PI) / (h * 3600)));
    const atTr = netSin.nodes.map((nm, i) => ({ x: periods, y: resp.map((r) => r[i].amp), name: nm, line: { color: colours[i], width: 2 } }));
    atTr.push({ x: netSin.nodes.map(() => p.sinPeriod), y: H.map((h) => h.amp), mode: 'markers', name: 'Chosen period', marker: { color: t.ink, size: 8 }, showlegend: false });
    plot('pl-atten', atTr, { hovermode: 'x unified', x: { title: 'Period of the P1 oscillation (h)', log: true }, y: { title: 'Amplitude relative to P1', log: true } });

    const durSin = Math.min(Math.max(4 * Psec, 3 * tauSlow), 40 * Psec);
    const nS = Math.min(8000, Math.max(800, Math.ceil(durSin / (Psec / 150))));
    const dtS = durSin / nS;
    const ss = P.simulateNetwork(netSin, dtS, nS, (tt) => p.sinAmp * Math.sin(w * (tt + dtS / 2)));
    const hours = ss.t.map((x) => x / 3600);
    const sinTr = [{ x: hours, y: ss.t.map((x) => p.Tavg + p.sinAmp * Math.sin(w * x)), name: 'P1', line: { color: t.faint, width: 1.4, dash: 'dash' } }];
    netSin.nodes.forEach((nm, i) => sinTr.push({ x: hours, y: ss.X[i].map((v) => p.Tavg + v), name: nm, line: { color: colours[i], width: 2 } }));
    plot('pl-sin', sinTr, { hovermode: 'x unified', x: { title: 'Time (h)' }, y: { title: 'Temperature (K)' } });

    // ---- cavity frequency
    let nuRow = ['Cavity frequency swing', 'enable “Include the cavity”'];
    if (p.incCav) {
      const cm = S.cte, spC = cteOf('sp');
      const Tref = cm.T0eff !== null ? cm.T0eff : spC.model === 'zero' ? spC.T0 : p.Top + K0;
      const Tc0 = Tref + p.cavOffset * 1e-3;
      const xc = ss.X[2];
      const dnu = xc.map((x) => -S.cav.nu * cm.fracLen(Tc0 + x, Tc0));
      const uf = fUnit(Math.max(...dnu.map(Math.abs)) || 1);
      plot('pl-sinnu', [{ x: hours, y: dnu.map((v) => v / uf.k), name: 'Δν', line: { color: t.s[1], width: 2 }, hovertemplate: `%{x:.4g} h<br>%{y:.4g} ${uf.u}<extra></extra>` }],
        { legend: false, x: { title: 'Time (h)' }, y: { title: `Cavity frequency change (${uf.u})` } });
      const ampC = H[2].amp * p.sinAmp;
      nuRow = ['Cavity frequency swing (steady state)', `±${si(S.cav.nu * Math.abs(cm.alphaEff(Tc0)) * ampC, 'Hz', 3)}`];
    } else emptyPlot('pl-sinnu', 'Include the cavity to see its frequency.');

    callout('thermal', []);
    const stRows = netStep.stages.map((s) => [s.name, `τ = ${fmtDuration(s.tau)} (radiation ${fmtDuration(s.tauRad)}, conduction ${fmtDuration(s.tauCond)})`]);
    const swing = netSin.nodes.map((nm, i) => [`${nm} swing and lag`, `±${si(H[i].amp * p.sinAmp, 'K', 3)}, ${fmtDuration((-ph[i]) / w)}`]);
    results('res-thermal', [
      { title: 'Time constants', rows: [
        ...stRows,
        ['Slowest time constant of the network', fmtDuration(tauSlow)],
        ...netStep.nodes.map((nm, i) => [`${nm} within 1 % of the step`, dT === 0 ? '—' : fmtDuration(settle[i])]),
      ] },
      { title: `Oscillation of ±${sig(p.sinAmp, 3)} K, period ${sig(p.sinPeriod, 3)} h`, rows: [
        ...swing,
        ['Cavity heat capacity and area', `${sig(cfgStep.Ccav, 4)} J/K, ${sig(cfgStep.Acav, 3)} m²`],
        nuRow,
      ] },
    ]);
  }

  /* ================================================================ tab: gas & radiation pressure */
  function renderGasRp() {
    const c = S.cav, p = S.p, t = Plots.theme();
    const alpha = p.gasAlpha * 1e-30, T = p.T;
    const dn1 = P.gasRefractivity(alpha, 100, T); // per mbar
    const dpTarget = (p.targetY * p.n) / dn1;
    const dps = P.logspace(p.pMin, p.pMax, 120);
    const dns = dps.map((d) => P.gasRefractivity(alpha, d * 100, T));
    const dnuG = dns.map((d) => (c.nu * d) / p.n);
    const dLopt = dns.map((d) => p.L * 1e-3 * d);
    plot('pl-gas', [
      { x: dps, y: dnuG, name: '|Δν| (left)', line: { color: t.s[0], width: 2.2 } },
      { x: dps, y: dLopt, name: 'Optical path change (right)', yaxis: 'y2', line: { color: t.s[1], width: 1.6, dash: 'dash' } },
    ], { hovermode: 'x unified', x: { title: 'Pressure change Δp (mbar)', log: true }, y: { title: '|Δν| (Hz)', log: true }, y2: { title: 'n·L change (m)', log: true } });

    const rows = [
      { title: `Residual gas, α′ = ${sig(p.gasAlpha, 4)} Å³ at ${sig(T, 4)} K`, rows: [
        ['Refractivity change per mbar', sci(dn1, 3)],
        ['Fractional frequency change per mbar', sci(dn1 / p.n, 3)],
        ['Frequency change per mbar', si((c.nu * dn1) / p.n, 'Hz', 3)],
        [`Pressure stability for Δν/ν = ${sci(p.targetY, 2)}`, `${sci(dpTarget, 3)} mbar`],
        ['Optical path change per mbar', si(p.L * 1e-3 * dn1, 'm', 3)],
      ] },
    ];
    const rpCfg = { mirror: S.tnp.mirror, spacer: S.tnp.spacer, Rsp: S.tnp.Rsp, rbore: S.tnp.rbore, rin: p.rin };
    const Pin = P.logspace(p.PinMin, p.PinMax, 120);
    const rp = P.radiationPressure(c, rpCfg, Pin);
    plot('pl-pcirc', [{ x: Pin, y: Pin.map((x) => x * c.circGain), name: 'Circulating power', line: { color: t.s[0], width: 2 } }],
      { legend: false, x: { title: 'Input power (W)', log: true }, y: { title: 'Circulating power (W)', log: true } });
    if (!rp) {
      callout('gasrp', { text: noModeMsg(c) + ' Radiation-pressure results need the spot sizes.', bad: true });
      emptyPlot('pl-rpshift', 'No stable Gaussian mode.');
      emptyPlot('pl-rpnoise', 'No stable Gaussian mode.');
      results('res-gasrp', rows);
      return;
    }
    callout('gasrp', []);
    const rp1 = P.radiationPressure(c, rpCfg, [1e-3]);
    plot('pl-rpshift', [{ x: Pin, y: rp.dnu.map(Math.abs), name: '|Δν|', line: { color: t.s[1], width: 2 } }],
      { legend: false, x: { title: 'Input power (W)', log: true }, y: { title: 'Static frequency shift |Δν| (Hz)', log: true } });
    const thermal = S.tn1 ? S.tn1.asdY.total[0] : null;
    const tr = [
      { x: Pin, y: rp.asdYq, name: 'Quantum (shot noise)', line: { color: t.s[0], width: 2 } },
      { x: Pin, y: rp.asdYrin, name: `Laser RIN ${sci(p.rin, 2)}/√Hz`, line: { color: t.s[1], width: 2, dash: 'dash' } },
    ];
    if (thermal) tr.push({ x: [Pin[0], Pin[Pin.length - 1]], y: [thermal, thermal], name: 'Thermal noise at 1 Hz', line: { color: t.ink, width: 1.5, dash: 'dot' } });
    plot('pl-rpnoise', tr, { x: { title: 'Input power (W)', log: true }, y: { title: 'Fractional frequency noise (1/√Hz)', log: true } });
    rows.push({ title: 'Radiation pressure, laser on resonance', rows: [
      ['Circulating ÷ input power', sig(c.circGain, 4)],
      ['Mirror surface compliance χ₁, χ₂', `${sci(rp.chi1, 3)}, ${sci(rp.chi2, 3)} m/N`],
      ['Static shift per mW of input', si(rp.dnuPerWatt * 1e-3, 'Hz', 3)],
      ['Quantum noise at 1 mW input', `${sci(rp1.asdYq[0], 3)} /√Hz`],
      ['Intensity-noise term at 1 mW input', `${sci(rp1.asdYrin[0], 3)} /√Hz`],
      ['Thermal noise at 1 Hz, for comparison', thermal ? `${sci(thermal, 3)} /√Hz` : '—'],
    ] });
    results('res-gasrp', rows);
  }

  /* ================================================================ tab: PDH */
  function renderPdh() {
    const c = S.cav, p = S.p, t = Plots.theme();
    const cfg = { fm: p.fm * 1e6, Pc: p.Pc * 1e-3, Ps: p.Ps * 1e-3, Ps2: p.Ps2 * 1e-6 };
    const pdh = P.makePdh(c, cfg);
    const G = p.Gpd;
    const span = 2.6 * cfg.fm;
    const grid = denseGrid(-span, span, [0, cfg.fm, -cfg.fm, 2 * cfg.fm, -2 * cfg.fm], c.fwhm, 1600, 161);
    const u = fUnit(span);
    const xs = grid.map((x) => x / u.k);
    plot('pl-err', [{ x: xs, y: grid.map((d) => pdh.error(d) * G), name: 'Error signal', line: { color: t.s[0], width: 1.6 }, hovertemplate: `%{x:.5g} ${u.u}<br>%{y:.4g} V<extra></extra>` }],
      { legend: false, x: { title: `Laser detuning (${u.u})` }, y: { title: 'Error signal (V)' } });
    const z = P.linspace(-3 * c.fwhm, 3 * c.fwhm, 601);
    const uz = fUnit(3 * c.fwhm);
    plot('pl-errzoom', [
      { x: z.map((d) => d / uz.k), y: z.map((d) => pdh.error(d) * G), name: 'Error signal', line: { color: t.s[0], width: 2 } },
      { x: [-c.fwhm / 2 / uz.k, c.fwhm / 2 / uz.k], y: [(-pdh.slope * G * c.fwhm) / 2, (pdh.slope * G * c.fwhm) / 2], name: 'Slope at resonance', line: { color: t.ink, dash: 'dash', width: 1.4 } },
    ], { x: { title: `Laser detuning (${uz.u})` }, y: { title: 'Error signal (V)' } });
    plot('pl-refl', [{ x: xs, y: grid.map((d) => pdh.reflected(d) * 1e3), name: 'Reflected power', line: { color: t.s[1], width: 1.6 }, hovertemplate: `%{x:.5g} ${u.u}<br>%{y:.4g} mW<extra></extra>` }],
      { legend: false, x: { title: `Laser detuning (${u.u})` }, y: { title: 'Reflected power (mW)' } });

    const sim = {
      dt: p.dt * 1e-6, duration: p.dur * 1e-3, seed: p.seed, offset: p.off * 1e3,
      driftRms: p.driftRms * 1e3, driftTau: p.driftTau * 1e-3, jitterRms: p.jitRms * 1e3, jitterTau: p.jitTau * 1e-6,
      Gpd: G, Kact1: p.act1 * 1e6, Kact2: p.act2 * 1e6, piezoBandwidth: p.pzBw * 1e3,
      tOn: p.tOn * 1e-3, holdTime: Math.min(1e-3, (p.dur - p.tOn) * 1e-4), slowEnabled: p.slowOn,
      pid1: { Kp: p.kp1, Ki: p.ki1, Kd: p.kd1, tau: p.tau1 * 1e-6, limMax: p.lim1, limMin: -p.lim1 },
      pid2: { Kp: p.kp2, Ki: p.ki2, Kd: p.kd2, tau: p.tau1 * 1e-5, limMax: p.lim2, limMin: -p.lim2 },
    };
    const r = P.simulateLock(c, cfg, sim);
    const la = P.loopAnalysis(c, pdh.slope * G, sim.Kact1, sim.pid1, sim.dt);
    const tms = new Float64Array(r.n);
    for (let i = 0; i < r.n; i++) tms[i] = i * sim.dt * 1e3;
    const dFree = P.decimate(tms, r.free, 3000), dErr = P.decimate(tms, r.fErr, 3000);
    const dXf = P.decimate(tms, r.xFast, 3000), dXs = P.decimate(tms, r.xSlow, 3000);
    const uf = fUnit(Math.max(...dFree.y.map(Math.abs), ...dErr.y.map(Math.abs)) || 1);
    const sc = (a) => a.map((v) => v / uf.k);
    const lockTr = [
      { x: dFree.t, y: sc(dFree.y), name: 'Free-running', line: { color: t.faint, width: 1 } },
      { x: dXf.t, y: sc(dXf.y), name: 'Current correction', line: { color: t.s[2], width: 1.2, dash: 'dash' } },
    ];
    if (p.slowOn) lockTr.push({ x: dXs.t, y: sc(dXs.y), name: 'Piezo correction', line: { color: t.s[3], width: 1.2, dash: 'dot' } });
    lockTr.push({ x: dErr.t, y: sc(dErr.y), name: 'Laser detuning', line: { color: t.s[1], width: 1.6 } });
    plot('pl-lock', lockTr, {
      x: { title: 'Time (ms)' }, y: { title: `Frequency (${uf.u})` },
      shapes: [vline(p.tOn, t.ink, 'dot'), hline(c.hwhm / uf.k, t.ok, 'dot'), hline(-c.hwhm / uf.k, t.ok, 'dot')],
      annotations: [{ text: 'lock engaged', x: p.tOn, xref: 'x', y: 0.02, yref: 'paper', xanchor: 'left', yanchor: 'bottom', xshift: 4 }],
    });
    const dE = P.decimate(tms, r.err, 3000), dU1 = P.decimate(tms, r.u1, 3000), dU2 = P.decimate(tms, r.u2, 3000);
    const ctrl = [
      { x: dE.t, y: dE.y, name: 'Error signal', line: { color: t.s[0], width: 1.2 } },
      { x: dU1.t, y: dU1.y, name: 'Current-loop output', line: { color: t.s[2], width: 1.4 } },
    ];
    if (p.slowOn) ctrl.push({ x: dU2.t, y: dU2.y, name: 'Piezo-loop output (right)', yaxis: 'y2', line: { color: t.s[3], width: 1.4, dash: 'dot' } });
    plot('pl-ctrl', ctrl, { x: { title: 'Time (ms)' }, y: { title: 'Volts' }, y2: p.slowOn ? { title: 'Piezo volts' } : undefined, shapes: [vline(p.tOn, t.ink, 'dot')] });

    const pow2 = (n) => { let m = 1; while (m * 2 <= n) m *= 2; return m; };
    const psFree = P.welch(r.free, sim.dt, Math.min(16384, pow2(r.n / 4)));
    const start = r.iOn + Math.round((r.acquisition || 0) / sim.dt);
    const seg = r.fErr.subarray(Math.min(start, r.n - 1));
    const psd = [{ x: psFree.f, y: psFree.P.map(Math.sqrt), name: 'Free-running', line: { color: t.faint, width: 1.4 } }];
    if (seg.length >= 2048) {
      const psL = P.welch(seg, sim.dt, Math.min(16384, pow2(seg.length / 4)));
      psd.push({ x: psL.f, y: psL.P.map(Math.sqrt), name: 'Locked', line: { color: t.s[1], width: 1.8 } });
    }
    plot('pl-psd', psd, { x: { title: 'Fourier frequency (Hz)', log: true }, y: { title: 'Frequency noise (Hz/√Hz)', log: true }, shapes: la.ugf ? [vline(la.ugf, t.ink, 'dot')] : [] });
    plot('pl-bode', [
      { x: la.f, y: la.mag, name: '|open-loop gain|', line: { color: t.s[0], width: 2 } },
      { x: la.f, y: la.phase, name: 'Phase (right)', yaxis: 'y2', line: { color: t.s[1], width: 1.4, dash: 'dash' } },
    ], { x: { title: 'Fourier frequency (Hz)', log: true }, y: { title: 'Gain', log: true }, y2: { title: 'Phase (°)', range: [-200, 100] }, shapes: [hline(1, t.ink, 'dot'), ...(la.ugf ? [vline(la.ugf, t.ink, 'dot')] : [])] });

    const beta = P.modulationDepth(cfg.Ps / cfg.Pc);
    const ps2pm = (P.besselJ(2, beta) / P.besselJ(0, beta)) ** 2 * cfg.Pc;
    const pmCls = la.phaseMargin === null ? '' : la.phaseMargin < 30 ? 'bad' : la.phaseMargin < 45 ? 'warn' : 'ok';
    callout('pdh', [
      cfg.fm < 3 * c.fwhm && 'The modulation frequency is not much larger than the linewidth; the sidebands are partly inside the resonance and the slope is reduced.',
      cfg.fm > c.FSR / 2 && 'The modulation frequency exceeds half the free spectral range, so sidebands approach neighbouring longitudinal resonances.',
      !r.locked && { text: 'The laser did not stay within half a linewidth of resonance in the second half of the run. If the trace oscillates, lower the gains; if it wanders off, raise the integral gain or enable the piezo loop.', bad: true },
      la.phaseMargin !== null && la.phaseMargin < 30 && { text: `Phase margin is only ${sig(la.phaseMargin, 3)}°: expect ringing or oscillation.`, bad: true },
    ]);
    results('res-pdh', [
      { title: 'Error signal', rows: [
        ['Modulation depth implied by P<sub>s</sub>/P<sub>c</sub>', `${sig(beta, 3)} rad`],
        ['Second-order sideband for pure phase modulation', si(ps2pm, 'W', 3)],
        ['Slope at resonance', `${si(Math.abs(pdh.slope), 'W/Hz', 3)}, ${sig(Math.abs(pdh.slope) * G * 1e6, 3)} V/MHz`],
        ['Capture range', `±${si(cfg.fm, 'Hz', 4)}`],
        ['Linewidth, cavity pole', `${si(c.fwhm, 'Hz')}, ${si(c.hwhm, 'Hz')}`],
      ] },
      { title: 'Fast loop', rows: [
        ['Unity-gain frequency', la.ugf ? si(la.ugf, 'Hz', 3) : 'no crossing'],
        ['Phase margin', la.phaseMargin !== null ? `${sig(la.phaseMargin, 3)}°` : '—', pmCls],
        ['Feedback sign', 'set automatically from the slope'],
      ] },
      { title: 'Simulated lock', rows: [
        ['Result', r.locked ? 'locked' : 'not locked', r.locked ? 'ok' : 'bad'],
        ['Acquisition after engaging', r.acquisition === null ? '—' : r.acquisition < 2 * sim.dt ? 'immediately' : si(r.acquisition, 's', 3)],
        ['Residual detuning, rms', si(r.lockedStats.rmsAbs, 'Hz', 3)],
        ['Largest residual detuning', si(r.maxAbs, 'Hz', 3)],
        ['Free-running, rms over the same window', si(r.freeStats.rms, 'Hz', 3)],
        ['Suppression', `${sig(r.suppression, 3)}×`],
      ] },
    ]);
  }

  /* ================================================================ tabs */
  const RENDER = { cavity: renderCavity, stability: renderStability, modes: renderModes, noise: renderNoise, expansion: renderExpansion, thermal: renderThermal, gasrp: renderGasRp, pdh: renderPdh, notes: () => {} };
  function renderTab(tab) {
    if (!S.dirty.has(tab)) return;
    S.dirty.delete(tab);
    try { RENDER[tab](); } catch (err) {
      console.error(err);
      callout(tab, { text: `This analysis could not be computed for the current parameters (${err.message}).`, bad: true });
    }
  }
  function activate(tab, focus) {
    for (const tb of TABS) {
      const btn = byId('tab-' + tb), panel = byId('panel-' + tb);
      const on = tb === tab;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      btn.tabIndex = on ? 0 : -1;
      panel.hidden = !on;
    }
    S.tab = tab;
    try { sessionStorage.setItem('fp-sim-tab', tab); } catch (e) { /* ignore */ }
    if (focus) byId('tab-' + tab).focus();
    renderTab(tab);
  }
  function bindTabs() {
    const list = document.querySelector('.tabs');
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[role="tab"]');
      if (btn) activate(btn.id.slice(4));
    });
    list.addEventListener('keydown', (e) => {
      const i = TABS.indexOf(S.tab);
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = TABS.length - 1;
      if (j !== null) { e.preventDefault(); activate(TABS[j], true); }
    });
  }

  /* ================================================================ update loop */
  let timer = 0;
  function changed() { clearTimeout(timer); timer = setTimeout(update, 110); }
  function update() {
    persist();
    writeHash();
    core();
    renderHero();
    S.dirty = new Set(TABS);
    renderTab(S.tab);
  }
  function rerenderAll() { if (!S.cav) return; renderHero(); S.dirty = new Set(TABS); renderTab(S.tab); }

  /* ================================================================ toolbar */
  let toastTimer = 0;
  function toast(msg, undoable) {
    const el = byId('toast'), undo = byId('toast-undo');
    byId('toast-text').textContent = msg;
    undo.hidden = !undoable;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, undoable ? 7000 : 3000);
  }
  function applyParams(np, msg) {
    S.undo = { ...S.p };
    S.p = np;
    syncAll();
    update();
    if (msg) toast(msg, true);
  }
  function bindToolbar() {
    const ex = byId('example');
    ex.innerHTML = '<option value="">Choose…</option>' + EXAMPLES.map((e) => `<option value="${e.key}">${esc(e.label)}</option>`).join('');
    ex.addEventListener('change', () => {
      const e = EXAMPLES.find((x) => x.key === ex.value);
      if (e) applyParams({ ...defaults(), ...e.p }, `Loaded “${e.label}”.`);
      ex.value = '';
    });
    const gp = byId('geom-preset');
    gp.innerHTML = '<option value="">Choose a geometry…</option>' + Object.entries(P.GEOMETRY_PRESETS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
    gp.addEventListener('change', () => {
      const pr = P.GEOMETRY_PRESETS[gp.value];
      gp.value = '';
      if (!pr) return;
      const [r1, r2] = pr.roc(S.p.L);
      const np = { ...S.p, roc1: Number.isFinite(r1) ? +r1.toPrecision(10) : Infinity, roc2: Number.isFinite(r2) ? +r2.toPrecision(10) : Infinity };
      const fr = (v) => (Number.isFinite(v) ? `${sig(v, 5)} mm` : '∞');
      applyParams(np, `Mirror radii set to ${fr(np.roc1)} and ${fr(np.roc2)}.`);
    });
    byId('toast-undo').addEventListener('click', () => {
      if (!S.undo) return;
      const prev = S.undo;
      S.undo = null;
      S.p = prev;
      syncAll();
      update();
      toast('Restored the previous parameters.', false);
    });
    byId('btn-reset').addEventListener('click', () => applyParams(defaults(), 'Parameters reset to the defaults.'));
    byId('btn-share').addEventListener('click', async () => {
      writeHash();
      const url = location.href;
      try { await navigator.clipboard.writeText(url); toast('Link copied. It opens the simulator with these parameters.'); } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = url; document.body.appendChild(ta); ta.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch (e2) { ok = false; }
        ta.remove();
        toast(ok ? 'Link copied.' : 'Copy the address from the browser bar to share these parameters.');
      }
    });
    byId('btn-save').addEventListener('click', () => {
      const data = { app: 'fp-cavity-simulator', version: 1, saved: new Date().toISOString(), parameters: serialise(S.p, false) };
      Plots.download('fp-cavity-parameters.json', JSON.stringify(data, null, 2), 'application/json');
      toast('Parameters saved as fp-cavity-parameters.json.');
    });
    const file = byId('file-open');
    byId('btn-open').addEventListener('click', () => file.click());
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      try {
        const obj = JSON.parse(await f.text());
        applyParams(deserialise(obj.parameters || obj), `Loaded parameters from ${f.name}.`);
      } catch (e) { toast(`${f.name} is not a parameter file saved by this simulator.`); }
    });
    byId('btn-reseed').addEventListener('click', () => { S.p.seed += 1; syncInput('seed'); changed(); });
    const themeLabel = () => { byId('theme-label').textContent = effectiveTheme() === 'dark' ? 'Light' : 'Dark'; };
    byId('btn-theme').addEventListener('click', () => {
      const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('fp-sim-theme', next); } catch (e) { /* ignore */ }
      themeLabel();
      rerenderAll();
    });
    themeLabel();
    if (window.matchMedia) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const onMq = () => { if (!document.documentElement.getAttribute('data-theme')) { themeLabel(); rerenderAll(); } };
      if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
    }
    const rail = byId('rail'), rt = byId('rail-toggle');
    rt.addEventListener('click', () => {
      const open = !rail.classList.contains('open');
      rail.classList.toggle('open', open);
      rt.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    // export buttons under every plot
    for (const pl of $$('.plot')) {
      const tools = document.createElement('div');
      tools.className = 'fig-tools';
      tools.innerHTML = ['png', 'svg', 'csv'].map((k) => `<button type="button" data-k="${k}" aria-label="Download this plot as ${k.toUpperCase()}">${k.toUpperCase()}</button>`).join('');
      pl.after(tools);
      tools.addEventListener('click', (e) => {
        const k = e.target.dataset && e.target.dataset.k;
        if (k) Plots.exportFig(pl, k, 'fp-' + pl.id.replace(/^pl-/, '')).catch((err) => console.error(err));
      });
    }
  }
  function effectiveTheme() {
    const a = document.documentElement.getAttribute('data-theme');
    if (a) return a;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  /* ================================================================ init */
  function init() {
    buildFields();
    bindFields();
    bindTabs();
    bindToolbar();
    const fromHash = readHash();
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(STORE) || 'null'); } catch (e) { stored = null; }
    S.p = deserialise(fromHash || stored || {});
    syncAll();
    let tab = 'cavity';
    try { const s = sessionStorage.getItem('fp-sim-tab'); if (TABS.includes(s)) tab = s; } catch (e) { /* ignore */ }
    core();
    renderHero();
    activate(tab);
    persist();
    writeHash();
    let lastW = 0, rt = 0;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (Math.abs(w - lastW) < 2) return;
      lastW = w;
      clearTimeout(rt);
      rt = setTimeout(renderHero, 80);
    });
    ro.observe(byId('cavity-svg'));
    if (!window.Plotly) callout(S.tab, { text: 'The plotting library did not load. Check that vendor/plotly-cartesian-3.7.0.min.js was uploaded with the site.', bad: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  // exposed for debugging in the console
  window.FPApp = { state: S, update, activate };
})();
