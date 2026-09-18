# A Calmer News

A self-hosted, single-reader news archive. Every hour it pulls a handful of feeds, clips the
full text of each story, scores it against what you care about, and groups outlets that
covered the same event. You can then read, search, and ask questions of everything it has
collected.

All of it lives in one Postgres table that carries both a full-text index and a vector
index. Each page is a different way of querying that table.

```
RSS / TLDR ──► pipeline ──► Postgres ──┬──► /          feed, one day at a time
                │            (pgvector)├──► /search    lexical, with a fuzzy fallback
                │                      ├──► /library   pages you pasted yourself
      clip · score · embed · group      └──► /ask       hybrid retrieval + an LLM
```

## Features

- **Feed** (`/`): one day of news at a time, sorted by relevance score by default.
  Stories covered by several outlets collapse into a single card. The interests used for
  scoring are set in `src/lib/interests.ts`.
- **Reader** (`/article/[slug]`): the clipped full text, with a chat panel grounded in the
  article, plus export to Markdown or PDF and sharing via Telegram.
- **Ask** (`/ask`): chat with the whole archive. The model searches it with hybrid
  (full-text + vector) retrieval, cites the articles it used, and can also search the web
  for background.
- **Search** (`/search`): precise full-text search across every day, with highlighting,
  filters, and typo tolerance.
- **Library** (`/library`): paste any URL to clip and keep it, or save articles from the feed.
- **Settings** (`/settings`): turn individual sources and read marks on or off.

## Stack

Node 24 · Next.js 16 (App Router) · React 19 · TypeScript · Postgres 18 + pgvector + pg_trgm ·
Drizzle ORM · Tailwind v4 + HeroUI · OpenAI (answers) · Gemini (scoring + embeddings) ·
Gotenberg (PDF export)

## Getting started

You need Node 24, Docker, and API keys for OpenAI and Gemini. The app runs on the host;
only Postgres runs in Docker.

**1. Create the database volume** (first time only). The local compose file declares it
`external` so that `docker compose down -v` can never delete the archive, which also
means Compose will not create it for you:

```bash
docker volume create newsapp_pg18_data
```

**2. Create `.env`** in the project root:

```bash
DATABASE_URL=postgresql://newsapp:newsapp@localhost:5433/newsapp
OPENAI_API_KEY=sk-...        # Ask, article chat, web search
GEMINI_API_KEY=...           # relevance scoring, embeddings
```

A missing API key does not stop the app from starting. It boots normally and fails only
when it calls a model.

**3. Start Postgres and the app:**

```bash
docker compose -f docker-compose.local.yml up -d   # Postgres on localhost:5433
npm install
npm run dev                                        # http://localhost:3000
```

Migrations apply automatically on boot. Load the feed once and the pipeline starts filling
the archive, and after that it runs every hour. Scores and embeddings arrive a minute or
two after the articles.

> Use `docker-compose.local.yml` locally. `docker-compose.yml` is the server's file and
> is designed to fail on a development machine.

**PDF export** needs Gotenberg, which only the server stack runs. Locally, `/api/pdf`
fails unless you start one yourself:

```bash
docker run -d --rm -p 3100:3000 gotenberg/gotenberg:8
# and add to .env: GOTENBERG_URL=http://localhost:3100
```

### Configuration

Optional settings, all with defaults in code:

| Variable | Default | Purpose |
|---|---|---|
| `OPENAI_CHAT_MODEL` | `gpt-5.4` | Model for Ask and article chat |
| `GEMINI_CHAT_MODEL` | `gemini-3.5-flash-lite` | Relevance scoring |
| `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-2` | Must return 1536 dimensions |
| `GEMINI_EMBED_TPM` | `25000` | Embedding tokens per minute; raise it for a paid key |
| `ENABLE_PIPELINE` | on | Set `false` to disable ingest, the scheduler, and backfills |
| `GOTENBERG_URL` | `http://gotenberg:3000` | PDF export |

## Project layout

```
src/app/            pages and API routes
src/components/     UI
src/lib/            pipeline, clipping, scoring, retrieval, database queries
src/instrumentation.ts  runs migrations and starts the hourly scheduler
drizzle/            migrations
scripts/            maintenance scripts
```

## Maintenance scripts

For long jobs that would outlast an HTTP request. The scripts do not read `.env` on their
own, so pass it with `--env-file`. Each one can be interrupted and re-run safely; it
picks up whatever is still unfinished.

```bash
npx tsx --env-file=.env scripts/backfill-embeddings.ts           # embed articles missing a vector
npx tsx --env-file=.env scripts/backfill-embeddings.ts --force   # re-embed the whole archive
npx tsx --env-file=.env scripts/reclip.ts                        # retry the 100 latest failed clips
npx tsx --env-file=.env scripts/reclip.ts --limit 500            # ...or more of the backlog
npx tsx --env-file=.env scripts/reclip.ts --repair               # remove stored paywall teasers
npx tsx --env-file=.env scripts/rescore-dates.ts 2026-06-14      # re-score specific days
npx tsx --env-file=.env scripts/check-retrieval.ts               # retrieval diagnostics
```

Add `--dry-run` to either `reclip` command to report without writing anything.

## Deployment

The app is built as a Next.js standalone image and run with Docker Compose alongside
Postgres and Gotenberg on a homelab server. Secrets are supplied at run time through
`sops exec-env`. [CLAUDE.md](CLAUDE.md) has the deploy commands, the steps for preparing a
fresh server, and how to back up and restore the database.

## Further reading

- [docs/architecture.md](docs/architecture.md) covers the internals: how each page works,
  the ingest pipeline, retrieval and ranking, the data model, API routes, and design
  decisions.
- Non-obvious decisions are also explained in comments in the source, next to the code
  they affect.
