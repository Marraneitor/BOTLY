#!/usr/bin/env sh
set -e

# Railway asigna el puerto publico en $PORT
export PORT="${PORT:-8080}"
export FLASK_HOST="0.0.0.0"
export FLASK_PORT="${PORT}"

# Bridge interno (no es el puerto publico)
export BRIDGE_PORT="${BRIDGE_PORT:-3001}"
export BRIDGE_URL="http://127.0.0.1:${BRIDGE_PORT}"

# Flask URL para que el bridge le llegue dentro del contenedor
export FLASK_URL="http://127.0.0.1:${PORT}"

echo "Starting Node bridge on :${BRIDGE_PORT} (FLASK_URL=${FLASK_URL})"
node bridge.js &

echo "Starting Flask on :${PORT}"
exec /opt/venv/bin/python app.py
