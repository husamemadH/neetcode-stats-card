#!/usr/bin/env bash
# deploy.sh — package the function and (re)deploy it to AWS Lambda.
#
# Prereqs (one-time):
#   - AWS CLI installed and configured (`aws configure`)
#   - An S3 bucket for the cache
#   - A Lambda function created (see README "Phase 3" for the console steps)
#
# Usage:
#   ./deploy.sh <lambda-function-name>
#
set -euo pipefail

FN_NAME="${1:-neetcode-stats-card}"

echo "Installing production dependencies..."
npm install --omit=dev

echo "Zipping function..."
rm -f function.zip
zip -r function.zip lambda.js src/ node_modules/ >/dev/null

echo "Updating Lambda code for '$FN_NAME'..."
aws lambda update-function-code \
  --function-name "$FN_NAME" \
  --zip-file fileb://function.zip

echo "Done. Test the Function URL in a browser to confirm it renders."
