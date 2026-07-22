#!/usr/bin/env node
// local.js — Phase 1 local prototype runner.
//
// Runs the entire pipeline on your machine and writes card.svg, so you can verify
// the numbers and design before deploying anything to AWS.
//
// Usage:
//   NEETCODE_REFRESH_TOKEN='...' NEETCODE_USERNAME='husam emad' node local.js
//
// It caches difficulty lookups in .difficulty-cache.json so repeat runs are fast.

const fs = require('fs');
const path = require('path');
const { runPipeline } = require('./src/pipeline');
const { buildCard, buildErrorCard } = require('./src/card');

const CACHE_FILE = path.join(__dirname, '.difficulty-cache.json');

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveCache(cache) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}

(async () => {
  const refreshToken = process.env.NEETCODE_REFRESH_TOKEN;
  const username = process.env.NEETCODE_USERNAME || 'neetcoder';

  if (!refreshToken) {
    console.error('ERROR: set NEETCODE_REFRESH_TOKEN environment variable.');
    process.exit(1);
  }

  try {
    const { stats, difficultyCache } = await runPipeline({
      refreshToken,
      username,
      difficultyCache: loadCache(),
      log: (m) => console.log(m),
    });

    saveCache(difficultyCache);

    const svg = buildCard(stats);
    fs.writeFileSync(path.join(__dirname, 'card.svg'), svg);

    console.log('\n=== RESULT ===');
    console.log(`Total solved: ${stats.totalSolved}`);
    console.log(`Easy:   ${stats.solvedByDiff.Easy} / ${stats.totalByDiff.Easy}`);
    console.log(`Medium: ${stats.solvedByDiff.Medium} / ${stats.totalByDiff.Medium}`);
    console.log(`Hard:   ${stats.solvedByDiff.Hard} / ${stats.totalByDiff.Hard}`);
    console.log(`Streak: ${stats.currentStreak} (max ${stats.maxStreak})`);
    console.log('\nWrote card.svg — open it in a browser to preview.');
  } catch (e) {
    console.error('\nPipeline failed:', e.message);
    fs.writeFileSync(path.join(__dirname, 'card.svg'), buildErrorCard());
    process.exit(1);
  }
})();
