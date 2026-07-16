// auth.js
// Exchanges a long-lived Firebase refresh token for a short-lived access token.
//
// Why this exists:
// NeetCode authenticates with Firebase Auth. The browser stores two tokens in
// IndexedDB: a short-lived accessToken (~1 hour) that is sent as a Bearer header
// on every API call, and a long-lived refreshToken that never expires on a timer.
// A background job cannot use the accessToken directly because it would be stale
// within the hour. Instead we store the refreshToken once and mint a new
// accessToken on demand via Google's secure token endpoint. This is the standard,
// documented Firebase refresh flow.

const FIREBASE_API_KEY = 'AIzaSyD4emZpWF1MIsu6Z8O6yaMMcPxJ2Z38L8g'; // NeetCode's public web API key (safe to embed; it is not a secret)

/**
 * Exchange a refresh token for a fresh access token.
 * @param {string} refreshToken - the long-lived Firebase refresh token
 * @returns {Promise<string>} a fresh access token (~1hr validity)
 */
async function getFreshAccessToken(refreshToken) {
  if (!refreshToken) {
    throw new Error('No refresh token provided. Set NEETCODE_REFRESH_TOKEN.');
  }

  const res = await fetch(
    `https://securetoken.googleapis.com/v1/token?key=${FIREBASE_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Token refresh failed (HTTP ${res.status}). ` +
      `The refresh token may have been revoked. Response: ${text.slice(0, 300)}`
    );
  }

  const data = await res.json();
  if (!data.access_token) {
    throw new Error('Token refresh returned no access_token.');
  }
  return data.access_token;
}

module.exports = { getFreshAccessToken };
