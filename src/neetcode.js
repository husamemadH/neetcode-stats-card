// neetcode.js
// Thin client for NeetCode's private Firebase Cloud Functions API.
//
// All of NeetCode's data calls go through a single endpoint,
// /api/callableFunctionHttp, where the request body's `functionId` selects which
// server-side function runs. We discovered these function names by inspecting a
// HAR export of a logged-in session. Auth is a Bearer token in the Authorization
// header (confirmed with a live 200 response during Phase 0).

const CALLABLE_URL = 'https://neetcode.io/api/callableFunctionHttp';

/**
 * Call one of NeetCode's callable cloud functions.
 * @param {string} functionId - e.g. 'getCompletedProblems'
 * @param {string} accessToken - fresh Firebase access token
 * @param {object} [extraData] - additional fields merged into the data payload
 * @returns {Promise<object>} the `data` field of the response
 */
async function callFunction(functionId, accessToken, extraData = {}) {
  const res = await fetch(CALLABLE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ data: { functionId, ...extraData } }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `NeetCode call '${functionId}' failed (HTTP ${res.status}): ${text.slice(0, 300)}`
    );
  }

  const json = await res.json();
  return json.data;
}

/**
 * Get every problem the user has completed, grouped by NeetCode topic.
 * Response shape: { "Linked List": ["https://leetcode.com/problems/...", ...], ... }
 * Only topics with at least one solved problem appear as keys.
 */
async function getCompletedProblems(accessToken) {
  return callFunction('getCompletedProblems', accessToken);
}

/**
 * Get streak + daily activity data for the heatmap.
 * Response shape: { currentStreak, maxStreak, activityByDate: { "YYYY-MM-DD": { hasActivity, count } } }
 */
async function getUserStreakData(accessToken) {
  return callFunction('getUserStreakData', accessToken);
}

/**
 * Flatten the grouped completed-problems response into:
 *   - a flat list of unique LeetCode slugs
 *   - per-topic counts
 * @param {object} completed - the getCompletedProblems response
 */
function parseCompleted(completed) {
  const topicCounts = {};
  const slugs = new Set();

  for (const [topic, urls] of Object.entries(completed)) {
    topicCounts[topic] = urls.length;
    for (const url of urls) {
      const slug = url.replace(/\/+$/, '').split('/').pop();
      slugs.add(slug);
    }
  }

  return {
    slugs: [...slugs],
    topicCounts,
    totalSolved: slugs.size,
  };
}

module.exports = {
  callFunction,
  getCompletedProblems,
  getUserStreakData,
  parseCompleted,
};
