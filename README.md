# proxy-llm

Proxy HTTPS local minimal entre [opencode](https://opencode.ai) (ou tout client Vercel AI SDK) et une API gateway OpenAI-compatible qui attend `arguments` au lieu de `parameters` dans les définitions d'outils.

## Problème résolu

Le Vercel AI SDK (`@ai-sdk/openai-compatible`) envoie les tool definitions au format standard OpenAI :

```json
{ "type": "function", "function": { "name": "bash", "parameters": { ... } } }
```

Certaines API gateways rejettent la requête avec une `422` car elles attendent le champ `arguments` (qui appartient au schéma de *réponse* OpenAI) plutôt que `parameters` (schéma de *requête*). Ce proxy intercepte chaque `POST /v1/chat/completions`, renomme la clé, et relaie la réponse en streaming SSE sans aucun buffering.

---

## Démarrage rapide

### Sans Docker

Le proxy génère un certificat auto-signé au premier lancement si `TLS_CERT`/`TLS_KEY` n'existent pas — il faut donc avoir `openssl` disponible, ou fournir ses propres fichiers.

```bash
# Générer un cert pour localhost (une seule fois)
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout certs/key.pem -out certs/cert.pem \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

TLS_CERT=./certs/cert.pem TLS_KEY=./certs/key.pem node proxy.js
```

### Avec Docker

Le conteneur génère automatiquement le certificat au premier démarrage.
Monter `/certs` comme volume nommé pour le **persister** entre les redémarrages (évite de re-trusting opencode à chaque fois).

```bash
# Build
docker build -t proxy-llm .

# Créer le volume une seule fois
docker volume create proxy-llm-certs

# Run
docker run -d \
  --name proxy-llm \
  -p 8989:8989 \
  -v proxy-llm-certs:/certs \
  --add-host llm.local:<IP_DE_VOTRE_APIGATE> \
  proxy-llm

# Logs
docker logs -f proxy-llm
```

---

## Faire confiance au certificat côté opencode

opencode est une application Node.js — il suffit de pointer `NODE_EXTRA_CA_CERTS` vers le certificat généré par le proxy, sans toucher au trust store système.

**Étape 1 — récupérer le cert**

```bash
# Depuis Docker
docker cp proxy-llm:/certs/cert.pem ~/proxy-llm-cert.pem

# Ou si lancé sans Docker, le cert est dans ./certs/cert.pem
```

**Étape 2 — lancer opencode avec le cert**

```bash
NODE_EXTRA_CA_CERTS=~/proxy-llm-cert.pem opencode
```

Ou l'exporter dans votre shell (`~/.bashrc` / `~/.zshrc`) pour ne pas avoir à le répéter :

```bash
export NODE_EXTRA_CA_CERTS=~/proxy-llm-cert.pem
```

---

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `8989` | Port d'écoute du proxy |
| `TARGET_URL` | `https://llm.local` | URL upstream **sans** `/v1` (voir ci-dessous) |
| `TLS_CERT` | `/certs/cert.pem` | Chemin vers le certificat TLS |
| `TLS_KEY` | `/certs/key.pem` | Chemin vers la clé privée TLS |
| `UPSTREAM_INSECURE` | `false` | `true` pour désactiver la vérification TLS upstream (cert auto-signé côté apigate) |
| `LOG_BODY` | `false` | `true` pour dumper le body transformé dans les logs |
| `TIMEOUT_MS` | `300000` | Timeout upstream en ms (5 min par défaut) |

> **Note sur `TARGET_URL`** : ne pas inclure `/v1`.
> Le proxy reçoit `/v1/chat/completions` depuis le SDK et le concatène au `TARGET_URL`.
> Exemple : `TARGET_URL=https://llm.local` + path `/v1/chat/completions` → `https://llm.local/v1/chat/completions`.

---

## Configuration opencode.json

```json
{
  "providers": {
    "mon-provider": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "https://localhost:8989/v1"
      }
    }
  }
}
```

Le `/v1` reste dans le `baseURL` côté opencode — c'est lui qui compose `/v1/chat/completions`.

---

## Logs de debug

```
2026-06-25T10:00:01Z [info] proxy-llm listening on https://0.0.0.0:8989
2026-06-25T10:00:01Z [info] forwarding to: https://llm.local
2026-06-25T10:00:01Z [info] TLS cert: /certs/cert.pem
2026-06-25T10:00:05Z [info] [a3f7b2] ← POST /v1/chat/completions
2026-06-25T10:00:05Z [info] [a3f7b2] → llm.local/v1/chat/completions [tools: parameters→arguments]
2026-06-25T10:00:06Z [info] [a3f7b2] ↓ 200 (text/event-stream)
2026-06-25T10:00:22Z [info] [a3f7b2] done
```

Pour voir le body JSON complet envoyé à l'apigate :

```bash
LOG_BODY=true node proxy.js
# ou Docker :
docker run -e LOG_BODY=true ...
```

---

## Image Docker (GitHub Container Registry)

L'image est buildée et publiée automatiquement sur `ghcr.io` à chaque push sur `main` et à chaque tag `v*`.

```bash
docker pull ghcr.io/klementxv/proxy-llm:latest

docker run -d \
  --name proxy-llm \
  -p 8989:8989 \
  -v proxy-llm-certs:/certs \
  --add-host llm.local:<IP> \
  ghcr.io/klementxv/proxy-llm:latest
```

Pour utiliser un tag versionné :

```bash
docker pull ghcr.io/klementxv/proxy-llm:v1.0.0
```
