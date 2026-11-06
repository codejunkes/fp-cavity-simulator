/*
 * Unit tests for assets/js/physics.js
 * Run with:  node tests/physics.test.js
 * Expected values come from an independent Python/NumPy implementation and
 * from closed-form identities.
 */
'use strict';
const P = require('../assets/js/physics.js');

let failed = 0, passed = 0;
function close(name, got, want, rtol = 1e-6, atol = 0) {
  const ok = Math.abs(got - want) <= atol + rtol * Math.abs(want);
  if (ok) passed++; else failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: got ${got}, want ${want}`);
}
function truthy(name, cond) {
  if (cond) passed++; else failed++;
  console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}`);
}

// --- parameters stored in the original dt.xlsx -----------------------------
const base = { L: 0.0955, roc1: 0.05, roc2: 0.05, lambda: 1.55e-6, n: 1, R1: 0.9972, R2: 0.9972, loss1: 0, loss2: 0 };
const cav = P.cavity(base);

console.log('\n# Resonator');
close('FSR (Hz)', cav.FSR, 1569594020.9424083);
close('finesse (exact)', cav.finesse, 1120.425111822246);
close('linewidth FWHM (Hz)', cav.fwhm, 1400891.5048232358);
close('g1 g2', cav.g, 0.8281, 1e-12);
close('det(ABCD) = 1', cav.abcdDet, 1, 1e-12);
close('ABCD C element', cav.abcd[1][0], 72.8, 1e-9);
close('half trace = 2 g1 g2 − 1', cav.halfTrace, 2 * cav.g - 1, 1e-12);
close('lossless on resonance: T + R = 1', cav.transRes + cav.reflRes, 1, 1e-12);

console.log('\n# Gaussian mode');
close('w1 (m)', cav.w1, 0.0003371115476201755);
close('w0 (m)', cav.w0, 7.151215840155538e-05);
close('waist position z1 (m)', cav.z1, 0.04775);
close('Rayleigh range (m)', cav.zR, 0.010365206220813944);
close('Gouy phase, g<0 branch (rad)', cav.gouy, 2.7140803886449234);
close('transverse mode spacing (Hz)', cav.tms, 1356001499.9100392);
const prof = P.beamProfile(cav, 101);
close('w(z=0) equals w1', prof.w[0], cav.w1, 1e-12);
close('w(z=L) equals w2', prof.w[100], cav.w2, 1e-12);

console.log('\n# Stability classes of the corrected presets');
const L0 = 0.1;
const cls = (r1, r2) => P.cavity({ ...base, L: L0, roc1: r1, roc2: r2 }).stability;
truthy('plano–concave R = 2L is stable', cls(2 * L0, Infinity) === 'stable');
truthy('hemispherical R = L is marginal', cls(L0, Infinity) === 'marginal');
truthy('confocal is marginal', cls(L0, L0) === 'marginal');
truthy('concentric is marginal', cls(L0 / 2, L0 / 2) === 'marginal');
truthy('plane–parallel is marginal', cls(Infinity, Infinity) === 'marginal');
truthy('original "plane-concave" R = L/2 is unstable', cls(L0 / 2, Infinity) === 'unstable');
truthy('convex–concave R1 = −L, R2 = 1.5L stable', cls(-L0, 1.5 * L0) === 'stable');
for (const [key, pr] of Object.entries(P.GEOMETRY_PRESETS)) {
  const [r1, r2] = pr.roc(L0);
  const st = cls(r1, r2);
  truthy(`preset ${key} → ${st}`, pr.label.includes('marginal') ? st === 'marginal' : st === 'stable');
}
const iv = P.stableLengthIntervals(0.05, 0.05, 0.3);
truthy('stable lengths for R1 = R2 = 50 mm: (0, 0.1) m', iv.length === 1 && Math.abs(iv[0][1] - 0.1) < 1e-12);
const iv2 = P.stableLengthIntervals(1, Infinity, 3);
truthy('plano–concave R = 1 m stable for 0 < L < 1 m', iv2.length === 1 && Math.abs(iv2[0][1] - 1) < 1e-12);

console.log('\n# Sensitivity without cancellation');
const sens = P.gSensitivity(cav, [1e-15], [1e-15]);
close('Δg for ΔL = 1e-15 m equals dg/dL·ΔL', sens.byL[0], sens.dgdL * 1e-15, 1e-9);

console.log('\n# Higher-order modes');
const hom = P.homSpectrum(cav, 10);
const homRef = [[7, 74446373.71582411, 8.917425733357492e-05], [1, -213592521.0323692, 1.1433862340030216e-05], [4, 715223936.8129315, 2.0041112921149435e-06]];
for (const [N, off, rel] of homRef) {
  close(`order ${N} offset (Hz)`, hom[N].offsetHz, off, 1e-9);
  close(`order ${N} relative transmission`, hom[N].rel, rel, 1e-9);
}

console.log('\n# Brownian thermal noise (ULE spacer, FS mirrors, dt.xlsx materials)');
const tn = P.thermalNoise(cav, {
  T: 300, Rsp: 0.05, rbore: 0.0075,
  spacer: { E: 67.7e9, sigma: 0.18, phi: 1 / 62500 },
  mirror: { E: 73.1e9, sigma: 0.17, phi: 1e-6 },
  coatPhi: 1 / 2500, coatD: 5.24e-6,
}, [1]);
close('S_x spacer at 1 Hz', tn.Sx.spacer[0], 7.751980980259226e-36);
close('S_x substrates at 1 Hz', tn.Sx.substrates[0], 1.1724995035204267e-34);
close('S_x coatings at 1 Hz', tn.Sx.coatings[0], 6.541106480528749e-34);
close('flicker floor σ_y', tn.floor.total, 3.441315297128742e-16);

console.log('\n# Thermal expansion (Legero model)');
const cm = P.cteModel(
  { model: 'zero', T0: 302.97, a: 2.4e-9, b: 0 },
  { model: 'linear', alpha20: 500e-9, slope: 2.2e-9 },
  0.48, 0.0127, 0.0955,
);
close('effective zero-crossing temperature (K)', cm.T0eff, 274.92558697768936, 1e-10);
close('α_eff vanishes at T0eff', cm.alphaEff(cm.T0eff), 0, 0, 1e-20);
const ule = P.cteModel({ model: 'zero', T0: 300, a: 2e-9, b: 0 }, { model: 'zero', T0: 300, a: 2e-9, b: 0 }, 0.4, 0.0127, 0.1);
close('all-ULE ΔL/L at T0 + 1 K equals a/2', ule.fracLen(301, 300), 1e-9, 1e-12);

console.log('\n# Residual gas');
close('N2 refractivity at STP', P.gasRefractivity(1.7403e-30, 101325, 273.15), 0.00029378939401605923, 1e-9);
close('Δn for 1e-9 mbar, α = 1.4 Å³, 302.97 K', P.gasRefractivity(1.4e-30, 1e-7, 302.97), 2.1029308610556738e-16, 1e-9);

console.log('\n# Thermal shields (IUCAA cuboid set, radiation only)');
const A = (a, b, c) => 2 * (a * b + b * c + a * c);
const shield = {
  Tmean: 294.2, useRadiation: true, useConduction: false, includeCavity: false,
  A1in: A(0.63, 0.23, 0.225), e1in: 0.04,
  A2out: A(0.60, 0.20, 0.205), e2out: 0.04, A2in: A(0.58, 0.18, 0.185), e2in: 0.04,
  A3out: A(0.55, 0.15, 0.165), e3out: 0.04,
  m2: 14.27, c2: 900, m3: 9.78, c3: 900,
  n12: 1, k12: 0.19, a12: 7.85e-5, l12: 0.01, n23: 1, k23: 0.19, a23: 7.85e-5, l23: 0.01,
};
const net = P.shieldNetwork(shield);
close('τ(P1→P2) radiation (s)', net.stages[0].tau, 176724.88553918622, 1e-9);
close('τ(P2→P3) radiation (s)', net.stages[1].tau, 170855.7067891477, 1e-9);
const resp = P.networkResponse(net, [2 * Math.PI / (50 * 3600)])[0];
close('P3 amplitude, 50 h period (coupled model)', resp[1].amp, 0.02541092678488166, 1e-9);
close('P2 amplitude, 50 h period (coupled model)', resp[0].amp, 0.153666091092529, 1e-9);
const stepNet = P.simulateNetwork(net, 3000, 4000, () => 1);
close('step response settles to 1 K', stepNet.X[1][stepNet.X[1].length - 1], 1, 1e-3);
const ev = P.networkEigenvalues(net);
truthy('network eigenvalues are real and negative', ev.every((v) => v < 0));

console.log('\n# PDH');
const pdh = P.makePdh(cav, { fm: 35.15e6, Pc: 0.016, Ps: 0.00072, Ps2: 0 });
close('discriminator slope at resonance (W/Hz)', pdh.slope, -1.9374904408585426e-08, 1e-6);
close('Black approximation −8√(PcPs)/δν', pdh.slope, -8 * Math.sqrt(0.016 * 0.00072) / cav.fwhm, 1e-3);
close('error signal is odd', pdh.error(3e5) + pdh.error(-3e5), 0, 0, 1e-12);
close('modulation depth from J1²/J0²', P.modulationDepth((P.besselJ(1, 0.5) / P.besselJ(0, 0.5)) ** 2), 0.5, 1e-9);

console.log('\n# Special functions & numerics');
close('J0(1)', P.besselJ(0, 1), 0.7651976865579666, 1e-12);
close('J1(1)', P.besselJ(1, 1), 0.44005058574493355, 1e-12);
close('J2(1)', P.besselJ(2, 1), 0.11490348493190049, 1e-12);
const R = P.expm([[0, 1], [-1, 0]]);
close('expm rotation cos(1)', R[0][0], Math.cos(1), 1e-12);
close('expm rotation sin(1)', R[0][1], Math.sin(1), 1e-12);
const rng = P.makeRng(7), x = new Float64Array(1 << 17), dtw = 1e-3;
for (let i = 0; i < x.length; i++) x[i] = rng.normal();
const ps = P.welch(x, dtw, 2048);
const mean = ps.P.slice(10, -10).reduce((a, b) => a + b, 0) / (ps.P.length - 20);
close('Welch PSD of unit white noise = 2·dt', mean, 2 * dtw, 0.03);

console.log('\n# PID');
const pid = P.makePid({ Kp: 0, Ki: 0, Kd: 2, tau: 1e-6, T: 5e-7, limMax: 1e9, limMin: -1e9 });
let out = 0;
for (let k = 0; k < 200; k++) out = pid.update(0, k * 1e-3);
close('derivative of a ramp → −Kd·slope', out, -2 * 1e-3 / 5e-7, 1e-6);

console.log('\n# Lock simulation with default settings');
const lock = P.simulateLock(cav, { fm: 35.15e6, Pc: 0.016, Ps: 0.00072, Ps2: 5e-6 }, {
  dt: 5e-7, duration: 0.05, seed: 1, offset: 3e5, driftRms: 6e5, driftTau: 0.02,
  jitterRms: 2e4, jitterTau: 5e-6, Gpd: 1000, Kact1: 1e6, Kact2: 1e6, piezoBandwidth: 2e3,
  tOn: 0.005, holdTime: 1e-3, slowEnabled: true,
  pid1: { Kp: 0.01, Ki: 3e4, Kd: 0, tau: 1e-6, limMax: 10, limMin: -10 },
  pid2: { Kp: 0, Ki: 200, Kd: 0, tau: 1e-6, limMax: 1000, limMin: -1000 },
});
truthy(`locks (acquisition ${lock.acquisition}s, residual rms ${lock.lockedStats.rmsAbs.toFixed(1)} Hz)`, lock.locked);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
