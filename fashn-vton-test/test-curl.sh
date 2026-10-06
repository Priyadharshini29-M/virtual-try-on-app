#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
set -a
source .env
set +a

curl -X POST "https://api.runpod.ai/v2/${RUNPOD_ENDPOINT_ID}/runsync" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${RUNPOD_API_KEY}" \
    -d '{"input":{"prompt":"Your prompt"}}'
