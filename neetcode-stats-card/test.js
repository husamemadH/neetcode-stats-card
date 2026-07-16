// test.js — mocks the network layer and runs the REAL pipeline against the REAL
// data we captured, to prove the wiring produces the correct numbers offline.

const fs = require('fs');
const completed = JSON.parse(fs.readFileSync('./test-fixture-completed.json', 'utf8')).data;
const difficulties = JSON.parse(fs.readFileSync('./test-fixture-difficulties.json', 'utf8'));
const diffBySlug = Object.fromEntries(difficulties.map((d) => [d.slug, d.difficulty]));

// Intercept fetch and return canned responses for each endpoint.
global.fetch = async (url, opts) => {
  let body = {};
  if (opts?.body && typeof opts.body === 'string' && opts.body.trimStart().startsWith('{')) {
    body = JSON.parse(opts.body);
  }

  if (typeof url === 'string' && url.includes('securetoken.googleapis.com')) {
    return { ok: true, json: async () => ({ access_token: 'FAKE_ACCESS_TOKEN' }) };
  }
  if (typeof url === 'string' && url.includes('neetcode.io/api/callableFunctionHttp')) {
    const fn = body?.data?.functionId;
    if (fn === 'getCompletedProblems') {
      return { ok: true, json: async () => ({ data: completed }) };
    }
    if (fn === 'getUserStreakData') {
      return { ok: true, json: async () => ({ data: { currentStreak: 0, maxStreak: 41 } }) };
    }
  }
  if (typeof url === 'string' && url.includes('leetcode.com/graphql')) {
    const slug = body?.variables?.titleSlug;
    return {
      ok: true,
      json: async () => ({ data: { question: { titleSlug: slug, difficulty: diffBySlug[slug] || 'UNKNOWN' } } }),
    };
  }
  throw new Error('Unexpected fetch to ' + url);
};

const { runPipeline } = require('./src/pipeline');
const { buildCard } = require('./src/card');

(async () => {
  const { stats } = await runPipeline({
    refreshToken: 'FAKE_REFRESH_TOKEN',
    username: 'husam emad',
    difficultyCache: {},
    log: (m) => {}, // quiet
  });

  console.log('Total solved:', stats.totalSolved);
  console.log('Easy/Med/Hard:', stats.solvedByDiff.Easy, stats.solvedByDiff.Medium, stats.solvedByDiff.Hard);
  console.log('Streak:', stats.currentStreak, 'max', stats.maxStreak);
  console.log('Topics:', Object.keys(stats.topicCounts).length);

  // Assertions against the numbers we independently verified earlier.
  const ok =
    stats.totalSolved === 132 &&
    stats.solvedByDiff.Easy === 81 &&
    stats.solvedByDiff.Medium === 50 &&
    stats.solvedByDiff.Hard === 1;

  fs.writeFileSync('card.svg', buildCard(stats));
  console.log(ok ? '\n✅ PASS — pipeline produces the verified numbers' : '\n❌ FAIL — numbers do not match');
  process.exit(ok ? 0 : 1);
})();
