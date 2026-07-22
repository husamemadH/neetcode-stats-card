// card.js
// Builds the SVG stats card from tallied numbers. Pure string templating — no
// image library needed, because SVG is just XML text. The output is returned as a
// string and served with Content-Type: image/svg+xml.

// Difficulty accent colors (mirrors LeetCode's palette).
const COLORS = {
  bg: '#0d1117',
  panel: '#161b22',
  border: '#30363d',
  text: '#e6edf3',
  subtext: '#8b949e',
  easy: '#1cbaba',
  medium: '#ffb800',
  hard: '#f63737',
  track: '#21262d',
  ring: '#f79a09',
};

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Rounded progress ring geometry.
function ring(cx, cy, r, fraction, color, width = 8) {
  const circumference = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(1, fraction)) * circumference;
  return `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${COLORS.track}" stroke-width="${width}" />
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${width}"
      stroke-linecap="round" stroke-dasharray="${dash} ${circumference}"
      transform="rotate(-90 ${cx} ${cy})" />`;
}

// A single difficulty row: label + count on one line, proportional bar below it.
// Stacking the text above the bar (instead of putting the count at the far right
// of the bar) removes the horizontal crowding that caused clipping.
const ROW_X = 210; // left edge of the difficulty column (clears the ring)
const ROW_W = 300; // width of the bar track
function difficultyRow(y, label, color, solved, total) {
  const frac = total > 0 ? Math.min(1, solved / total) : 0;
  return `
    <text x="${ROW_X}" y="${y}" fill="${color}" font-size="14" font-weight="700" font-family="monospace">${label}</text>
    <text x="${ROW_X + ROW_W}" y="${y}" fill="${COLORS.text}" font-size="14" text-anchor="end" font-family="monospace">${solved} / ${total}</text>
    <rect x="${ROW_X}" y="${y + 8}" width="${ROW_W}" height="7" rx="3.5" fill="${COLORS.track}" />
    <rect x="${ROW_X}" y="${y + 8}" width="${(ROW_W * frac).toFixed(1)}" height="7" rx="3.5" fill="${color}" />`;
}

/**
 * @param {object} stats
 * @param {string} stats.username
 * @param {number} stats.totalSolved
 * @param {{Easy:number, Medium:number, Hard:number}} stats.solvedByDiff
 * @param {{Easy:number, Medium:number, Hard:number}} stats.totalByDiff
 * @param {number} [stats.currentStreak]
 * @param {number} [stats.maxStreak]
 * @returns {string} SVG markup
 */
function buildCard(stats) {
  const {
    username = 'neetcoder',
    totalSolved = 0,
    solvedByDiff = { Easy: 0, Medium: 0, Hard: 0 },
    totalByDiff = { Easy: 0, Medium: 0, Hard: 0 },
    currentStreak = 0,
    maxStreak = 0,
  } = stats;

  const grandTotal =
    (totalByDiff.Easy || 0) + (totalByDiff.Medium || 0) + (totalByDiff.Hard || 0);
  const solvedFraction = grandTotal > 0 ? totalSolved / grandTotal : 0;

  // Ring center — in its own zone on the left, radius 58 so its right edge
  // (x=173) stays clear of the difficulty column (starts at ROW_X=210).
  const rcx = 105;
  const rcy = 158;
  const rr = 58;

  const W = 540;
  const PAD = 28;

  return `<svg width="${W}" height="290" viewBox="0 0 ${W} 290" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="NeetCode stats for ${esc(username)}">
  <rect x="1" y="1" width="${W - 2}" height="288" rx="14" fill="${COLORS.bg}" stroke="${COLORS.border}" stroke-width="1.5" />

  <!-- Header -->
  <text x="${PAD}" y="44" fill="${COLORS.text}" font-size="20" font-weight="700" font-family="monospace">${esc(username)}</text>
  <text x="${W - PAD}" y="44" fill="${COLORS.subtext}" font-size="13" text-anchor="end" font-family="monospace">NeetCode</text>
  <line x1="${PAD}" y1="62" x2="${W - PAD}" y2="62" stroke="${COLORS.border}" stroke-width="1" />

  <!-- Progress ring -->
  ${ring(rcx, rcy, rr, solvedFraction, COLORS.ring, 9)}
  <text x="${rcx}" y="${rcy + 2}" fill="${COLORS.text}" font-size="32" font-weight="700" text-anchor="middle" font-family="monospace">${totalSolved}</text>
  <text x="${rcx}" y="${rcy + 24}" fill="${COLORS.subtext}" font-size="12" text-anchor="middle" font-family="monospace">Solved</text>

  <!-- Difficulty rows: text baseline at y, bar 8px below -->
  ${difficultyRow(108, 'Easy', COLORS.easy, solvedByDiff.Easy || 0, totalByDiff.Easy || 0)}
  ${difficultyRow(158, 'Med', COLORS.medium, solvedByDiff.Medium || 0, totalByDiff.Medium || 0)}
  ${difficultyRow(208, 'Hard', COLORS.hard, solvedByDiff.Hard || 0, totalByDiff.Hard || 0)}

  <!-- Streak footer -->
  <line x1="${PAD}" y1="244" x2="${W - PAD}" y2="244" stroke="${COLORS.border}" stroke-width="1" />
  <text x="${PAD}" y="270" fill="${COLORS.subtext}" font-size="13" font-family="monospace">Current streak: <tspan fill="${COLORS.text}" font-weight="700">${currentStreak}</tspan></text>
  <text x="${W - PAD}" y="270" fill="${COLORS.subtext}" font-size="13" text-anchor="end" font-family="monospace">Max streak: <tspan fill="${COLORS.text}" font-weight="700">${maxStreak}</tspan></text>
</svg>`;
}

/**
 * A fallback card shown when data collection fails, so the README never displays
 * a broken-image icon.
 */
function buildErrorCard(message = 'stats temporarily unavailable') {
  return `<svg width="520" height="120" viewBox="0 0 520 120" xmlns="http://www.w3.org/2000/svg" role="img">
  <rect x="1" y="1" width="518" height="118" rx="14" fill="${COLORS.bg}" stroke="${COLORS.border}" stroke-width="1.5" />
  <text x="260" y="55" fill="${COLORS.text}" font-size="16" font-weight="700" text-anchor="middle" font-family="monospace">NeetCode stats</text>
  <text x="260" y="80" fill="${COLORS.subtext}" font-size="13" text-anchor="middle" font-family="monospace">${esc(message)}</text>
</svg>`;
}

module.exports = { buildCard, buildErrorCard, COLORS };
