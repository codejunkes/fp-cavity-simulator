/*
 * Fabry–Pérot Cavity Simulator — plotting helpers (Plotly wrapper)
 * Reads colours from CSS custom properties so plots follow the theme.
 */
(function (root) {
  'use strict';
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function theme() {
    return {
      font: cssVar('--font-ui') || 'Barlow, system-ui, sans-serif',
      ink: cssVar('--ink'), soft: cssVar('--ink-soft'), faint: cssVar('--ink-faint'),
      line: cssVar('--line'), grid: cssVar('--grid'), surface: cssVar('--surface'), bg: cssVar('--bg'),
      accent: cssVar('--accent'),
      s: [1, 2, 3, 4, 5, 6].map((i) => cssVar('--s' + i)),
      ok: cssVar('--ok'), warn: cssVar('--warn'), bad: cssVar('--bad'),
    };
  }

  function axis(t, o = {}) {
    const a = {
      title: { text: o.title || '', standoff: 6, font: { size: 12.5, color: t.soft } },
      type: o.log ? 'log' : (o.type || '-'),
      gridcolor: t.grid, linecolor: t.line, zeroline: false, showline: true,
      ticks: 'outside', tickcolor: t.line, ticklen: 4,
      tickfont: { size: 11.5, color: t.soft },
      exponentformat: 'power', automargin: true,
    };
    if (o.range) a.range = o.range;
    if (o.extra) Object.assign(a, o.extra);
    return a;
  }

  // rough number of legend rows for a horizontal legend above the plot
  function legendRows(traces) {
    const n = traces.filter((tr) => tr.showlegend !== false && tr.name && tr.hoverinfo !== 'skip').length;
    return Math.max(1, Math.ceil(n / 4));
  }

  function render(el, traces, o = {}) {
    if (!el || !root.Plotly) return;
    const t = theme();
    const layout = {
      font: { family: t.font, size: 12.5, color: t.ink },
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { l: 60, r: o.y2 ? 62 : 16, t: o.legend === false ? 12 : legendRows(traces) * 20 + 16, b: 46 },
      xaxis: axis(t, o.x), yaxis: axis(t, o.y),
      showlegend: o.legend !== false,
      legend: {
        orientation: 'h', x: 0, y: 1.0, yanchor: 'bottom',
        font: { size: 11.5, color: t.soft }, bgcolor: 'rgba(0,0,0,0)',
      },
      hovermode: o.hovermode || 'closest',
      hoverlabel: { font: { family: t.font, size: 12, color: t.ink }, bgcolor: t.surface, bordercolor: t.line },
      shapes: o.shapes || [],
      annotations: (o.annotations || []).map((a) => ({
        font: { family: t.font, size: 11.5, color: t.soft }, showarrow: false, ...a,
      })),
    };
    if (o.y2) layout.yaxis2 = { ...axis(t, o.y2), overlaying: 'y', side: 'right', showgrid: false };
    if (o.layout) Object.assign(layout, o.layout);
    const config = {
      responsive: true, displaylogo: false, displayModeBar: 'hover',
      modeBarButtonsToRemove: ['lasso2d', 'select2d', 'toggleSpikelines', 'hoverCompareCartesian', 'hoverClosestCartesian'],
      toImageButtonOptions: { format: 'png', filename: o.name || el.id, scale: 2 },
    };
    root.Plotly.react(el, traces, layout, config);
  }

  function download(name, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function toCSV(el) {
    const rows = [];
    const lay = el.layout || {};
    const xt = (lay.xaxis && lay.xaxis.title && lay.xaxis.title.text) || 'x';
    const yt = (lay.yaxis && lay.yaxis.title && lay.yaxis.title.text) || 'y';
    rows.push(`# x: ${xt}`, `# y: ${yt}`);
    let header = false;
    for (const tr of el.data || []) {
      const name = String(tr.name || tr.type || 'series').replace(/"/g, "'");
      if (tr.z) {
        rows.push(`# ${name} (rows = y, columns = x)`);
        rows.push(['y \\ x', ...Array.from(tr.x || [])].join(','));
        Array.from(tr.z).forEach((row, i) => rows.push([(tr.y || [])[i], ...Array.from(row)].join(',')));
      } else if (tr.x && tr.y) {
        if (!header) { rows.push('series,x,y'); header = true; }
        const n = tr.x.length;
        for (let i = 0; i < n; i++) {
          const x = tr.x[i], y = tr.y[i];
          if (x === null || y === null || x === undefined || y === undefined) continue;
          rows.push(`"${name}",${x},${y}`);
        }
      }
    }
    return rows.join('\n');
  }

  async function exportFig(el, kind, name) {
    if (!el || !el.data) return;
    if (kind === 'csv') { download(`${name}.csv`, toCSV(el), 'text/csv'); return; }
    const t = theme();
    // give exported images an opaque background so they read on any page
    await root.Plotly.relayout(el, { paper_bgcolor: t.surface, plot_bgcolor: t.surface });
    try {
      await root.Plotly.downloadImage(el, {
        format: kind, filename: name,
        width: Math.max(640, el.clientWidth || 800), height: Math.max(360, el.clientHeight || 400),
        scale: kind === 'png' ? 2 : 1,
      });
    } finally {
      await root.Plotly.relayout(el, { paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)' });
    }
  }

  function purge(el) { if (el && root.Plotly) root.Plotly.purge(el); }

  root.FPPlots = { theme, render, exportFig, download, purge };
})(window);
