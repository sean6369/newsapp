@AGENTS.md

## Local development

The app runs on the host; only Postgres runs in Docker.

```bash
docker compose -f docker-compose.local.yml up -d   # database on 5433
npm run dev                                        # app on 3000
```

`docker-compose.local.yml` is the local file, `docker-compose.yml` is the server's,
and they are not interchangeable. The server file claims the same container name and
host port as this one, and its `pg_data` volume is declared `external` under the name
`newsapp_pg_data`, which does not exist on the Mac — so running it here fails outright
instead of quietly serving a second, empty archive. That failure is the design.

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

To deploy changes to the homelab server:

```bash
docker build --platform linux/amd64 -t seanlsk/newsapp:latest .
docker push seanlsk/newsapp:latest
ssh seanlsk@192.168.1.150 "cd ~/homelab/stacks/newsapp && \
  sops exec-env newsapp.sops.env 'docker compose pull && docker compose up -d'"
```

`--platform linux/amd64` is not decoration: the development Mac is arm64 and the server
is not, so without it the server pulls a manifest it cannot run.

Both compose commands sit inside one `sops exec-env`, deliberately. The decrypted
secrets live only in that child process's environment and never touch the server's disk,
so they have to be spent inside a single invocation. Running `docker compose up -d`
outside one does not fail loudly — Compose substitutes an empty string for every unset
variable, which on a fresh volume makes Postgres refuse to initialise, and on an
existing one hands the app a `DATABASE_URL` with no password that fails authentication.

No service name on `up`, deliberately. `gotenberg` backs PDF export, but nothing
declares a dependency on it — it is reached over the network by `GOTENBERG_URL` — so
`up -d app` brings up the database and the app and silently leaves `/api/pdf`
answering 502.

- Server: 192.168.1.150, directory: `~/homelab/stacks/newsapp`
- App: host port 3002, container port 3000, published on every interface — anything on
  the LAN can reach it, and Docker's publish rules bypass UFW, so a host firewall rule
  will not change that
- Database: PostgreSQL 18 + pgvector (container: `newsapp-db`), no published port at all
- Storage: external volume `newsapp_pg_data`, created by hand and immune to `down -v`
- Secrets: `newsapp.sops.env` in the stack directory, SOPS-encrypted
- No Cloudflare tunnel yet

### Preparing a bare machine

Everything below assumes Docker, SSH and a SOPS key already exist. After an OS
reinstall none of them do, and none can be recovered from this repo:

- **Docker Engine and the compose plugin.** On Debian/Ubuntu,
  `curl -fsSL https://get.docker.com | sh`, then `sudo usermod -aG docker $USER` and
  log back in.
- **Key-based SSH for `seanlsk`.** Every deploy command here opens with
  `ssh seanlsk@192.168.1.150`.
- **The address `192.168.1.150`**, hardcoded in this file and in the tunnel command
  below. A fresh install takes whatever DHCP offers unless the router holds a
  reservation for it.
- **`sops` and the key that decrypts `newsapp.sops.env`.** Without it `sops exec-env`
  fails and the deploy stops before Compose runs at all. The encrypted file alone is
  inert, which is the point — but it also means the key is a real dependency with no
  copy in this repo.

The Cloudflare connector is deliberately absent for now. The tunnel and the
`news.oxleypawnshop.com` hostname are a later phase; until then the app answers on the
LAN at `192.168.1.150:3002` and is not reachable from outside it.

### First deploy on a fresh server

`~/homelab/stacks/newsapp/` needs exactly two files: `docker-compose.yml`, and
`newsapp.sops.env` holding `POSTGRES_PASSWORD`, `GEMINI_API_KEY` and `OPENAI_API_KEY`.
Compose reads no other host file.

It also needs the database volume to exist before the first `up`, because `pg_data` is
declared `external` and Compose will not create one it did not make:

```bash
docker volume create newsapp_pg_data
```

Skip it and the first deploy stops with `external volume newsapp_pg_data not found`,
which is the intended trade: a missing volume becomes a refusal to start rather than a
silently empty archive. None of the three has a fallback: a missing API key
substitutes an empty string and boots an app that looks healthy and fails only where it
calls a model. The rest of the interpolated settings — `GEMINI_CHAT_MODEL`,
`OPENAI_CHAT_MODEL`, `ENABLE_PIPELINE`, `GEMINI_EMBED_TPM` — carry defaults in code and
are genuinely optional.

`POSTGRES_PASSWORD` behaves unlike the other two. The Postgres image reads it once, when
it initialises an empty volume, and thereafter the password lives in the database.
Rotating the SOPS secret later therefore updates `DATABASE_URL` and nothing else, and
the app starts failing authentication against a database that still holds the old
password. Rotation is two steps, in this order:

```bash
docker exec -it newsapp-db psql -U newsapp -c "ALTER USER newsapp PASSWORD 'new'"
# then re-encrypt the secret and redeploy
```

Nothing about the schema is done by hand. `instrumentation.ts` runs the `drizzle/`
migrations before the first request, creating every table, index and extension against
an empty database. A failed migration exits the process instead of serving past it, so
the signal to read the logs is a container that will not stay up.

That startup migration also sets the order for restoring an archive. A dump has to go in
after `docker compose up -d db` but before the app's first start: let the app boot first
and it creates the schema itself, and the restore then collides with the tables it
already made.

### Reaching the database from another machine

The database publishes no port, not even on loopback, so there is nothing for `ssh -L`
to forward to. On the server, go through the container:

```bash
docker exec -it newsapp-db psql -U newsapp -d newsapp
```

To pull the archive back to the Mac, pipe the dump over SSH rather than opening a port:

```bash
ssh seanlsk@192.168.1.150 "docker exec newsapp-db pg_dump -U newsapp -Fc newsapp" \
  > ~/newsapp-$(date +%Y%m%d).dump
```

A GUI client is the one case that needs a real port. Add `127.0.0.1:5432:5432` to the
`db` service, `docker compose up -d db`, tunnel it, and take the publish back out
afterwards — loopback only, because the password reaches that container from an
environment variable and a `0.0.0.0` bind would offer the archive to the whole LAN:

```bash
ssh -L 5434:127.0.0.1:5432 seanlsk@192.168.1.150
```

5434 rather than the obvious 5432 or 5433: both are already taken on the development
Mac, and `-L` binds the *local* end, so a tunnel onto either would fail to bind.
