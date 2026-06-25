FROM node:22-alpine

# openssl needed by entrypoint.sh to generate the self-signed cert
RUN apk add --no-cache openssl

WORKDIR /app

COPY package.json proxy.js entrypoint.sh ./
RUN chmod +x entrypoint.sh

# /certs is writable by node; mount a named volume here to persist the cert
# across container restarts (avoids re-trusting on every restart).
RUN mkdir /certs && chown node:node /certs

ENV PORT=8989
ENV TARGET_URL=https://llm.local
ENV UPSTREAM_INSECURE=false
ENV LOG_BODY=false
ENV TIMEOUT_MS=300000
ENV TLS_CERT=/certs/cert.pem
ENV TLS_KEY=/certs/key.pem

EXPOSE 8989

USER node

ENTRYPOINT ["./entrypoint.sh"]
