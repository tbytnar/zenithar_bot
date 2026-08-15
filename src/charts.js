// Chart rendering via QuickChart's hosted API (https://quickchart.io/chart)
// — no local rendering dependency (no node-canvas, no headless browser).
// Free tier: 1,000 renders/month, no API key. POST (not GET) avoids any
// URL-length limit as chart configs grow.
//
// Every chart here is single-series (one measure, one category axis), so
// per the dataviz method a lone series takes one fixed mark color and
// skips the legend entirely — the title already says what's plotted.
// MARK_COLOR is validated against SURFACE_COLOR: all of lightness band,
// chroma floor, and contrast (>=3:1) pass — see
// dataviz skill's scripts/validate_palette.js "#2A78D6" --mode light.

const QUICKCHART_URL = 'https://quickchart.io/chart';

const MARK_COLOR = '#2A78D6';
const GRIDLINE_COLOR = '#E1E0D9';
const AXIS_TEXT_COLOR = '#898781';
const TITLE_COLOR = '#0B0B0B';
const SURFACE_COLOR = '#FCFCFB';

const BASE_SCALES = {
  x: { grid: { color: GRIDLINE_COLOR }, ticks: { color: AXIS_TEXT_COLOR } },
  y: { grid: { color: GRIDLINE_COLOR }, ticks: { color: AXIS_TEXT_COLOR }, beginAtZero: true },
};

function titlePlugin(text) {
  return { display: true, text, color: TITLE_COLOR, font: { size: 16, weight: 'bold' } };
}

// rows: [{ name, gold }], any order — sorted descending here so the top
// earner renders first (top of the chart, for a horizontal bar).
export function leaderboardChartConfig(rows) {
  const sorted = [...rows].sort((a, b) => b.gold - a.gold);
  return {
    type: 'bar',
    data: {
      labels: sorted.map((r) => r.name),
      datasets: [{ data: sorted.map((r) => r.gold), backgroundColor: MARK_COLOR, borderRadius: 4, barThickness: 20 }],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, title: titlePlugin('Top Contributors — Gold Earned') },
      scales: BASE_SCALES,
    },
  };
}

// points: [{ label, balance }], chronological order — the running treasury
// balance after each ledger entry.
export function treasuryChartConfig(points) {
  return {
    type: 'line',
    data: {
      labels: points.map((p) => p.label),
      datasets: [
        {
          data: points.map((p) => p.balance),
          borderColor: MARK_COLOR,
          backgroundColor: MARK_COLOR,
          borderWidth: 2,
          pointRadius: 4,
          fill: false,
          tension: 0,
        },
      ],
    },
    options: {
      plugins: { legend: { display: false }, title: titlePlugin('Treasury Balance Over Time') },
      // Not beginAtZero: this is a trend line, not a magnitude bar — forcing
      // zero into frame would compress the shape of the change into a
      // sliver if the balance never gets close to it.
      scales: { ...BASE_SCALES, y: { ...BASE_SCALES.y, beginAtZero: false } },
    },
  };
}

// rows: [{ name, quantity }], any order — sorted descending here so the
// largest stock renders first (top of the chart, for a horizontal bar).
export function stockChartConfig(rows) {
  const sorted = [...rows].sort((a, b) => b.quantity - a.quantity);
  return {
    type: 'bar',
    data: {
      labels: sorted.map((r) => r.name),
      datasets: [
        { data: sorted.map((r) => r.quantity), backgroundColor: MARK_COLOR, borderRadius: 4, barThickness: 20 },
      ],
    },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: false }, title: titlePlugin('Current Stock') },
      scales: BASE_SCALES,
    },
  };
}

export async function renderChartPng(chartConfig, { width = 700, height = 420 } = {}) {
  const response = await fetch(QUICKCHART_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chart: chartConfig,
      width,
      height,
      backgroundColor: SURFACE_COLOR,
      format: 'png',
      version: '3',
    }),
  });

  if (!response.ok) {
    throw new Error(`QuickChart request failed: ${response.status} ${await response.text()}`);
  }

  return Buffer.from(await response.arrayBuffer());
}
