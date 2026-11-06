# Fabry–Pérot cavity simulator

A browser-based design and noise-budget tool for Fabry–Pérot optical reference cavities, converted from the MATLAB application of the Precision and Quantum Measurement (PQM) lab, IUCAA, Pune, with the physics reviewed and corrected.

Everything runs client-side in JavaScript. There is no build step and no server code, so the folder can be published as-is on GitHub Pages or opened directly from disk.

## What it calculates

| Tab | Contents |
|---|---|
| Cavity | FSR, exact finesse, linewidth, Q, storage time, on-resonance transmission/reflection/circulating power, TEM₀₀ waist and spot sizes, Gouy phase, round-trip ray matrix, Airy response, beam radius along the cavity |
| Stability | g₁–g₂ diagram with your cavity and its locus as L changes, stable length ranges, mode size versus length, sensitivity of g₁g₂ |
| Transverse modes | Hermite–Gauss mode spectrum within one FSR, suppression by order, suppression versus g₁g₂, order-N resonance versus length, HGₘₙ intensity patterns, clipping by bore and mirror |
| Thermal noise | Brownian noise of spacer, substrates and coatings; flicker floor of the Allan deviation; all material pairs; floor versus length |
| Thermal expansion | Effective CTE of the bonded mirror–spacer assembly (Legero et al.), zero-crossing temperature, frequency versus temperature, dν/dT for material pairs |
| Temperature control | Radiative and conductive shield network P1 → P2 → P3 → cavity: step response, attenuation of periodic disturbances, resulting cavity frequency excursion |
| Pressure effects | Residual-gas refractive index; static radiation-pressure shift; quantum and intensity-noise radiation-pressure noise |
| PDH locking | Pound–Drever–Hall error signal (with second-order sidebands), loop gain and phase margin, time-domain lock simulation with fast current loop and slow piezo offload loop, frequency-noise spectra |

All results update while you type. Parameters can be shared as a link, saved and loaded as JSON (this replaces `dt.xlsx`), and every plot exports to PNG, SVG and CSV.

## Publish on GitHub Pages

1. Create a repository on GitHub, for example `fp-cavity-simulator`.
2. Upload the **contents** of this folder so that `index.html` sits at the repository root, next to `assets/` and `vendor/`. On github.com use *Add file → Upload files* and drag the files and folders in. The empty `.nojekyll` file is optional.
3. Open *Settings → Pages*. Under *Build and deployment* choose *Deploy from a branch*, select the `main` branch and the `/ (root)` folder, and save.
4. After a minute or two the site is live at `https://<your-user-name>.github.io/fp-cavity-simulator/`.

With git instead of the web upload:

```bash
cd fp-cavity-simulator
git init
git add .
git commit -m "Fabry–Pérot cavity simulator"
git branch -M main
git remote add origin https://github.com/<your-user-name>/fp-cavity-simulator.git
git push -u origin main
```

## Run locally

Double-click `index.html`; it works from disk. Alternatively serve the folder:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

The plotting library (Plotly.js 3.7.0, MIT licence) is included in `vendor/`, so the simulator also works offline. Only the Barlow web font is fetched from Google Fonts; without a connection the page falls back to a system font.

## Project layout

```
index.html                    page structure, method notes, references
assets/css/style.css          light and dark themes, responsive layout
assets/js/physics.js          physics engine: pure functions, SI units, no DOM
assets/js/plots.js            Plotly wrapper: theming and PNG/SVG/CSV export
assets/js/hero.js             live cavity schematic
assets/js/app.js              parameters, validation, persistence, tab renderers
assets/img/                   IUCAA and PQM logos
vendor/                       Plotly.js 3.7.0 (cartesian bundle) and its licence
tests/physics.test.js         unit tests for the physics engine
CORRECTIONS.md                every change made to the original physics, by file
```

## Tests

The physics engine is checked against an independent NumPy implementation and against closed-form identities (det M = 1, energy conservation on resonance, Bessel values, matrix exponential, Welch PSD normalisation, PID derivative, lock acquisition):

```bash
node tests/physics.test.js
```

## Conventions

- Radius of curvature R > 0 for a mirror concave towards the cavity, R < 0 for convex, `inf` for flat; g = 1 − L/R.
- ℛ is power reflectivity; mirror loss (absorption plus scatter) is entered separately, so T = 1 − ℛ − loss.
- Beam radii are 1/e² intensity radii; spectral densities are one-sided.
- Material properties are typical literature and datasheet values and can be edited.

## What was corrected

The MATLAB code contained errors in the finesse, the free spectral range, the round-trip ray matrix, two cavity presets, the Gouy phase for g < 0, the thermal-noise Allan floor, the thermal-expansion integral and mirror CTE, the thermal-shield model, the residual-gas refractivity and the PDH simulation. `CORRECTIONS.md` lists each one with the file, the original expression and the effect on the default cavity.

## References

1. A. E. Siegman, *Lasers* (University Science Books, 1986), ch. 19–21.
2. E. D. Black, Am. J. Phys. **69**, 79 (2001).
3. K. Numata, A. Kemery, J. Camp, Phys. Rev. Lett. **93**, 250602 (2004).
4. T. Kessler, T. Legero, U. Sterr, J. Opt. Soc. Am. B **29**, 178 (2012).
5. T. Legero, T. Kessler, U. Sterr, J. Opt. Soc. Am. B **27**, 914 (2010).
6. Y. Levin, Phys. Rev. D **57**, 659 (1998).

## Credits

Precision and Quantum Measurement lab, IUCAA, Pune, supported by the Quantum Enabled Science and Technology (QuEST) programme of DST, India. The PDH model builds on the MATLAB script by Suyash Gaikwad (supervisors Dr Staley Johnson and Dr Subhadeep De).

No licence file is included; add the licence your group prefers before publishing. Plotly.js is distributed under the MIT licence (`vendor/PLOTLY-LICENSE`).
