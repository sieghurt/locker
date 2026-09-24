#!/usr/bin/env sh
# Prints the public ngrok URL of the running stack, waiting a little for the tunnel to come up.
# Usage: ./scripts/share-url.sh   (or: npm run share:url)
set -eu

PORT="${NGROK_INSPECTOR_PORT_HOST:-4040}"
ATTEMPTS="${ATTEMPTS:-30}"

i=0
while [ "$i" -lt "$ATTEMPTS" ]; do
  url=$(curl -fsS "http://localhost:$PORT/api/tunnels" 2>/dev/null |
    grep -o '"public_url":"https://[^"]*"' | head -1 | cut -d'"' -f4 || true)
  if [ -n "${url:-}" ]; then
    printf '\n  Kiosk UI   %s\n  Swagger    %s/api/docs\n  Inspector  http://localhost:%s\n\n' "$url" "$url" "$PORT"
    exit 0
  fi
  i=$((i + 1))
  sleep 1
done

echo "No ngrok tunnel found on localhost:$PORT." >&2
echo "Start it with: NGROK_AUTHTOKEN=... docker compose --profile share up -d" >&2
exit 1
