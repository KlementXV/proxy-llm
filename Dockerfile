FROM node:22-alpine

WORKDIR /app

# No external deps — copy source directly
COPY package.json proxy.js ./

# Environment — override at runtime with -e or --env-file
ENV PORT=8989
# TARGET_URL must NOT include the trailing /v1 — the SDK path (/v1/chat/completions)
# is appended verbatim, so set this to the path prefix up to (but not including) /v1.
# Example: https://llm.local/apigate  →  proxies to https://llm.local/apigate/v1/chat/completions
ENV TARGET_URL=https://llm.local/apigate
# Set to "true" to skip TLS certificate verification for the upstream (self-signed certs)
ENV UPSTREAM_INSECURE=false
# Set to "true" to dump the full outgoing request body in logs
ENV LOG_BODY=false
# Upstream request timeout in milliseconds (default 5 min — LLM streams can be long)
ENV TIMEOUT_MS=300000

EXPOSE 8989

USER node

ENTRYPOINT ["node", "proxy.js"]
