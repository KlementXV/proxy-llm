# proxy-llm

Proxy HTTP local minimal entre [opencode](https://opencode.ai) (ou tout client Vercel AI SDK) et une API gateway OpenAI-compatible qui attend `arguments` au lieu de `parameters` dans les définitions d'outils.

## Problème résolu

Le Vercel AI SDK (`@ai-sdk/openai-compatible`) envoie les tool definitions au format standard OpenAI :

```json
{ "type": "function", "function": { "name": "bash", "parameters": { ... } } }
```

Certaines API gateways rejettent la requête avec une `422` car elles attendent le champ `arguments` (qui appartient au schéma de *réponse* OpenAI) plutôt que `parameters` (schéma de *requête*). Ce proxy intercepte chaque `POST /v1/chat/completions`, renomme la clé, et relaie la réponse en streaming SSE sans aucun buffering.

---

## Démarrage rapide

### Sans Docker

```bash
node proxy.js
# ou avec options :
PORT=9090 TARGET_URL=https://llm.local node proxy.js
```

### Avec Docker

```bash
# Build
docker build -t proxy-llm .

# Run — résolution DNS via l'hôte (Linux)
docker run -d \
  --name proxy-llm \
  --network host \
  proxy-llm

# Run — avec IP explicite si llm.local n'est pas dans le DNS du conteneur
docker run -d \
  --name proxy-llm \
  -p 8989:8989 \
  --add-host llm.local:<IP_DE_VOTRE_APIGATE> \
  proxy-llm

# Logs
docker logs -f proxy-llm
```

---

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `8989` | Port d'écoute du proxy |
| `TARGET_URL` | `https://llm.local` | URL upstream **sans** `/v1` (voir ci-dessous) |
| `UPSTREAM_INSECURE` | `false` | `true` pour désactiver la vérification TLS (cert auto-signé) |
| `LOG_BODY` | `false` | `true` pour dumper le body transformé dans les logs |
| `TIMEOUT_MS` | `300000` | Timeout upstream en ms (5 min par défaut) |

> **Note sur `TARGET_URL`** : ne pas inclure `/v1`.
> Le proxy reçoit `/v1/chat/completions` depuis le SDK et le concatène au `TARGET_URL`.
> Exemple : `TARGET_URL=https://llm.local` + path `/v1/chat/completions` → `https://llm.local/v1/chat/completions`.

---

## Configuration opencode.json

Remplacer le `baseURL` de votre provider par l'adresse du proxy :

```json
{
  "providers": {
    "mon-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://localhost:8989/v1"
      }
    }
  }
}
```

Le `/v1` reste dans le `baseURL` côté opencode — c'est lui qui compose `/v1/chat/completions`.

---

## Logs de debug

```
2026-06-25T10:00:01Z [info] proxy-llm listening on http://0.0.0.0:8989
2026-06-25T10:00:01Z [info] upstream: https://llm.local
2026-06-25T10:00:05Z [info] [a3f7b2] ← POST /v1/chat/completions
2026-06-25T10:00:05Z [info] [a3f7b2] → llm.local/v1/chat/completions [tools: parameters→arguments]
2026-06-25T10:00:06Z [info] [a3f7b2] ↓ 200 (text/event-stream)
2026-06-25T10:00:22Z [info] [a3f7b2] done
```

---

## Image Docker (GitHub Container Registry)

L'image est buildée et publiée automatiquement sur `ghcr.io` à chaque push sur `main` et à chaque tag `v*`.

```bash
docker pull ghcr.io/klementxv/proxy-llm:latest

docker run -d \
  --name proxy-llm \
  -p 8989:8989 \
  --add-host llm.local:<IP> \
  ghcr.io/klementxv/proxy-llm:latest
```

Pour utiliser un tag versionné :

```bash
docker pull ghcr.io/klementxv/proxy-llm:v1.0.0
```
