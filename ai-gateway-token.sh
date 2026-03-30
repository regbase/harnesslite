#!/usr/bin/env bash
# Usage: ./ai-gateway-token.sh <env-file>

set -euo pipefail

[[ $# -eq 1 ]] || { echo "Usage: $0 <env-file>" >&2; exit 1; }

echo "Create a key at https://vercel.link/ai-gateway-token then paste it below."
read -rsp "Key: " AI_GATEWAY_API_KEY
echo

printf 'AI_GATEWAY_API_KEY=%s\n' "$AI_GATEWAY_API_KEY" >"$1"
echo "Wrote $1"
