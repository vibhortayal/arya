#!/usr/bin/env bash
# Git-pull deploy: run ON the Oracle VM from the repo checkout.
set -euo pipefail
cd "$(dirname "$0")/../.."
git pull --ff-only
cd assistant/deploy
docker compose up -d --build
docker compose ps
