#!/bin/sh
set -e

# Generate a self-signed cert for localhost if none is mounted/provided.
# The cert persists as long as the /certs volume is kept — no need to re-trust
# opencode on every container restart.
if [ ! -f "$TLS_CERT" ] || [ ! -f "$TLS_KEY" ]; then
  echo "$(date -u +%FT%TZ) [info] Generating self-signed TLS certificate..."
  mkdir -p "$(dirname "$TLS_CERT")"
  openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
    -keyout "$TLS_KEY" \
    -out    "$TLS_CERT" \
    -subj   "/CN=localhost" \
    -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" \
    2>/dev/null
  echo "$(date -u +%FT%TZ) [info] Certificate ready: $TLS_CERT"
fi

exec node proxy.js
