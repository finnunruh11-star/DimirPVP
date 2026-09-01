#!/usr/bin/env bash
# Double-clickable launcher for macOS / Linux. Installs, then starts the game.
set -e
cd "$(dirname "$0")"

echo
echo "  PVP DIMIR"
echo "  ========="
echo

if ! command -v node >/dev/null 2>&1; then
  echo "  Node.js was not found on this machine."
  echo
  echo "  Install the LTS build from https://nodejs.org and run this again."
  echo
  exit 1
fi

echo "  Node $(node -v) found."
echo
echo "  Installing dependencies (first run takes a minute)..."
npm install --no-audit --no-fund

echo
echo "  Starting the game. A browser tab will open on its own."
echo "  Leave this window open while you play; press Ctrl+C to stop the server."
echo
npm run dev
