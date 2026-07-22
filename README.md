# NeetCode Stats Card

A self-updating stats card for a GitHub profile README that shows your NeetCode
progress: total problems solved, an Easy/Medium/Hard breakdown, and your streak.
The SVG is served from S3 and refreshed daily by an AWS Lambda function triggered
by EventBridge.

This document is both the setup guide **and** the story of how it was built —
what we discovered, what broke, and why each decision was made. If you only want
to deploy it, jump to [Setup](#setup). If you want to understand it, read on.

---

## The goal

Replicate the popular "LeetCode stats card" idea, but for NeetCode:

- A single image URL you drop into your README as `![...](url)`.
- It reflects your real, current progress.
- It refreshes about once a day.

The catch: unlike LeetCode, **NeetCode has no public profile page and no
documented API.** Everything below is the process of reverse-engineering a way
to get the data anyway, cleanly and reliably.

---

## How the data actually gets collected (the investigation)

### 1. There is no public NeetCode API

LeetCode exposes public profile stats that dozens of open-source "stats card"
projects query. NeetCode does not. Progress lives behind your logged-in account,
so the first job was figuring out *how the site itself* fetches your data, then
replicating exactly that from outside a browser.

### 2. Reading the network traffic (HAR files)

The technique was to capture a **HAR file** — a JSON recording of every network
request the browser makes — while logged into NeetCode, then read through it.

A HAR export from the practice page showed that, past a lot of analytics noise
(PostHog), NeetCode is built on **Firebase**. Nearly all its data comes through a
single endpoint:

```
POST https://neetcode.io/api/callableFunctionHttp
```

This is Firebase's "callable cloud functions" pattern: one URL, and the request
body names which server function to run. The bodies were self-documenting:

| `functionId`            | Returns                                                       |
| ----------------------- | ------------------------------------------------------------ |
| `getCompletedProblems`  | Your solved problems, grouped by topic (as LeetCode URLs)    |
| `getUserStreakData`     | Streak + daily activity heatmap                              |
| `getLeaderboardData`    | A solved-count + percentile (cached/laggy — not used)        |
| `getTopicCounts`        | Total problems per topic across the platform                 |
| `getUserInfo`           | Profile info (also contains sensitive account fields)        |

`getProblemListFunctionHttp` is a separate endpoint returning NeetCode's problem
catalog with difficulty per problem.

### 3. The difficulty problem (and why LeetCode, not NeetCode, provides it)

The card needs an Easy/Medium/Hard split, but `getCompletedProblems` returns only
URLs — no difficulty. The obvious fix was to join against NeetCode's own catalog
(`getProblemListFunctionHttp`), which *does* have difficulty.

It didn't work. NeetCode's catalog uses its **own internal slugs** that differ
from LeetCode's:

- your solved `two-sum` ↔ NeetCode's `two-integer-sum`
- `invert-binary-tree` ↔ `invert-a-binary-tree`
- `contains-duplicate` ↔ `duplicate-integer`

Only 88 of 132 solved problems matched by slug, and the catalog contained **no
LeetCode URL or shared ID** to join on. Internally these are two different
systems: one identifies *NeetCode's page for a problem*, the other identifies
*the canonical LeetCode problem*. Nothing connects them in the data we can see.

**The fix:** skip NeetCode's catalog entirely. `getCompletedProblems` already
gives real LeetCode URLs, so we ask **LeetCode's own public GraphQL API** for
difficulty, keyed by the slug in each URL:

```
POST https://leetcode.com/graphql
{ "operationName": "questionData",
  "variables": { "titleSlug": "reverse-linked-list" },
  "query": "query questionData($titleSlug: String!){ question(titleSlug:$titleSlug){ difficulty } }" }
```

This endpoint needs no authentication. Looping it over all 132 solved slugs
produced **Easy 81 / Medium 50 / Hard 1**, which matches the site's UI exactly.

### 4. The authentication mechanism (the surprising part)

We assumed NeetCode used a session cookie. It doesn't:

- A cookie-export extension came back **empty** for neetcode.io — no cookie at all.
- The tokens live in the browser's **IndexedDB**, in `firebaseLocalStorageDb`,
  because NeetCode uses Firebase Auth's client SDK.

Firebase stores two tokens there:

- **`accessToken`** — a JWT, valid ~1 hour. Sent as `Authorization: Bearer <token>`
  on each API call. (We confirmed this header format with a live call that
  returned HTTP 200 — the "Phase 0" verification step.)
- **`refreshToken`** — long-lived, doesn't expire on a timer. Used to mint new
  access tokens via Google's `securetoken.googleapis.com` endpoint.

This is actually a *better* setup for a background job than a cookie: cookies
expire and can't be renewed headlessly, but a Firebase refresh token is designed
for exactly this. **We store the refresh token once, and the job mints a fresh
access token on every run.**

> ⚠️ **Security note.** The refresh token is equivalent to a password — anyone
> holding it can act as your account. Store it only as an encrypted secret
> (Lambda env var or AWS Secrets Manager). Never commit it, never paste it
> anywhere, and if it's ever exposed, revoke it by removing NeetCode's access at
> https://myaccount.google.com/permissions and signing in again to get a new one.

---

## Architecture

```
   GitHub README <img> ──▶  S3 (neetcode-card.svg, public)
                                        ▲
                                        │ writes fresh SVG daily
                              ┌─────────┴────────┐
   EventBridge (rate 1 day) ──▶  Lambda function  │
                              └─────────┬────────┘
                                        │ pipeline:
                                        │  1. refresh token (Google securetoken)
                                        │  2. getCompletedProblems (NeetCode, Bearer)
                                        │  3. getUserStreakData   (NeetCode, Bearer)
                                        │  4. difficulty per slug (LeetCode GraphQL)
                                        │  5. build SVG
                                        └─▶ save SVG + caches to S3
```

Every external call in that pipeline was individually tested with a real response
before any deployment code was written.

---

## Project layout

```
neetcode-stats-card/
├── src/
│   ├── auth.js        # refresh token -> fresh access token (Google securetoken)
│   ├── neetcode.js    # callableFunctionHttp client + response parsing
│   ├── leetcode.js    # per-slug difficulty via LeetCode GraphQL (+ caching, rate-limit)
│   ├── card.js        # SVG generation (main card + error fallback)
│   └── pipeline.js    # chains all of the above into one stats object
├── local.js           # Phase 1: run the whole thing locally, writes card.svg
├── lambda.js          # Phases 3-4: Lambda handler with 24h S3 cache
├── test.js            # offline integration test (mocks network, real pipeline)
├── deploy.sh          # zip + push to Lambda
├── package.json
└── README.md          # this file
```

---

## Setup

### Prerequisites

- Node.js 18+
- An AWS account (Lambda + S3 are effectively free at this scale)
- Your NeetCode Firebase **refresh token** (see below)

### Getting your refresh token

1. Log into neetcode.io.
2. Open DevTools → Console.
3. Run:
   ```javascript
   (async () => {
     const req = indexedDB.open('firebaseLocalStorageDb');
     req.onsuccess = () => {
       const db = req.result;
       const tx = db.transaction(db.objectStoreNames, 'readonly');
       const store = tx.objectStore(db.objectStoreNames[0]);
       const all = store.getAll();
       all.onsuccess = () => {
         const t = all.result[0]?.value?.stsTokenManager?.refreshToken;
         console.log(t);
       };
     };
   })();
   ```
4. Copy the printed value. **Treat it like a password.**

### Phase 1 — run locally first

Always validate locally before deploying:

```bash
npm install
NEETCODE_REFRESH_TOKEN='paste-token' NEETCODE_USERNAME='your name' npm run local
```

This prints your totals and writes `card.svg`. Open it in a browser. The first
run does ~130 LeetCode lookups (about a minute); subsequent runs reuse
`.difficulty-cache.json` and are near-instant.

You can also run the offline test, which exercises the full pipeline against
captured data with the network mocked:

```bash
npm test
```

### Phase 3 — deploy to Lambda

1. **Create an S3 bucket** for the cache (any name).

2. **Make the SVG object publicly readable** — disable Block Public Access on the
   bucket, then add a bucket policy allowing `s3:GetObject` on `<bucket>/neetcode-card.svg`.

3. **Create the Lambda function** (Console → Lambda → Create function):
   - Runtime: Node.js 20.x
   - Set environment variables:
     - `NEETCODE_REFRESH_TOKEN` = your token
     - `NEETCODE_USERNAME` = your display name
     - `CACHE_BUCKET` = your bucket name
   - Set timeout to **5 minutes** (Configuration → General → Timeout) — the first
     uncached run makes ~130 sequential LeetCode calls.
   - Give the execution role `s3:GetObject` and `s3:PutObject` on the bucket.

4. **Add an EventBridge schedule** (EventBridge → Rules → Create):
   - Schedule: `rate(1 day)`
   - Target: your Lambda function

5. **Deploy the code:**
   ```bash
   ./deploy.sh <your-lambda-function-name>
   ```

6. Invoke once manually to prime the cache:
   ```bash
   aws lambda invoke --function-name <your-lambda-function-name> \
     --payload '{}' --cli-binary-format raw-in-base64-out /dev/null
   ```

### Phase 5 — embed in your README

```markdown
![NeetCode Stats](https://<your-bucket>.s3.<region>.amazonaws.com/neetcode-card.svg)
```

Push it to your profile repo and confirm it renders.

---

## How the 24-hour refresh behaves

EventBridge fires the Lambda once per day. The Lambda runs the full pipeline,
writes a fresh SVG to S3, and exits. GitHub's image proxy fetches the SVG
directly from S3 on every profile view — no Lambda involved in serving it.

To force a refresh outside the schedule, delete the metadata cache file and
invoke Lambda manually:

```bash
aws s3 rm s3://<your-bucket>/neetcode-card.meta.json
aws lambda invoke --function-name <your-lambda-function-name> \
  --payload '{}' --cli-binary-format raw-in-base64-out /dev/null
```

---

## Failure handling

- If token refresh fails (e.g. the refresh token was revoked), the function first
  tries to serve the **last-known-good** SVG from S3 (marked `X-Cache: STALE`),
  so your profile never shows a broken image.
- If there's no cache at all, it returns a small "stats temporarily unavailable"
  fallback card instead of an error.

---

## Known limitations & caveats

- **This rides on NeetCode's private, undocumented API.** If they rename a
  `functionId`, change the auth flow, or restructure responses, the card breaks
  with no warning. That's inherent to the approach, not a bug we can prevent.
- **Platform-wide totals are hardcoded** (`PLATFORM_TOTALS` in `pipeline.js`:
  Easy 224 / Medium 600 / Hard 149). These are the denominators shown on the card
  and only change when NeetCode adds problems. Update them if the site's numbers
  drift.
- **The refresh token is the single point of failure.** If it stops working, the
  card goes stale until you replace the secret with a fresh token.
- **LeetCode's GraphQL endpoint is also unofficial.** It's stable and widely used,
  but it isn't a contract.

