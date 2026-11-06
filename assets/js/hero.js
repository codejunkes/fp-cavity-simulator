/*
 * Fabry–Pérot Cavity Simulator — live cavity schematic (SVG)
 * The mechanics are schematic; the beam envelope w(z) is drawn to scale
 * relative to the bore (magnified by a stated factor when it is small).
 */
(function (root) {
  'use strict';

  /** Approximate sRGB colour of a visible wavelength (D. Bruton's piecewise fit). */
  function visibleRGB(nm) {
    let r = 0, g = 0, b = 0;
    if (nm < 440) { r = -(nm - 440) / 60; b = 1; }
    else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
    else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
    else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
    else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
    else { r = 1; }
    let f = 1;
    if (nm < 420) f = 0.35 + (0.65 * (nm - 380)) / 40;
    else if (nm > 700) f = 0.35 + (0.65 * (750 - nm)) / 50;
    const c = (v) => Math.round(255 * Math.pow(Math.max(0, v * f), 0.8));
    return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
  }

  function beamColour(nm) {
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    if (nm > 750) return { colour: css('--beam-ir'), band: 'infrared' };
    if (nm < 380) return { colour: css('--beam-uv'), band: 'ultraviolet' };
    return { colour: visibleRGB(nm), band: 'visible' };
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const niceFactor = (k) => {
    if (k <= 1) return 1;
    const steps = [1, 2, 5];
    const e = Math.floor(Math.log10(k));
    let best = 1;
    for (let p = 0; p <= e; p++) for (const s of steps) { const v = s * 10 ** p; if (v <= k) best = v; }
    return best;
  };

  /**
   * @param {SVGSVGElement} svg
   * @param {object} d  {cav, L, roc1, roc2, Rm, Rsp, rbore, lambdaNm, fmt:{len, mm}, width}
   */
  function draw(svg, d) {
    const W = Math.max(330, Math.min(1100, d.width || 1000));
    const narrow = W < 640;
    const H = narrow ? 250 : 290;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const y0 = H * 0.46;
    const x1 = W * (narrow ? 0.15 : 0.165), x2 = W * (narrow ? 0.85 : 0.835);
    const hSp = H * 0.33, hMir = H * 0.215, hBore = H * 0.135;
    const tMir = narrow ? 18 : 30;
    const cav = d.cav;
    const { colour, band } = beamColour(d.lambdaNm);

    // visual sag: sign follows the radius of curvature; magnitude grows with Rm/|R|
    const sag = (roc) => {
      if (!Number.isFinite(roc)) return 0;
      const x = Math.min(1, d.Rm / Math.abs(roc));
      return Math.sign(roc) * Math.max(3, (narrow ? 14 : 22) * Math.sqrt(x));
    };
    const s1 = sag(d.roc1), s2 = sag(d.roc2);
    const parts = [];

    parts.push(`<defs>
      <linearGradient id="beamGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${colour}" stop-opacity="0.12"/>
        <stop offset="0.5" stop-color="${colour}" stop-opacity="0.85"/>
        <stop offset="1" stop-color="${colour}" stop-opacity="0.12"/>
      </linearGradient>
    </defs>`);

    // spacer (cut-away: glass above and below the bore)
    const spL = x1 + Math.max(0, s1), spR = x2 - Math.max(0, s2);
    parts.push(`<rect class="spacer" x="${spL}" y="${y0 - hSp}" width="${spR - spL}" height="${hSp - hBore}" rx="2"/>`);
    parts.push(`<rect class="spacer" x="${spL}" y="${y0 + hBore}" width="${spR - spL}" height="${hSp - hBore}" rx="2"/>`);
    parts.push(`<line class="bore" x1="${spL}" y1="${y0 - hBore}" x2="${spR}" y2="${y0 - hBore}"/>`);
    parts.push(`<line class="bore" x1="${spL}" y1="${y0 + hBore}" x2="${spR}" y2="${y0 + hBore}"/>`);
    parts.push(`<line class="axis" x1="${x1 - tMir - 20}" y1="${y0}" x2="${x2 + tMir + 20}" y2="${y0}"/>`);

    // mirrors: flat back, curved reflective face (quadratic Bézier = parabola)
    const mirror = (xf, s, dir) => {
      // dir = +1 for M1 (face looks right), −1 for M2 (face looks left)
      const xb = xf - dir * tMir;
      const rim = xf + dir * s;
      const ctrl = xf - dir * s;
      const path = `M ${xb} ${y0 - hMir} L ${rim} ${y0 - hMir} Q ${ctrl} ${y0} ${rim} ${y0 + hMir} L ${xb} ${y0 + hMir} Z`;
      const face = `M ${rim} ${y0 - hMir} Q ${ctrl} ${y0} ${rim} ${y0 + hMir}`;
      return `<path class="mirror" d="${path}"/><path class="coating" d="${face}" stroke="${colour}" stroke-opacity="0.9"/>`;
    };
    parts.push(mirror(x1, s1, 1), mirror(x2, s2, -1));

    // labels for mirrors
    const rocText = (r, i) => {
      if (!Number.isFinite(r)) return `R${i} = ∞, flat`;
      return `R${i} = ${d.fmt.mm(r)}${r < 0 ? ', convex' : ''}`;
    };
    const yTop = y0 - hSp - 10;
    parts.push(`<text class="t-strong" x="${x1 - tMir / 2}" y="${yTop}" text-anchor="middle">M₁</text>`);
    parts.push(`<text class="t-strong" x="${x2 + tMir / 2}" y="${yTop}" text-anchor="middle">M₂</text>`);
    const yRoc = y0 + hSp + 18;
    parts.push(`<text class="t-small" x="${x1 - tMir}" y="${yRoc}" text-anchor="start">${esc(rocText(d.roc1, '₁'))}</text>`);
    parts.push(`<text class="t-small" x="${x2 + tMir}" y="${yRoc}" text-anchor="end">${esc(rocText(d.roc2, '₂'))}</text>`);

    // length dimension
    const yDim = y0 + hSp + (narrow ? 38 : 40);
    parts.push(`<path class="dim" d="M ${x1} ${yDim - 5} V ${yDim + 5} M ${x2} ${yDim - 5} V ${yDim + 5} M ${x1} ${yDim} H ${x2}"/>`);
    const lText = `L = ${d.fmt.mm(d.L)}`;
    parts.push(`<rect x="${(x1 + x2) / 2 - 52}" y="${yDim - 9}" width="104" height="18" fill="var(--surface-2)"/>`);
    parts.push(`<text class="t-strong" x="${(x1 + x2) / 2}" y="${yDim + 4.5}" text-anchor="middle">${esc(lText)}</text>`);

    let note = '';
    if (cav.hasMode) {
      const L = d.L, nPts = 160;
      const wAt = (z) => cav.w0 * Math.sqrt(1 + ((z - cav.z1) / cav.zR) ** 2);
      const wMax = Math.max(cav.w1, cav.w2);
      const base = hBore / d.rbore;                 // px per metre, true scale vs bore
      let k = 1;
      if (wMax * base < 0.42 * hBore) k = niceFactor((0.42 * hBore) / (wMax * base));
      const sc = base * k;
      const clip = wMax > d.rbore;
      const top = [], bot = [], top2 = [], bot2 = [];
      for (let i = 0; i <= nPts; i++) {
        const z = (L * i) / nPts;
        const x = x1 + ((x2 - x1) * i) / nPts;
        const w = Math.min(wAt(z) * sc, hSp * 1.25);
        top.push(`${x.toFixed(2)},${(y0 - w).toFixed(2)}`);
        bot.push(`${x.toFixed(2)},${(y0 + w).toFixed(2)}`);
        const w2 = Math.min(1.5 * wAt(z) * sc, hSp * 1.25);
        top2.push(`${x.toFixed(2)},${(y0 - w2).toFixed(2)}`);
        bot2.push(`${x.toFixed(2)},${(y0 + w2).toFixed(2)}`);
      }
      parts.push(`<polygon points="${top2.join(' ')} ${bot2.reverse().join(' ')}" fill="${colour}" fill-opacity="0.13"/>`);
      parts.push(`<polygon points="${top.join(' ')} ${bot.reverse().join(' ')}" fill="url(#beamGrad)"/>`);
      parts.push(`<polyline points="${top.join(' ')}" fill="none" stroke="${colour}" stroke-width="1.2"/>`);

      // waist marker
      const zw = cav.z1;
      if (zw >= 0 && zw <= L) {
        const xw = x1 + ((x2 - x1) * zw) / L;
        const yw = y0 - cav.w0 * sc;
        parts.push(`<line class="tick" x1="${xw}" y1="${yw - 3}" x2="${xw}" y2="${y0 - hBore - 4}"/>`);
        parts.push(`<text class="t-strong" x="${xw}" y="${y0 - hBore - 9}" text-anchor="middle">w₀ = ${esc(d.fmt.len(cav.w0))}</text>`);
      } else {
        const side = zw < 0 ? 'M₁' : 'M₂';
        const dist = zw < 0 ? -zw : zw - L;
        parts.push(`<text class="t-strong" x="${(x1 + x2) / 2}" y="${y0 - hBore - 9}" text-anchor="middle">waist ${esc(d.fmt.mm(dist))} outside ${side}, w₀ = ${esc(d.fmt.len(cav.w0))}</text>`);
      }
      // spot sizes at the mirrors
      parts.push(`<text class="t-small" x="${x1 + Math.max(0, s1) + 6}" y="${y0 + hBore + 16}" text-anchor="start">w₁ = ${esc(d.fmt.len(cav.w1))}</text>`);
      parts.push(`<text class="t-small" x="${x2 - Math.max(0, s2) - 6}" y="${y0 + hBore + 16}" text-anchor="end">w₂ = ${esc(d.fmt.len(cav.w2))}</text>`);
      if (clip) note = 'The beam is wider than the bore at a mirror: expect clipping loss.';
      else if (k > 1) note = `Beam radius drawn ×${k} relative to the bore; mechanics are schematic.`;
      else note = 'Beam drawn to scale relative to the bore; mechanics are schematic.';
      d.onNote && d.onNote(note, clip ? 'bad' : '', band);
    } else {
      const msg = cav.stability === 'marginal'
        ? 'Marginally stable: no finite Gaussian mode'
        : 'Unstable resonator: no Gaussian mode';
      parts.push(`<text class="t-warn" x="${(x1 + x2) / 2}" y="${y0 - 8}" text-anchor="middle">${esc(msg)}</text>`);
      parts.push(`<text class="t-small" x="${(x1 + x2) / 2}" y="${y0 + 14}" text-anchor="middle">g₁g₂ = ${esc(d.fmt.g(cav.g))}; a stable cavity needs 0 &lt; g₁g₂ &lt; 1</text>`);
      d.onNote && d.onNote('Change the length or a mirror radius to restore a stable mode.', 'bad', band);
    }
    svg.innerHTML = parts.join('\n');
    svg.setAttribute('aria-label',
      `Cavity schematic: length ${lText}, ${rocText(d.roc1, '₁')}, ${rocText(d.roc2, '₂')}. ` +
      (cav.hasMode ? `Waist ${d.fmt.len(cav.w0)}, spot sizes ${d.fmt.len(cav.w1)} and ${d.fmt.len(cav.w2)}.` : 'No stable mode.'));
  }

  root.FPHero = { draw, beamColour, visibleRGB };
})(window);
