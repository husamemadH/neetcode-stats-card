// lambda.js — Phases 3 & 4: AWS Lambda handler with a 24h S3 cache.
//
// Deployed behind a Lambda Function URL (auth type NONE) so it can be embedded
// directly in a GitHub README as an <img>. On each request:
//   1. Check S3 for a cached SVG + timestamp.
//   2. If the cache is younger than TTL, return it immediately (cheap, fast).
//   3. Otherwise run the full pipeline, save the fresh SVG + difficulty cache to
//      S3, and return it.
// This caps the expensive work (token refresh + API calls + LeetCode loop) at
// once per day, regardless of how often GitHub's image proxy hits the URL.
//
// Required environment variables:
//   NEETCODE_REFRESH_TOKEN  - the Firebase refresh token (store encrypted)
//   NEETCODE_USERNAME       - label shown on the card
//   CACHE_BUCKET            - S3 bucket name for the cache
// Optional:
//   CACHE_TTL_SECONDS       - default 86400 (24h)
//   CACHE_KEY               - default 'neetcode-card'

const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
} = require('@aws-sdk/client-s3');
const { runPipeline } = require('./src/pipeline');
const { buildCard, buildErrorCard } = require('./src/card');

const s3 = new S3Client({});
const BUCKET = process.env.CACHE_BUCKET;
const TTL = parseInt(process.env.CACHE_TTL_SECONDS || '86400', 10);
const CACHE_KEY = process.env.CACHE_KEY || 'neetcode-card';
const SVG_KEY = `${CACHE_KEY}.svg`;
const META_KEY = `${CACHE_KEY}.meta.json`;

async function s3GetText(key) {
  const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  return res.Body.transformToString();
}

async function s3PutText(key, body, contentType) {
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

function svgResponse(svg, cacheStatus) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      // Let GitHub's proxy cache briefly, but not so long it goes very stale.
      'Cache-Control': 'public, max-age=3600',
      'X-Cache': cacheStatus,
    },
    body: svg,
  };
}

exports.handler = async () => {
  // 1. Try the cache.
  try {
    const meta = JSON.parse(await s3GetText(META_KEY));
    const ageSeconds = (Date.now() - meta.generatedAtMs) / 1000;
    if (ageSeconds < TTL) {
      const svg = await s3GetText(SVG_KEY);
      return svgResponse(svg, 'HIT');
    }
  } catch {
    // No cache yet, or unreadable — fall through to regenerate.
  }

  // 2. Regenerate.
  try {
    let difficultyCache = {};
    try {
      difficultyCache = JSON.parse(await s3GetText(`${CACHE_KEY}.difficulty.json`));
    } catch {
      /* first run: no difficulty cache */
    }

    const { stats, difficultyCache: newCache } = await runPipeline({
      refreshToken: process.env.NEETCODE_REFRESH_TOKEN,
      username: process.env.NEETCODE_USERNAME || 'neetcoder',
      difficultyCache,
      log: (m) => console.log(m),
    });

    const svg = buildCard(stats);

    // Persist svg, difficulty cache, and metadata.
    await Promise.all([
      s3PutText(SVG_KEY, svg, 'image/svg+xml'),
      s3PutText(`${CACHE_KEY}.difficulty.json`, JSON.stringify(newCache), 'application/json'),
      s3PutText(
        META_KEY,
        JSON.stringify({ generatedAtMs: Date.now(), stats }),
        'application/json'
      ),
    ]);

    return svgResponse(svg, 'MISS');
  } catch (e) {
    console.error('Pipeline failed:', e);
    // 3. Graceful degradation: try to serve the last-known-good cached SVG even
    //    if it's stale, rather than showing an error to visitors.
    try {
      const stale = await s3GetText(SVG_KEY);
      return svgResponse(stale, 'STALE');
    } catch {
      return svgResponse(buildErrorCard(), 'ERROR');
    }
  }
};
