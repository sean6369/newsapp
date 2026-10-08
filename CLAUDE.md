@AGENTS.md

## Local development

The app runs on the host; only Postgres runs in Docker.

```bash
docker compose -f docker-compose.local.yml up -d   # database on 5433
npm run dev                                        # app on 3000
```

`docker-compose.local.yml` is the local file, `docker-compose.yml` is the server's,
and they are not interchangeable. The server file claims the same container name as this
one, and its `pg_data` volume is declared `external` under the name `newsapp_pg_data`,
which does not exist on the Mac — so running it here fails outright instead of quietly
serving a second, empty archive. That failure is the design.

The dev archive lives in volume `newsapp_pg18_data`, declared `external` so that
`docker compose down -v` cannot delete it. Treat it as the only live copy: there is no
replica, and the volume sits inside Docker Desktop's disk image, where Time Machine
cannot see it. Dump it to a real file instead.

```bash
docker exec newsapp-db pg_dump -U newsapp -Fc newsapp > ~/newsapp-$(date +%Y%m%d).dump
```

`DATABASE_URL` points at `localhost:5433`. The port is a property of the container's
`-p` flag, not of `.env` — editing one without the other just aims at a dead port.

Three Postgres ports are in play on the development Mac and each is spoken for. 5432
belongs to Postgres.app, which is native, starts on login and is what every other tool
assumes; 5433 is this container; 5434 is the tunnel to prod below. Putting the
container on 5432 stops Postgres.app from starting at all, silently, at every login.

## Deploy

Production is an Oracle Cloud VM (**arm64**) serving `https://news.seanlsk.com` through a
Cloudflare tunnel. From the Mac, with Docker Desktop running:

```bash
docker buildx build --platform linux/arm64 \
  -t seanlsk/newsapp:latest -t seanlsk/newsapp:$(date +%F) --push .
ssh newsapp 'cd ~/newsapp && docker compose pull && docker compose up -d'
ssh newsapp 'docker image prune -f'
```

- The build reads the working tree, not the last commit, so uncommitted changes ship.
- The image is arm64-only: an amd64 host that pulls it fails with `exec format error`. If
  production ever moves to x86, the platform flag moves with it.
- No service name on `up`, deliberately. Nothing declares a dependency on `gotenberg` — it
  is reached over the network by `GOTENBERG_URL` — so `up -d app` silently leaves
  `/api/pdf` answering 502.

**Rollback.** The server keeps only the image it is running; the prune deletes the one it
replaced. Roll back through the registry instead, by pointing `:latest` at a dated tag. A
second deploy on the same day overwrites that day's tag.

```bash
docker buildx imagetools create -t seanlsk/newsapp:latest seanlsk/newsapp:2026-10-03
ssh newsapp 'cd ~/newsapp && docker compose pull && docker compose up -d'
```

### The server

- `ssh newsapp` is an alias in the Mac's `~/.ssh/config` (user `ubuntu`, key
  `~/.ssh/oci_newsapp`). Deploy as `ubuntu`: the box's `agent` user, which runs coding
  agents, is deliberately kept out of the `docker` group.
- `~/newsapp/` holds `compose.yaml` (this repo's `docker-compose.yml`) and `.env`.
- The app listens on `127.0.0.1:3002` only. To reach it directly,
  `ssh -L 3002:localhost:3002 newsapp`.
- The tunnel connector is a separate stack in `~/cloudflared/` that reaches
  `http://app:3000` over the external network `newsapp_newsapp-net`. Compose derives that
  name from the directory and the network key, so renaming `~/newsapp/` or `newsapp-net`
  takes the site down while every container still reports `Up`.
- Postgres 18 + pgvector runs as `newsapp-db` with no published port, on the external
  volume `newsapp_pg_data`, which `down -v` cannot delete.
- A nightly `pg_dump` into Borg (23:30 SGT) runs on the server itself; none of that lives
  in this repo.

The old homelab server (`192.168.1.150`, amd64) is down; its runbook is in this file's git
history. If it ever comes back, stop its newsapp stack first — it would run the hourly
pipeline against a stale database with the same API keys.

### Fresh server

Install Docker Engine and the compose plugin from Docker's apt repo, with `ubuntu` in the
`docker` group. Every image needs an arm64 build; check anything new with
`docker buildx imagetools inspect <image> | grep Platform`.

`~/newsapp/` needs two files: `compose.yaml`, and `.env` holding `POSTGRES_PASSWORD`,
`GEMINI_API_KEY` and `OPENAI_API_KEY`. The SOPS file in the homelab repo is the source of
truth. Decrypt it straight into the server's `.env`, so the plaintext never lands on the
Mac and the `age` key never lands on a box that runs coding agents:

```bash
# from the homelab repo checkout on the Mac; re-run after rotating any secret
sops -d stacks/newsapp/newsapp.sops.env \
  | ssh newsapp 'umask 077; mkdir -p ~/newsapp; cat > ~/newsapp/.env'
```

A missing value does not fail loudly. Compose substitutes an empty string, so Postgres
refuses to initialise a fresh volume, the app fails authentication against an existing
one, and a missing API key boots an app that looks healthy until it calls a model. The
other settings the code reads — `GEMINI_CHAT_MODEL`, `OPENAI_CHAT_MODEL`,
`ENABLE_PIPELINE`, `GEMINI_EMBED_TPM` — are not passed by the compose file, so production
runs on their code defaults. Setting one in `.env` does nothing; add it to the app's
`environment:` block.

Create the volume before the first `up`. It is `external`, so Compose refuses to start
without it rather than serving an empty archive:

```bash
ssh newsapp docker volume create newsapp_pg_data
```

The schema needs nothing by hand: `instrumentation.ts` runs the `drizzle/` migrations
before the first request, and a failed migration exits the process, so a container that
will not stay up means read the logs. It also sets the order for restoring a dump: after
`docker compose up -d db`, before the app's first start. Otherwise the app creates the
schema itself and the restore collides with it.

**Rotating `POSTGRES_PASSWORD`.** Postgres reads it only when initialising an empty
volume; after that the password lives in the database, and changing the secret alone
breaks authentication. Change it in the database first, on the server:

```bash
docker exec -it newsapp-db psql -U newsapp -c "ALTER USER newsapp PASSWORD 'new'"
# then re-encrypt the SOPS file, rewrite .env as above, and docker compose up -d
```

### Reaching the database

It publishes no port, so go through the container:

```bash
ssh -t newsapp docker exec -it newsapp-db psql -U newsapp -d newsapp
ssh newsapp "docker exec newsapp-db pg_dump -U newsapp -Fc newsapp" > ~/newsapp-$(date +%Y%m%d).dump
```

For a GUI client, temporarily add `127.0.0.1:5432:5432` to the `db` service and
`docker compose up -d db`. Bind loopback only: `0.0.0.0` would offer the archive to the
tailnet. Tunnel on 5434, since 5432 and 5433 are taken on the Mac and `-L` binds the local
end, then remove the publish afterwards:

```bash
ssh -L 5434:127.0.0.1:5432 newsapp
```
