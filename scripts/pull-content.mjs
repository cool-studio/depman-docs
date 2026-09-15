#!/usr/bin/env node
// Usage: node scripts/pull-content.mjs --from <depman checkout>
// Prefer ./scripts/pull-content.sh, which calls this.

import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {renderContent, writeContent} from './lib/pull.mjs';
import {ContentError} from './lib/transform.mjs';

const siteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(siteRoot, 'generated');

const usage = 'usage: scripts/pull-content.sh --from <path to a depman checkout>';

let from;
try {
  ({values: {from}} = parseArgs({options: {from: {type: 'string'}}}));
} catch (err) {
  console.error(`${err.message}\n${usage}`);
  process.exit(2);
}
if (!from) {
  console.error(usage);
  process.exit(2);
}
from = path.resolve(from);

try {
  const {files, releases, clients} = await renderContent(from);
  await writeContent(out, files);
  const modules = new Set(releases.map((r) => r.module));
  console.log(
    `Pulled ${releases.length} releases across ${modules.size} modules (${[...modules].join(', ')}), ` +
      `${clients.length} client docs (${clients.map((c) => c.dir).join(', ')}) and the reference docs ` +
      `from ${from} into ${path.relative(process.cwd(), out) || '.'}/`,
  );
} catch (err) {
  const errors = err instanceof AggregateError ? err.errors : [err];
  console.error(`pull-content failed: ${err.message}`);
  for (const e of errors) console.error(`  - ${e.message}`);
  if (process.env.GITHUB_ACTIONS) {
    for (const e of errors) console.error(`::error title=pull-content::${e.message}`);
  }
  // Content problems are fully described by their message; anything else is a bug here.
  for (const e of errors) {
    if (!(e instanceof ContentError)) console.error(e.stack);
  }
  process.exit(1);
}
