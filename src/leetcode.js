// leetcode.js
// Looks up the difficulty (Easy/Medium/Hard) of a problem from LeetCode's public
// GraphQL endpoint, given its titleSlug.
//
// Why we go to LeetCode instead of NeetCode for difficulty:
// NeetCode's own catalog uses different internal slugs than LeetCode
// (e.g. NeetCode calls "two-sum" -> "two-integer-sum"), and its catalog response
// contains no LeetCode URL or shared ID to join on. But getCompletedProblems
// already gives us real LeetCode URLs, so we can ask LeetCode directly and skip
// the slug-mismatch problem entirely. This endpoint needs no authentication.

const LEETCODE_GRAPHQL = 'https://leetcode.com/graphql';

const QUERY = `query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    titleSlug
    difficulty
  }
}`;

/**
 * Fetch difficulty for a single slug. Returns 'Easy' | 'Medium' | 'Hard' | 'UNKNOWN'.
 */
async function fetchDifficulty(slug) {
  try {
    const res = await fetch(LEETCODE_GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'questionData',
        variables: { titleSlug: slug },
        query: QUERY,
      }),
    });
    if (!res.ok) return 'UNKNOWN';
    const json = await res.json();
    return json?.data?.question?.difficulty || 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

/**
 * Look up difficulties for many slugs, sequentially with a delay to stay under
 * LeetCode's rate limits. Accepts an optional cache map (slug -> difficulty) so
 * repeat runs only fetch problems solved since last time.
 *
 * @param {string[]} slugs
 * @param {object} [opts]
 * @param {Record<string,string>} [opts.cache] - known slug->difficulty pairs
 * @param {number} [opts.delayMs] - delay between requests (default 300ms)
 * @param {(done:number,total:number)=>void} [opts.onProgress]
 * @returns {Promise<{ counts: {Easy:number,Medium:number,Hard:number,UNKNOWN:number}, byslug: Record<string,string> }>}
 */
async function tallyDifficulties(slugs, opts = {}) {
  const { cache = {}, delayMs = 300, onProgress } = opts;
  const byslug = { ...cache };
  const toFetch = slugs.filter((s) => !byslug[s]);

  for (let i = 0; i < toFetch.length; i++) {
    const slug = toFetch[i];
    byslug[slug] = await fetchDifficulty(slug);
    if (onProgress) onProgress(i + 1, toFetch.length);
    if (i < toFetch.length - 1 && delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const counts = { Easy: 0, Medium: 0, Hard: 0, UNKNOWN: 0 };
  for (const slug of slugs) {
    const d = byslug[slug] || 'UNKNOWN';
    counts[d] = (counts[d] || 0) + 1;
  }

  return { counts, byslug };
}

module.exports = { fetchDifficulty, tallyDifficulties };
