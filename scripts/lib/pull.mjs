// Discovers the publishable content in a depman checkout and writes the site's
// generated content tree. Everything is read and rendered in memory first, so a
// malformed file leaves the previous output untouched.

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  ContentError,
  MODULE_NAME,
  compareVersions,
  parseChangelog,
  parseVersionFile,
  renderChangelogPost,
  renderDocPage,
} from './transform.mjs';

/** The consumer reference docs. Everything else in depman's docs/ is internal. */
const REFERENCE_DOCS = ['docs/depman-json.md', 'docs/ingest-api.md'];

const exists = (p) => fs.access(p).then(() => true, () => false);

async function listDirs(dir) {
  const entries = await fs.readdir(dir, {withFileTypes: true});
  return entries
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

async function discover(from) {
  const errors = [];

  for (const required of ['changelog', 'packages', ...REFERENCE_DOCS]) {
    if (!(await exists(path.join(from, required)))) {
      errors.push(`${required}: not found in ${from}. Is this a depman checkout?`);
    }
  }
  if (errors.length) return {errors};

  const releases = [];
  for (const module of await listDirs(path.join(from, 'changelog'))) {
    if (!MODULE_NAME.test(module)) {
      errors.push(`changelog/${module}: module directory names must match ${MODULE_NAME}`);
      continue;
    }
    const files = (await fs.readdir(path.join(from, 'changelog', module)))
      .filter((f) => f.endsWith('.md'))
      .sort();
    for (const file of files) {
      const sourcePath = `changelog/${module}/${file}`;
      const version = parseVersionFile(file);
      if (!version) {
        errors.push(`${sourcePath}: file name must be a version, like v1.2.3.md`);
        continue;
      }
      releases.push({module, version, sourcePath});
    }
  }
  if (releases.length === 0) errors.push('changelog: no release files found');

  const clients = [];
  for (const dir of await listDirs(path.join(from, 'packages'))) {
    const sourcePath = `packages/${dir}/README.md`;
    if (await exists(path.join(from, sourcePath))) clients.push({dir, sourcePath});
  }
  if (clients.length === 0) errors.push('packages: no packages/*/README.md found');

  return {releases, clients, errors};
}

/**
 * Renders all content from the depman checkout at `from`.
 * Returns a Map of output path (relative to the content root) to file contents.
 */
export async function renderContent(from) {
  const {releases, clients, errors} = await discover(from);
  if (errors.length) throw new AggregateError(errors.map((e) => new ContentError(e)), 'content discovery failed');

  const routes = new Map([
    ...releases.map((r) => [r.sourcePath, `/changelog/${r.module}/${r.version.name}`]),
    ...clients.map((c) => [c.sourcePath, `/docs/clients/${c.dir}`]),
    ...REFERENCE_DOCS.map((p) => [p, `/docs/reference/${path.posix.basename(p, '.md')}`]),
  ]);

  const read = (p) => fs.readFile(path.join(from, p), 'utf8');
  const files = new Map();
  const failures = [];
  const attempt = async (fn) => {
    try {
      await fn();
    } catch (err) {
      if (!(err instanceof ContentError)) throw err;
      failures.push(err);
    }
  };

  // Changelogs: validate everything before ordering, so one bad file reports
  // alongside any others rather than hiding them.
  for (const release of releases) {
    await attempt(async () => {
      release.source = await read(release.sourcePath);
      release.parsed = parseChangelog(release.source, release);
    });
  }
  if (failures.length) throw new AggregateError(failures, 'malformed changelog files');

  // Same-date releases are ordered by module, then version; see renderChangelogPost.
  const byDate = Map.groupBy(releases, (r) => r.parsed.date);
  for (const group of byDate.values()) {
    group.sort((a, b) => a.module.localeCompare(b.module) || compareVersions(a.version, b.version));
    group.forEach((release, order) => {
      files.set(
        `changelog/${release.module}/${release.version.name}.md`,
        renderChangelogPost(release.source, release.parsed, {...release, order, routes}),
      );
    });
  }

  // One tag per module, labelled with the product name from its newest title.
  const tags = Object.entries(Object.groupBy(releases, (r) => r.module))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([module, moduleReleases]) => {
      const newest = moduleReleases.toSorted((a, b) => compareVersions(b.version, a.version))[0];
      const label = newest.parsed.product ?? module;
      return `${module}:\n  label: ${JSON.stringify(label)}\n  permalink: /${module}\n  description: ${JSON.stringify(`Releases of ${label}`)}\n`;
    });
  files.set('changelog/tags.yml', tags.join(''));

  for (const {dir, sourcePath} of clients) {
    await attempt(async () => {
      files.set(
        `docs/clients/${dir}.md`,
        renderDocPage(await read(sourcePath), {sourcePath, slug: `/clients/${dir}`, sidebarLabel: dir, routes}),
      );
    });
  }
  for (const sourcePath of REFERENCE_DOCS) {
    const name = path.posix.basename(sourcePath, '.md');
    await attempt(async () => {
      files.set(
        `docs/reference/${name}.md`,
        renderDocPage(await read(sourcePath), {sourcePath, slug: `/reference/${name}`, routes}),
      );
    });
  }
  if (failures.length) throw new AggregateError(failures, 'malformed docs files');

  files.set('docs/clients/_category_.json', categoryJson('Clients', 1, '/clients', 'Install and configure a DepMan ingest client.'));
  files.set('docs/reference/_category_.json', categoryJson('Reference', 2, '/reference', 'The consumer config file and the ingest API.'));

  return {files, releases, clients};
}

function categoryJson(label, position, slug, description) {
  return `${JSON.stringify({label, position, link: {type: 'generated-index', slug, description}}, null, 2)}\n`;
}

/** Replaces `out` with exactly the rendered files. */
export async function writeContent(out, files) {
  await fs.rm(out, {recursive: true, force: true});
  for (const [rel, contents] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    const dest = path.join(out, rel);
    await fs.mkdir(path.dirname(dest), {recursive: true});
    await fs.writeFile(dest, contents);
  }
}
