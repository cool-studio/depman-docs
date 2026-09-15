// Pure transforms from depman's source files to Docusaurus pages. No I/O here:
// everything takes strings and returns strings, so it can be tested directly.
//
// Bodies are copied byte-for-byte. The only edits are front matter, a truncate
// marker, and relative links (which cannot survive the move out of the repo).
// Markdown is parsed only to find where those links are; it is never
// re-serialised.

import path from 'node:path';
import {fromMarkdown} from 'mdast-util-from-markdown';
import {gfmFromMarkdown} from 'mdast-util-gfm';
import {toString} from 'mdast-util-to-string';
import {gfm} from 'micromark-extension-gfm';
import {visit} from 'unist-util-visit';

export class ContentError extends Error {}

export const MODULE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const VERSION_FILE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?\.md$/;

function parse(source) {
  return fromMarkdown(source, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
}

function fail(file, node, message) {
  const line = node?.position ? `:${node.position.start.line}` : '';
  throw new ContentError(`${file}${line}: ${message}`);
}

/** Parses `v0.1.10.md` into a comparable version, or null if it isn't one. */
export function parseVersionFile(fileName) {
  const m = VERSION_FILE.exec(fileName);
  if (!m) return null;
  return {
    name: fileName.replace(/\.md$/, ''),
    parts: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: m[4] ?? null,
  };
}

export function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a.parts[i] !== b.parts[i]) return a.parts[i] - b.parts[i];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

function isRelativeUrl(url) {
  return (
    url !== '' &&
    !url.startsWith('#') &&
    !url.startsWith('//') &&
    !/^[a-z][a-z0-9+.-]*:/i.test(url)
  );
}

/**
 * Resolves a relative URL found in `sourcePath` (a path relative to the depman
 * repo root) to the repo path it points at, plus any `#fragment`.
 */
function resolveRepoPath(sourcePath, url) {
  const hashAt = url.indexOf('#');
  const target = hashAt === -1 ? url : url.slice(0, hashAt);
  const hash = hashAt === -1 ? '' : url.slice(hashAt);
  const joined = target.startsWith('/')
    ? target.slice(1)
    : path.posix.join(path.posix.dirname(sourcePath), target);
  return {repoPath: path.posix.normalize(decodeURI(joined)), hash};
}

/**
 * Rewrites relative links in `source`, which lives at `sourcePath` in depman.
 * `routes` maps repo paths that are published on this site to their route.
 *
 * - A link to a published file is pointed at its route (keeping the fragment).
 * - A link to anything else (ADRs, internal docs, LICENSE) is unwrapped to its
 *   text: the depman repo is private, so there is nothing a reader could open.
 * - Relative images, relative reference definitions to unpublished files, and
 *   relative href/src in raw HTML fail, because none of them can be fixed
 *   without guessing.
 *
 * Returns a list of {start, end, text} edits against `source`.
 */
function linkEdits(source, tree, sourcePath, routes) {
  const edits = [];

  visit(tree, (node) => {
    switch (node.type) {
      case 'link': {
        if (!isRelativeUrl(node.url)) return;
        const {repoPath, hash} = resolveRepoPath(sourcePath, node.url);
        const route = routes.get(repoPath);
        const {start, end} = node.position;
        const first = node.children[0];
        const last = node.children.at(-1);
        const text = first
          ? source.slice(first.position.start.offset, last.position.end.offset)
          : '';
        edits.push({
          start: start.offset,
          end: end.offset,
          text: route ? `[${text}](${route}${hash})` : text,
        });
        return;
      }
      case 'image':
        if (isRelativeUrl(node.url)) {
          fail(sourcePath, node, `relative image "${node.url}" is not supported; assets are not copied from depman`);
        }
        return;
      case 'definition': {
        if (!isRelativeUrl(node.url)) return;
        const {repoPath, hash} = resolveRepoPath(sourcePath, node.url);
        const route = routes.get(repoPath);
        if (!route) {
          fail(sourcePath, node, `reference definition "[${node.label}]" points at "${node.url}", which is not published`);
        }
        edits.push({
          start: node.position.start.offset,
          end: node.position.end.offset,
          text: `[${node.label}]: ${route}${hash}`,
        });
        return;
      }
      case 'html':
        for (const m of node.value.matchAll(/\b(?:href|src)\s*=\s*["']([^"']*)["']/gi)) {
          if (isRelativeUrl(m[1])) {
            fail(sourcePath, node, `relative URL "${m[1]}" in raw HTML is not supported`);
          }
        }
        return;
    }
  });

  return edits;
}

function applyEdits(source, edits) {
  let out = source;
  for (const {start, end, text} of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, start) + text + out.slice(end);
  }
  return out;
}

function frontMatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join('\n')}\n---\n\n`;
}

/** JSON strings are valid YAML double-quoted scalars. */
const quote = (value) => JSON.stringify(value);

function requireTitle(sourcePath, tree) {
  const [first] = tree.children;
  if (!first || first.type !== 'heading' || first.depth !== 1) {
    fail(sourcePath, first, 'expected the file to start with a "# " title');
  }
  const extra = tree.children.find((n) => n !== first && n.type === 'heading' && n.depth === 1);
  if (extra) fail(sourcePath, extra, 'found a second "# " title');
  const title = toString(first).trim();
  if (!title) fail(sourcePath, first, 'the "# " title is empty');
  return title;
}

/**
 * Validates one `changelog/<module>/<version>.md` and extracts what the post's
 * front matter needs. Throws ContentError on anything malformed.
 */
export function parseChangelog(source, {sourcePath, version}) {
  const tree = parse(source);
  const title = requireTitle(sourcePath, tree);

  if (!title.endsWith(version.name)) {
    fail(sourcePath, tree.children[0], `title "${title}" does not end with the file's version "${version.name}"`);
  }

  const list = tree.children[1];
  if (!list || list.type !== 'list') {
    fail(sourcePath, list, 'expected the metadata list (Released, Range, Wire version) directly after the title');
  }

  const released = list.children
    .map((item) => ({item, text: toString(item).trim()}))
    .find(({text}) => text.startsWith('Released:'));
  if (!released) {
    fail(sourcePath, list, 'no "Released:" entry in the metadata list');
  }

  const m = /^Released:\s*(\d{4}-\d{2}-\d{2})(?!\d)/.exec(released.text);
  const date = m?.[1];
  const midnight = new Date(`${date}T00:00:00Z`);
  // Rejects impossible dates like 2026-02-30, which Date would silently roll over.
  if (!date || Number.isNaN(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== date) {
    fail(sourcePath, released.item, `"Released:" must start with a YYYY-MM-DD date, got "${released.text}"`);
  }

  const dash = title.indexOf(' — ');
  return {
    tree,
    title,
    date,
    product: dash === -1 ? null : title.slice(0, dash),
    metadataEnd: list.position.end.offset,
  };
}

/**
 * Renders a parsed changelog as a blog post. `order` breaks ties between
 * releases sharing a date: the blog sorts by timestamp only, so each post gets
 * `order` seconds past midnight UTC. The displayed date is unaffected.
 */
export function renderChangelogPost(source, parsed, {sourcePath, module, version, order, routes}) {
  const edits = linkEdits(source, parsed.tree, sourcePath, routes);
  edits.push({start: parsed.metadataEnd, end: parsed.metadataEnd, text: '\n\n<!-- truncate -->'});

  if (order >= 3600) {
    throw new ContentError(`${sourcePath}: more than 3600 releases on ${parsed.date}`);
  }
  const minutes = String(Math.floor(order / 60)).padStart(2, '0');
  const seconds = String(order % 60).padStart(2, '0');

  return (
    frontMatter({
      title: quote(parsed.title),
      // Otherwise the excerpt's first line ("- Released: …") becomes the meta and feed description.
      description: quote(`${parsed.title}, released ${parsed.date}.`),
      date: `${parsed.date}T00:${minutes}:${seconds}Z`,
      slug: `/${module}/${version.name}`,
      tags: `[${module}]`,
    }) + applyEdits(source, edits)
  );
}

/** Renders a README or reference doc as a docs page. */
export function renderDocPage(source, {sourcePath, slug, sidebarLabel, routes}) {
  const tree = parse(source);
  requireTitle(sourcePath, tree);
  return (
    frontMatter({
      slug,
      sidebar_label: sidebarLabel === undefined ? undefined : quote(sidebarLabel),
    }) + applyEdits(source, linkEdits(source, tree, sourcePath, routes))
  );
}
