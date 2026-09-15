# depman-site

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
3. On `main` only, runs `wrangler pages deploy` on the build to the Cloudflare Pages project
   `depman-site`. The custom domain `docs.depman.io` is set up on that project in the Cloudflare
   dashboard.

It runs on:

- **pushes to `main`**
- **daily at 06:17 UTC**, so a DepMan release appears within a day. GitHub disables scheduled
  workflows in public repositories after 60 days without activity, and this repo rarely changes.
  If releases stop appearing, check for a "scheduled workflow disabled" banner on the Actions tab
  and re-enable it.
- **manual dispatch** (Actions → Site → Run workflow), to publish straight after a release
- **pull requests**, build only. This catches a Docusaurus upgrade or transform bug before it
  reaches `main`.

Nothing runs in, or is added to, the depman repository. Pull requests from forks don't receive
secrets, so their build check fails at the token step.

### Secrets

Set these as repository secrets. A missing one fails its job with a message naming it.

| Secret | Used by | What it is |
|---|---|---|
| `DEPMAN_READ_TOKEN` | build | A fine-grained personal access token scoped to `cool-studio/depman` only, with **Contents: read-only** and nothing else. |
| `CLOUDFLARE_API_TOKEN` | deploy | A Cloudflare API token with **Account → Cloudflare Pages → Edit**. |
| `CLOUDFLARE_ACCOUNT_ID` | deploy | The Cloudflare account that owns the `depman-site` Pages project. |

The Pages project must already exist, as a Direct Upload project with production branch `main`.
`wrangler pages deploy` won't create it in CI.
