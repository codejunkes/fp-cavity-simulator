# Corrections to the MATLAB version

Numbers refer to the parameters stored in the original `dt.xlsx` (L = 95.5 mm, R₁ = R₂ = 50 mm, ℛ₁ = ℛ₂ = 0.9972, λ = 1550 nm, ULE spacer with fused-silica mirrors) unless stated otherwise. Each correction was checked numerically against an independent implementation and, where relevant, the cited paper.

## Resonator and output panel (`Output_parameters.m`, `appDataOut.mlapp`, `gui_fp.mlapp`)

| # | Original | Problem | Now |
|---|---|---|---|
| 1 | `FSR = refractive*c/(2*L)` (also in `find_finesse`, the HOM scripts and `fp_cavity.m`) | Refractive index in the numerator | FSR = c/(2nL) |
| 2 | `r1 = dt.Value(28)` (power ℛ) inserted where an amplitude reflectivity is required | Finesse 560 instead of 1120; linewidth 2.80 MHz instead of 1.40 MHz | r = √ℛ; exact 𝓕 = π / [2 arcsin((1 − r₁r₂)/(2√(r₁r₂)))] |
| 3 | `M_21 = -2*(-2L + ROC1 + R2)/(ROC1*ROC2)` with `R2` = spacer bore radius | M₂₁ = 106.8 m⁻¹ instead of 72.8 m⁻¹; det M = 6.91 instead of 1 | Matrix product M(R₁)·P(L)·M(R₂)·P(L) |
| 4 | Flat mirrors: `M_11((1/(ROC1*ROC2)) == 0) = 0` | True limit is 1 − 4L/R₁ (or 1 for plane–plane) | Curvature 1/R = 0, no Inf arithmetic |
| 5 | `m = abs(trace(M))/2; g = (m+1)/2` | Wrong whenever g₁g₂ < ½ (confocal reports g = 1) | (A + D)/2 = 2g₁g₂ − 1 without abs |
| 6 | `FSR_angle = FSR/cos(0.1)` | Tilted plane-etalon formula with a hard-coded tilt; not a property of this cavity | Removed |
| 7 | Finesse stored separately in `dt.xlsx` (2092.8) | Inconsistent with the stored reflectivities (0.9972 → 1120) | Always derived from the mirrors |
| 8 | Cavity-type presets | "Hemi-spherical" used R = 2L (hemispherical is R = L); "Plane-concave" used R = L/2, which is unstable (g₁g₂ = −1); "Concave-concave" (L/2, L) sat on the stability boundary; "Spherical-symmetric" showed the confocal picture | Presets follow the standard definitions; marginal ones are labelled; a stable asymmetric concave pair replaces the boundary case |
| 9 | Saving `Inf` to Excel with `if ROC1 == inf … elseif ROC2 == inf` | Only one flat mirror could be stored | JSON with explicit `inf` |
| 10 | `CloseRequestFcn` bound to `EditField12ValueChanged` | The window could not be closed normally | Not applicable to the web version |
| 11 | `g_vs_beamsize_other_parameters.m`: divergence √((λL/π)·…) | Units of metres instead of radians; should be λ/(πw₀) | θ = λ/(πnw₀) |
| 12 | Same file: waist position with `abs()` in the denominator | Wrong sign when g₁, g₂ < 0 | z₁ = L g₂(1 − g₁)/(g₁ + g₂ − 2g₁g₂) |

## Stability (`stability_gfactor.m`, `R_L_stability.m`)

| # | Problem | Now |
|---|---|---|
| 13 | The stability diagram drew only fixed reference points, never the user's cavity | Your (g₁, g₂) point and its locus as L changes |
| 14 | Hard-coded L₀ = 0.485 m, offset `g - 0.515`, and R₂ = ∞ in the ΔR plot | Uses the current parameters |
| 15 | Δg obtained by subtracting numbers equal to 1 part in 10¹⁶; negative results vanished from the log–log plot (the ΔL panel was empty for the stored cavity) | Exact closed form −ΔL(1/R₁ + 1/R₂) + (2LΔL + ΔL²)/(R₁R₂), plotted as |Δ(g₁g₂)| |

## Transverse modes (`HOm_4_power_length.m`, `HOM_frequency_all_modesv2.m`, `HOMs_vs_power.m`, `g_factor_vs_HOMs.m`, `hermite.m`, `hom_waist_beam_size.m`, `HOM_intensity*.m`, `individual_hermite_length_change.m`)

| # | Problem | Now |
|---|---|---|
| 16 | Gouy phase `acos(sqrt(g))` is the wrong branch for g₁, g₂ < 0; for the stored near-concentric cavity it gave 0.43 rad instead of 2.71 rad, mirroring every mode frequency inside the FSR | ψ = arccos(sgn(g₁)√(g₁g₂)) |
| 17 | Frequencies folded by adding −1 … −6 FSR; orders more than 7 FSR away were lost | Proper modulo FSR |
| 18 | Stale stored finesse (2092.8) used instead of the mirrors' value (1120) | Derived finesse; exact coefficient of finesse 4r₁r₂/(1 − r₁r₂)² |
| 19 | `HOM_frequency_all_modesv2.m` read `matlab\sankalpa\dt.xlsx` | Hard-coded Windows path removed |
| 20 | `HOm_4_power_length.m`: "ν(m+n=4) − ν(m+n=0)" plotted FSR − offset without reducing modulo the FSR; wrong, and negative (invisible on the log axis) for many geometries | Offset reduced into (−FSR/2, FSR/2] |
| 21 | Transmission and "suppression factor" in `HOMs_vs_power.m` are the same expression plotted twice | One quantity |
| 22 | `hermite.m`: hard-coded intensity weights; normalisation multiplied instead of divided by √(2ᵐ m! w₀) | Physical HGₘₙ intensity with the real spot size |
| 23 | `hom_waist_beam_size.m`: hard-coded 381/438 µm; axis labelled "2m+n" | Computed w√(N + 1) with N = m + n |
| 24 | `HOM_intensity_change_length_change.m`, `individual_hermite_length_change.m`: plotted typed-in result tables | Computed live |
| 25 | `linewidth = c/(2nLF)` next to `FSR = nc/(2L)`: inconsistent when n ≠ 1 | Consistent definitions |

## Brownian thermal noise (`brownian_different_noises.m`, `bnoise_for_different_material.m`)

| # | Problem | Now |
|---|---|---|
| 26 | "Fractional frequency instability" = √(2 ln2 · S_y(f)), missing the factor f. It fell as 1/√f and matched the true flat floor only at 1 Hz (3.4 × 10⁻¹⁵ at 0.01 Hz and 3.4 × 10⁻¹⁷ at 100 Hz instead of 3.4 × 10⁻¹⁶ everywhere). `fp_length.m` had the correct form | σ_y = √(2 ln2 · f · S_y(f)) (Numata 2004; optical-clock guidelines eq. 1.6); spectra shown as ASDs |
| 27 | Legend fixed to "R₁ = 1 m & R₂ = ∞" | Removed |

The spacer, substrate and coating formulas themselves were correct (spacer as corrected by Kessler et al. 2012, including the bore).

## Thermal expansion (`cte_cavity.m`, `cte_cavity_test.m`, `CTE_matrix.m`, `dfdt_matrix.m`)

| # | Problem | Now |
|---|---|---|
| 28 | `frac_length = a_eff.*dt`; for α = a(T − T₀) the length change is the integral a(T − T₀)²/2, so the plot was 2× too large (2.37 × 10⁻⁹ instead of 1.19 × 10⁻⁹ at 1 K) | Exact integral of the polynomial CTE models |
| 29 | Fused-silica mirrors modelled as `2.2e-9*dt`, i.e. zero CTE at the ULE zero crossing. The ≈500 × 10⁻⁹/K offset is what shifts the cavity zero crossing (Legero et al. 2010); for the stored geometry with δ = 0.48 the shift is −28 K (29.8 °C → 1.8 °C) | α_FS = 500 × 10⁻⁹/K + 2.2 × 10⁻⁹/K² (T − 20 °C) |
| 30 | `cte_cavity_test.m` used constant CTEs instead, so the two scripts disagreed | One model for every plot |
| 31 | `freq_change = freq*a_eff/(1 + a_eff*T0)`; the denominator has no basis (T₀ is an absolute temperature) and the sign was dropped | dν/dT = −ν α_eff(T) |
| 32 | g change used new L for g₁, old L for g₂, minus a hard-coded 0.515 | Analytic d(g₁g₂)/dT |
| 33 | x axis "Temperature (K)" showed T − T₀ | Absolute temperature in °C |
| 34 | `CTE_matrix.m`: CTE and Q legends swapped; axis "Mirror material" for a generic list | Corrected labels |
| 35 | `dfdt_matrix.m`: typed-in table valid only for L = 0.485 m at 1064 nm | Computed for the current cavity and operating temperature |

δ = 0.48 is kept as the default: Legero et al. find δ → 0.49 for wide spacers, which matches the 100 mm spacer diameter in `dt.xlsx`. It is ≈0.37 for a 32 mm spacer.

## Temperature control (`thermal_shield_*.m`, `Thermal_shield_cylinder_radiation_sensitivity*.m`)

| # | Problem | Now |
|---|---|---|
| 36 | `thermal_shield_combined.m` (marked "not correct" in the file) averaged the radiation-only and conduction-only responses; parallel heat paths add their conductances | G = G_rad + G_cond for each stage |
| 37 | Same file: second radiative stage used areas A₂, A₃ instead of A₃, A₄; heat capacity 210 J/(kg·K) instead of 900; contact length 5 mm instead of 10 mm | Consistent single parameter set |
| 38 | P1 → P3 oscillation modelled as one pole with τ₁ + τ₂. For a 50 h period this predicts ±0.082 K on P3 instead of ±0.025 K (3.2× too pessimistic) | Exact network with back-action, solved with the matrix exponential; periodic response from (iωI − A)⁻¹B |
| 39 | Time constants typed in (`tau_1 = 1.76736e5`) | Computed from the geometry (reproduces 1.767 × 10⁵ s for the cuboid shields) |
| 40 | x axis "fluctuation period (hrs)" showed elapsed time; absolute temperatures on a log axis | Labelled time axes, linear temperatures |

New: the cavity can be included as the innermost thermal mass, and its temperature is converted to frequency with the thermal-expansion model.

## Residual gas and radiation pressure (`length_vs_presseure.m`, `radiation_pressure.m`, `cavity_trans_refl_circu.m`)

| # | Problem | Now |
|---|---|---|
| 41 | mbar converted to Pa twice, and α′p/(2k_BT) used instead of 2πα′p/(k_BT): 7.96× too large | Δn = 2πα′Δp/(k_BT); checked against the refractivity of N₂ at STP (2.94 × 10⁻⁴) |
| 42 | Temperature hard-coded to 302.97 K while `dt.xlsx` T was read and ignored; α′ described as "polarizability of vacuum" | Gas temperature from the inputs; polarisability of the selected residual gas |
| 43 | Reflected and transmitted powers computed as \|E\| instead of \|E\|² | \|E\|² |
| 44 | Mirrors hard-coded to ℛ = 0.9999791, T = 5 ppm (𝓕 ≈ 150 000) while the noise formula used the stored finesse 2092.8 | One set of mirror parameters for everything |
| 45 | Beam radius fixed at 490 µm | Spot sizes from the cavity mode |
| 46 | White radiation-pressure noise converted with the flicker-noise Allan formula | Reported as amplitude spectral density |

The radiation-pressure model is now derived explicitly: half-space compliance (1 − σ²)/(√π E w) under a Gaussian load, forces (1 + ℛ)P/c on each mirror plus spacer stretch, and shot noise of the circulating power 2hνP_circ(T₁ + T₂ + losses)/(1 − r₁r₂)². Photothermal effects are not included.

## PDH locking (`PDH_Check_Final.m`)

| # | Problem | Now |
|---|---|---|
| 47 | `r = sqrt(R1*R2)` (a power product) used as the amplitude reflectivity in Black's F(ω); the simulated cavity had finesse 560 while the script reported 1120 | General F(ω) = [−r₁ + r₂(ℛ₁ + T₁)e^{iφ}]/(1 − r₁r₂e^{iφ}), unequal and lossy mirrors allowed |
| 48 | "Integrator" = 40-sample moving average × K_i, so no steady-state correction | Trapezoidal integrator with clamping anti-windup |
| 49 | Derivative used the history arrays at the current index (always zero), was never added to the output (K_d and τ had no effect), and copied the filter sign error of the C template it came from (pole at z = −0.6, wrong steady state) | Band-limited derivative on the measurement with the correct sign, included in the output |
| 50 | Laser noise in Hz added to an angular frequency in rad/s | Consistent units (Hz) |
| 51 | Secondary sideband power read but unused; F(ω ± 2Ω) computed and discarded | Second-order sideband beat terms included in the error signal |
| 52 | "Lock bandwidth" was the peak-to-peak frequency excursion | Unity-gain frequency and phase margin from the discrete open-loop gain; residual rms, peak and suppression reported separately |
| 53 | Axis "Time (µs)" showed sample numbers; `T(j) = T(j) + 0.01` had no effect | Time in ms |
| 54 | Noise up-sampled ×100 but only the first 10⁵ samples (1 % of the record) used; `awgn` needs the Communications Toolbox and its output was unused | Seeded Ornstein–Uhlenbeck drift and jitter generated in the browser |
| 55 | Second (piezo) PID commented out; enabling it in parallel on the same error would make the two integrators fight | Optional slow loop that offloads the fast actuator, with piezo bandwidth |
| 56 | Quasi-static discriminator with no cavity response | Cavity pole at δν/2 included in the simulation and the loop analysis |

Because the gains now have physical units (controller volts per detector volt, actuator Hz per volt), the default PID values differ from the old ones.

## Data file

`dt.xlsx` row 18 is named `Refractive` but holds the mirror radius (0.0127 m); row 21 `refractive` is the refractive index. The web version names every parameter explicitly.
