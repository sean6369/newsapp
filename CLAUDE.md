@AGENTS.md

## Deploy

To deploy changes to the homelab server (news.oxleypawnshop.com):

```bash
docker build --platform linux/amd64 -t seanlsk/newsapp:latest .
docker push seanlsk/newsapp:latest
ssh seanlsk@192.168.1.150 "cd ~/newsapp && docker compose pull && docker compose up -d"
```

No service name on `up`, deliberately. `gotenberg` backs PDF export, but nothing
declares a dependency on it — it is reached over the network by `GOTENBERG_URL` — so
`up -d app` brings up the database and the app and silently leaves `/api/pdf`
answering 502.

- Server: 192.168.1.150, directory: ~/newsapp
- Host port: 3002, container port: 3000
- Database: PostgreSQL 18 (container: newsapp-db), published to 127.0.0.1 only
- Tunnel: Cloudflare, subdomain: news.oxleypawnshop.com

### First deploy on a fresh server

`~/newsapp/` needs exactly two files: `docker-compose.yml`, and a `.env` holding
`GEMINI_API_KEY` and `OPENAI_API_KEY`. Compose reads no other host file — anything
missing from `.env` is substituted as an empty string, which boots an app that looks
healthy and fails only where it calls a model.

Nothing about the schema is done by hand. `instrumentation.ts` runs the `drizzle/`
migrations before the first request, creating every table, index and extension against
an empty database. A failed migration exits the process instead of serving past it, so
the signal to read the logs is a container that will not stay up.

### Reaching the database from another machine

The Postgres port is published to `127.0.0.1` and must stay that way: the password sits
in plaintext in `docker-compose.yml`, so binding `0.0.0.0` would offer the archive to
the whole LAN. Tunnel over SSH instead, then connect a client to `localhost:5433`:

```bash
ssh -L 5433:127.0.0.1:5432 seanlsk@192.168.1.150
```
