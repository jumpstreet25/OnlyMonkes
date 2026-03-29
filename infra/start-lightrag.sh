#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$SCRIPT_DIR/.env.lightrag" ]; then
  cp "$SCRIPT_DIR/.env.lightrag.example" "$SCRIPT_DIR/.env.lightrag"
  echo "Created infra/.env.lightrag — add your API keys before continuing"
  exit 1
fi

mkdir -p "$SCRIPT_DIR/data/lightrag"

docker compose -f "$SCRIPT_DIR/docker-compose.lightrag.yml" up -d

echo "LightRAG running at http://localhost:9621"
