// pipeline.js
// Orchestrates the whole data-collection flow into a single stats object that
// card.js can render. This is the heart of the project; everything else is I/O.

const { getFreshAccessToken } = require('./auth');
const { getCompletedProblems, getUserStreakData, parseCompleted } = require('./neetcode');
const { tallyDifficulties } = require('./leetcode');

// Platform-wide totals for the "NeetCode All" list (the denominators shown on the
// card, e.g. "81 / 224"). These come from NeetCode's UI and change only when they
// add problems, so we treat them as stable constants. Adjust if NeetCode expands
// the list. If you'd rather compute these dynamically, you can derive them from
// getProblemListFunctionHttp, but its slugs don't map cleanly to LeetCode's, so
// hardcoding the displayed denominators is simpler and matches the site.
const PLATFORM_TOTALS = { Easy: 224, Medium: 600, Hard: 149 };

/**
 * Run the full pipeline.
 * @param {object} opts
 * @param {string} opts.refreshToken - Firebase refresh token
 * @param {string} [opts.username] - label shown on the card
 * @param {Record<string,string>} [opts.difficultyCache] - slug->difficulty from a prior run
 * @param {(msg:string)=>void} [opts.log]
 * @returns {Promise<{stats:object, difficultyCache:Record<string,string>}>}
 */
async function runPipeline(opts) {
  const { refreshToken, username = 'neetcoder', difficultyCache = {}, log = () => {} } = opts;

  log('Refreshing access token...');
  const accessToken = await getFreshAccessToken(refreshToken);

  log('Fetching completed problems...');
  const completedRaw = await getCompletedProblems(accessToken);
  const { slugs, topicCounts, totalSolved } = parseCompleted(completedRaw);
  log(`  ${totalSolved} problems across ${Object.keys(topicCounts).length} topics`);

  log('Fetching streak data...');
  let streak = { currentStreak: 0, maxStreak: 0 };
  try {
    const streakRaw = await getUserStreakData(accessToken);
    streak = {
      currentStreak: streakRaw.currentStreak || 0,
      maxStreak: streakRaw.maxStreak || 0,
    };
  } catch (e) {
    log(`  streak fetch failed (non-fatal): ${e.message}`);
  }

  log(`Looking up difficulties for ${slugs.length} problems (cache has ${Object.keys(difficultyCache).length})...`);
  const { counts, byslug } = await tallyDifficulties(slugs, {
    cache: difficultyCache,
    onProgress: (done, total) => {
      if (done % 25 === 0 || done === total) log(`  ${done}/${total}`);
    },
  });

  const stats = {
    username,
    totalSolved,
    solvedByDiff: { Easy: counts.Easy, Medium: counts.Medium, Hard: counts.Hard },
    totalByDiff: PLATFORM_TOTALS,
    topicCounts,
    currentStreak: streak.currentStreak,
    maxStreak: streak.maxStreak,
    generatedAt: new Date().toISOString(),
  };

  return { stats, difficultyCache: byslug };
}

module.exports = { runPipeline, PLATFORM_TOTALS };
