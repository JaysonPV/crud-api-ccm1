#!/bin/bash
set -e

echo "🚀 Lancement de l’API CRUD"

# Cloud Run impose PORT=8080
export PORT=${PORT:-8080}

echo "API démarrée sur le port ${PORT}"

exec node index.js
