# depman-docs

The public documentation and changelog for DepMan, published at **https://docs.depman.io**.

This repository holds only the site's scaffolding: the Docusaurus config, a landing page, and the
script that pulls content in. **Every docs page and changelog entry is fetched from
[`cool-studio/depman`](https://github.com/cool-studio/depman) at build time and is never committed
here.** The site can't drift from the source, and there's nothing to keep in sync by hand.

## What gets published

`scripts/pull-content.sh` copies exactly these out of a depman checkout into `generated/`
(gitignored), and nothing else:

| depman path | Site | Notes |
|---|---|---|
| `changelog/<module>/<version>.md` | `/changelog/<module>/<version>` | Blog posts, with RSS and Atom feeds. New module directories are picked up automatically. |
| `packages/<client>/README.md` | `/docs/clients/<client>` | One page per package that has a README. New packages are picked up automatically. |
| `docs/depman-json.md`, `docs/ingest-api.md` | `/docs/reference/…` | The consumer reference docs. The rest of depman's `docs/` is internal. |

The depman format is canonical and the transform adapts to it, never the other way round. Bodies
are copied as they are. The only changes are:

- **Front matter.** Changelogs get their title from the `# ` heading and their date from the
  `Released:` entry. They also get a tag per module, so readers can filter at `/changelog/tags`.
- **A `<!-- truncate -->` marker** after each changelog's metadata list, so `/changelog` lists every
  release with its Released, Range and Wire-version lines, and links through to the full notes.
- **Relative links.** A link to another published file points at its page on this site. Anything
  else (ADRs, internal docs, `LICENSE`) is unwrapped to plain text, since depman is private and a
  reader couldn't open it.
- **Same-day ordering.** Releases that share a date get a few seconds past midnight UTC so the feed
  order is stable (by module, then version). The displayed date is unchanged.

A changelog without a `# ` title that ends in its version, or without a `Released: YYYY-MM-DD`
entry, fails the pull with the file and line. So does a relative image or a relative URL in raw
HTML. Every problem is reported at once, and nothing is written, so a bad file can't publish a
broken page. The last good deploy stays live.

## Running it locally

You need Node 22 and a clone of depman anywhere on disk.

```sh
npm ci
./scripts/pull-content.sh --from ../depman   # re-run whenever depman changes; output is identical for identical input
npm start                                    # dev server at http://localhost:3000
npm run build && npm run serve               # the production build, as deployed
npm test                                     # transform unit tests
```

In a devcontainer, run the dev server as `npm start -- --host 0.0.0.0`.

`generated/` belongs to the pull script, which deletes and rewrites it on every run. Don't put
hand-written pages there. The landing page is `src/pages/index.md`.

## Deployment

`.github/workflows/site.yml` does the same as the local steps, then deploys:

1. Checks out depman read-only and shallow into `.depman/` using `DEPMAN_READ_TOKEN`.
2. Runs `npm test`, `./scripts/pull-content.sh --from .depman`, and `npm run build`.
3. On `main` only, runs `wrangler deploy`, which uploads the build to the Cloudflare Worker
   `depman-docs`, configured in `wrangler.jsonc`. It's an assets-only Worker: no script, just the
   static files.

It runs on:

- **pushes to `main`**
- **`workflow_dispatch` from depman** when a release tag is pushed (see below)
- **manual dispatch** (Actions → Site → Run workflow). Use this to publish docs changes made in
  depman between releases, or after a failed trigger from depman.
- **pull requests**, build only. This catches a Docusaurus upgrade or transform bug before it
  reaches `main`.

Nothing runs on a schedule. If a release doesn't appear, check the "Publish docs site" run in
depman first. Pull requests from forks don't receive secrets, so their build check fails at the
token step.

### The trigger from depman

depman's release checklist puts each `changelog/<module>/vX.Y.Z.md` in the tagged commit, and tags
point at merge commits on `main`. So when a tag is pushed, depman's `main` already has the notes,
and that's what this site checks out. depman runs one small workflow on those tags. It's on a
GitHub-hosted runner, so it doesn't take a slot in depman's self-hosted pool:

```yaml
# cool-studio/depman: .github/workflows/docs-site.yml
name: Publish docs site

on:
  push:
    tags: ['v*', '*-client/v*']

permissions: {}

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - env:
          GH_TOKEN: ${{ secrets.DOCS_SITE_DISPATCH_TOKEN }}
        run: gh workflow run site.yml --repo cool-studio/depman-docs --ref main
```

`DOCS_SITE_DISPATCH_TOKEN` is a secret in **depman**, not here. depman's built-in `GITHUB_TOKEN`
can't trigger workflows in another repository, so use either:

- a fine-grained personal access token with access to `cool-studio/depman-docs` only and
  **Actions: Read and write** and nothing else, or
- a GitHub App installed on `cool-studio/depman-docs` with Actions: write, with its token created
  in the job by `actions/create-github-app-token`.

A personal access token expires, and an expired one is the likeliest reason releases stop
appearing. When `api` and a client are tagged together, the site is triggered twice; its
concurrency group queues the runs, which is harmless.

### Secrets

Set these as repository secrets. A missing one fails its job with a message naming it.

| Secret | Used by | What it is |
|---|---|---|
| `DEPMAN_READ_TOKEN` | build | A fine-grained personal access token scoped to `cool-studio/depman` only, with **Contents: read-only** and nothing else. |
| `CLOUDFLARE_API_TOKEN` | deploy | A Cloudflare API token from the **Edit Cloudflare Workers** template, restricted to the one account. |
| `CLOUDFLARE_ACCOUNT_ID` | deploy | The Cloudflare account that owns the `depman-docs` Worker. |

### The Worker

`wrangler.jsonc` is the Worker's configuration, and every deploy applies it. Change settings there,
not in the dashboard:

- `html_handling: drop-trailing-slash` matches Docusaurus's `trailingSlash: false`. `/changelog` serves
  `changelog.html`, and `/changelog/` and `/changelog.html` redirect to it.
- `not_found_handling: 404-page` serves Docusaurus's `404.html` with a 404 status.
- **The custom domain is the exception.** `docs.depman.io` is attached in the dashboard (Worker →
  Settings → Domains & Routes). `wrangler.jsonc` has no `routes` and sets `workers_dev: false`,
  which is Cloudflare's documented way to leave dashboard-managed domains alone on deploy. It also
  means the `*.workers.dev` address is turned off.

To try the production build under the Workers runtime locally:

```sh
npm run build && npx wrangler dev
```
