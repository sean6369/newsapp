@AGENTS.md

## Local development

The app runs on the host; only Postgres runs in Docker.

```bash
docker compose -f docker-compose.local.yml up -d   # database on 5432
npm run dev                                        # app on 3000
```

`docker-compose.local.yml` is the local file, `docker-compose.yml` is the server's,
and they are not interchangeable. The server file declares its own `pg_data` volume,
which Compose would create empty, and claims the same container name and host port —
so running it here either collides outright or quietly serves a second, empty archive.

The dev archive lives in volume `newsapp_pg18_data`, declared `external` so that
`docker compose down -v` cannot delete it. Treat it as the only live copy: there is no
replica, and the volume sits inside Docker Desktop's disk image, where Time Machine
cannot see it. Dump it to a real file instead.

```bash
docker exec newsapp-db pg_dump -U newsapp -Fc newsapp > ~/newsapp-$(date +%Y%m%d).dump
```

`DATABASE_URL` points at `localhost:5432`. The port is a property of the container's
`-p` flag, not of `.env` — editing one without the other just aims at a dead port.

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

### Preparing a bare machine

Everything below assumes Docker, SSH and the Cloudflare connector already exist. After
an OS reinstall none of them do, and none can be recovered from this repo:

- **Docker Engine and the compose plugin.** On Debian/Ubuntu,
  `curl -fsSL https://get.docker.com | sh`, then `sudo usermod -aG docker $USER` and
  log back in.
- **Key-based SSH for `seanlsk`.** Every deploy command here opens with
  `ssh seanlsk@192.168.1.150`.
- **The address `192.168.1.150`**, hardcoded in this file and in the tunnel command
  below. A fresh install takes whatever DHCP offers unless the router holds a
  reservation for it.
- **The Cloudflare connector.** The tunnel is a cloud-side object and survives the
  wipe; the connector credentials on the server do not. Reinstall `cloudflared`, run
  it with the existing tunnel's token from the Zero Trust dashboard, and confirm the
  `news.oxleypawnshop.com` public hostname still maps to `http://localhost:3002`.
- **`.env`.** Both API keys are gitignored, so the only working copies are on the
  development Mac.

### First deploy on a fresh server

`~/newsapp/` needs exactly two files: `docker-compose.yml`, and a `.env` holding
`GEMINI_API_KEY` and `OPENAI_API_KEY`. Compose reads no other host file. Those two
keys have no fallback, so a `.env` missing either substitutes an empty string and
boots an app that looks healthy and fails only where it calls a model. The rest of
the interpolated settings — `GEMINI_CHAT_MODEL`, `OPENAI_CHAT_MODEL`,
`ENABLE_PIPELINE` — carry `:-` defaults and are genuinely optional.

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
