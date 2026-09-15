import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {after, before, describe, test} from 'node:test';
import {renderContent, writeContent} from './pull.mjs';

const release = (title, date) => `# ${title}

- **Released:** ${date}
- **Range:** \`a..b\`
- **Wire version:** unchanged.

## Added

- Something (\`abc1234\`).
`;

const fixture = {
  'changelog/api/v0.1.9.md': release('DepMan API — v0.1.9', '2026-09-02'),
  'changelog/api/v0.1.10.md': release('DepMan API — v0.1.10', '2026-09-03'),
  'changelog/npm-client/v0.1.0.md': release('DepMan npm Client — npm-client/v0.1.0', '2026-09-03'),
  'changelog/brand-new-client/v1.0.0.md': release('DepMan Brand New Client — brand-new-client/v1.0.0', '2026-09-03'),
  'packages/npm-client/README.md': '# @depman/client\n\n[MIT](LICENSE)\n',
  'packages/composer-client/README.md': '# depman/client\n',
  'packages/no-readme/src/index.js': '',
  'docs/depman-json.md': '# depman.json\n\nSee [the API](ingest-api.md).\n',
  'docs/ingest-api.md': '# Ingest API v1\n',
  'docs/architecture.md': '# Internal\n',
  'docs/decisions/0001-x.md': '# Internal ADR\n',
};

async function writeTree(root, files) {
  for (const [rel, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), {recursive: true});
    await fs.writeFile(path.join(root, rel), contents);
  }
}

async function readTree(root) {
  const out = {};
  for (const rel of (await fs.readdir(root, {recursive: true})).sort()) {
    const stat = await fs.stat(path.join(root, rel));
    if (stat.isFile()) out[rel] = await fs.readFile(path.join(root, rel), 'utf8');
  }
  return out;
}

describe('pull', () => {
  let tmp;
  before(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'depman-site-'));
  });
  after(() => fs.rm(tmp, {recursive: true, force: true}));

  test('publishes exactly the consumer content, discovering modules and clients', async () => {
    const from = path.join(tmp, 'depman');
    await writeTree(from, fixture);
    const {files} = await renderContent(from);
    assert.deepEqual([...files.keys()].sort(), [
      'changelog/api/v0.1.10.md',
      'changelog/api/v0.1.9.md',
      'changelog/brand-new-client/v1.0.0.md',
      'changelog/npm-client/v0.1.0.md',
      'changelog/tags.yml',
      'docs/clients/_category_.json',
      'docs/clients/composer-client.md',
      'docs/clients/npm-client.md',
      'docs/reference/_category_.json',
      'docs/reference/depman-json.md',
      'docs/reference/ingest-api.md',
    ]);
    assert.match(files.get('changelog/tags.yml'), /^brand-new-client:\n {2}label: "DepMan Brand New Client"$/m);
    assert.match(files.get('docs/reference/depman-json.md'), /\[the API\]\(\/docs\/reference\/ingest-api\)/);
  });

  test('orders same-date releases by module, then version', async () => {
    const {files} = await renderContent(path.join(tmp, 'depman'));
    const date = (p) => files.get(p).match(/^date: (.*)$/m)[1];
    assert.equal(date('changelog/api/v0.1.9.md'), '2026-09-02T00:00:00Z');
    assert.equal(date('changelog/api/v0.1.10.md'), '2026-09-03T00:00:00Z');
    assert.equal(date('changelog/brand-new-client/v1.0.0.md'), '2026-09-03T00:00:01Z');
    assert.equal(date('changelog/npm-client/v0.1.0.md'), '2026-09-03T00:00:02Z');
  });

  test('is idempotent and removes stale output', async () => {
    const from = path.join(tmp, 'depman');
    const out = path.join(tmp, 'generated');
    await writeTree(out, {'changelog/api/v0.0.1.md': 'stale'});

    await writeContent(out, (await renderContent(from)).files);
    const first = await readTree(out);
    await writeContent(out, (await renderContent(from)).files);
    assert.deepEqual(await readTree(out), first);
    assert.equal(first['changelog/api/v0.0.1.md'], undefined);
  });

  test('reports every malformed changelog at once and renders nothing', async () => {
    const from = path.join(tmp, 'broken');
    await writeTree(from, {
      ...fixture,
      'changelog/api/v0.1.11.md': '# DepMan API — v0.1.11\n\n- **Released:** TBD\n',
      'changelog/npm-client/v0.1.1.md': 'no title\n',
      'changelog/npm-client/notes.md': '# notes\n',
    });
    await assert.rejects(renderContent(from), (err) => {
      assert.ok(err instanceof AggregateError);
      const messages = err.errors.map((e) => e.message).join('\n');
      assert.match(messages, /changelog\/npm-client\/notes\.md: file name must be a version/);
      return true;
    });

    await fs.rm(path.join(from, 'changelog/npm-client/notes.md'));
    await assert.rejects(renderContent(from), (err) => {
      assert.deepEqual(err.errors.map((e) => e.message.split(':')[0]).sort(), [
        'changelog/api/v0.1.11.md',
        'changelog/npm-client/v0.1.1.md',
      ]);
      return true;
    });
  });

  test('fails clearly when pointed at something that is not a depman checkout', async () => {
    await assert.rejects(renderContent(tmp), (err) => {
      assert.match(err.errors[0].message, /changelog: not found in .*Is this a depman checkout\?/);
      return true;
    });
  });
});
