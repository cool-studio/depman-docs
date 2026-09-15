import assert from 'node:assert/strict';
import {describe, test} from 'node:test';
import {
  ContentError,
  compareVersions,
  parseChangelog,
  parseVersionFile,
  renderChangelogPost,
  renderDocPage,
} from './transform.mjs';

const changelog = (overrides = {}) => {
  const o = {
    title: '# DepMan npm Client — npm-client/v0.1.4',
    released: '- **Released:** 2026-09-15',
    body: '## Fixed\n\n- A fix (`abc1234`).\n',
    ...overrides,
  };
  return `${o.title}

${o.released}
- **Range:** \`npm-client/v0.1.3..npm-client/v0.1.4\` — one commit;
  5 files under \`packages/npm-client/\`
- **Wire version:** unchanged, \`1\`.

Intro paragraph.

${o.body}`;
};

const version = parseVersionFile('v0.1.4.md');
const sourcePath = 'changelog/npm-client/v0.1.4.md';
const opts = {sourcePath, version};
const noRoutes = new Map();

const render = (source, extra = {}) =>
  renderChangelogPost(source, parseChangelog(source, opts), {
    sourcePath,
    module: 'npm-client',
    version,
    order: 0,
    routes: noRoutes,
    ...extra,
  });

describe('versions', () => {
  test('parses and orders numerically, not lexically', () => {
    const names = ['v0.1.10.md', 'v0.1.9.md', 'v0.1.10-rc.1.md', 'v1.0.0.md'];
    const sorted = names.map(parseVersionFile).sort(compareVersions).map((v) => v.name);
    assert.deepEqual(sorted, ['v0.1.9', 'v0.1.10-rc.1', 'v0.1.10', 'v1.0.0']);
  });

  test('rejects non-version file names', () => {
    assert.equal(parseVersionFile('README.md'), null);
    assert.equal(parseVersionFile('v0.1.md'), null);
  });
});

describe('parseChangelog', () => {
  test('extracts title, date and product', () => {
    const parsed = parseChangelog(changelog(), opts);
    assert.equal(parsed.title, 'DepMan npm Client — npm-client/v0.1.4');
    assert.equal(parsed.date, '2026-09-15');
    assert.equal(parsed.product, 'DepMan npm Client');
  });

  test('accepts text after the date', () => {
    const source = changelog({released: '- **Released:** 2026-09-03. **Untagged** — see below'});
    assert.equal(parseChangelog(source, opts).date, '2026-09-03');
  });

  const malformed = {
    'no title': changelog({title: 'DepMan npm Client — npm-client/v0.1.4'}),
    'H2 instead of H1': changelog({title: '## DepMan npm Client — npm-client/v0.1.4'}),
    'title for another version': changelog({title: '# DepMan npm Client — npm-client/v0.1.3'}),
    'second H1': changelog({body: '# Another title\n'}),
    'no Released entry': changelog({released: '- **Shipped:** 2026-09-15'}),
    'Released without a date': changelog({released: '- **Released:** soon'}),
    'impossible date': changelog({released: '- **Released:** 2026-02-30'}),
    'US date format': changelog({released: '- **Released:** 09/15/2026'}),
    'no metadata list': '# DepMan npm Client — npm-client/v0.1.4\n\nReleased: 2026-09-15\n',
    'empty file': '',
  };
  for (const [name, source] of Object.entries(malformed)) {
    test(`fails on ${name}`, () => {
      assert.throws(() => parseChangelog(source, opts), (err) => {
        assert.ok(err instanceof ContentError);
        assert.match(err.message, /^changelog\/npm-client\/v0\.1\.4\.md/);
        return true;
      });
    });
  }
});

describe('renderChangelogPost', () => {
  test('adds front matter and a truncate marker, and otherwise leaves the body alone', () => {
    const source = changelog();
    const out = render(source, {order: 62});
    const [, fm, body] = out.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
    assert.equal(
      fm,
      [
        'title: "DepMan npm Client — npm-client/v0.1.4"',
        'description: "DepMan npm Client — npm-client/v0.1.4, released 2026-09-15."',
        'date: 2026-09-15T00:01:02Z',
        'slug: /npm-client/v0.1.4',
        'tags: [npm-client]',
      ].join('\n'),
    );
    assert.equal(body.replace('\n\n<!-- truncate -->', ''), source);
    assert.match(body, /`1`\.\n\n<!-- truncate -->\n\nIntro paragraph\./);
  });

  test('escapes quotes in the title', () => {
    const source = changelog({title: '# The "quoted" release — v0.1.4'});
    assert.match(render(source), /^title: "The \\"quoted\\" release — v0\.1\.4"$/m);
  });
});

describe('links', () => {
  const routes = new Map([
    ['changelog/npm-client/v0.1.3.md', '/changelog/npm-client/v0.1.3'],
    ['docs/ingest-api.md', '/docs/reference/ingest-api'],
  ]);
  const doc = (body) => renderDocPage(`# Title\n\n${body}\n`, {sourcePath: 'docs/depman-json.md', slug: '/x', routes});
  const bodyOf = (out) => out.slice(out.indexOf('# Title\n\n') + 9, -1);

  test('points links to published files at their routes, keeping the fragment', () => {
    assert.equal(bodyOf(doc('See [`ingest-api.md`](ingest-api.md#limits).')), 'See [`ingest-api.md`](/docs/reference/ingest-api#limits).');
    assert.equal(bodyOf(doc('[prev](../changelog/npm-client/v0.1.3.md)')), '[prev](/changelog/npm-client/v0.1.3)');
  });

  test('resolves relative to the source file', () => {
    const body = bodyOf(
      renderDocPage('# Title\n\n[prev](v0.1.3.md) and [api](../../docs/ingest-api.md)\n', {
        sourcePath: 'changelog/npm-client/v0.1.4.md',
        slug: '/x',
        routes,
      }),
    );
    assert.equal(body, '[prev](/changelog/npm-client/v0.1.3) and [api](/docs/reference/ingest-api)');
  });

  test('unwraps links to unpublished files to their text', () => {
    assert.equal(bodyOf(doc('Per [ADR-0040](decisions/0040-x.md) and [**`ingest-clients.md`**](ingest-clients.md#0-rule).')), 'Per ADR-0040 and **`ingest-clients.md`**.');
    assert.equal(bodyOf(doc('[MIT](../LICENSE)')), 'MIT');
  });

  test('leaves absolute links, anchors, and code alone', () => {
    const body = '[npm](https://www.npmjs.com/) [top](#title) <https://depman.io> `[x](y.md)`\n\n```md\n[x](y.md)\n```';
    assert.equal(bodyOf(doc(body)), body);
  });

  test('rewrites links in tables', () => {
    assert.equal(bodyOf(doc('| a |\n|---|\n| [api](ingest-api.md) |')), '| a |\n|---|\n| [api](/docs/reference/ingest-api) |');
  });

  test('fails on relative images and HTML URLs rather than publishing them broken', () => {
    assert.throws(() => doc('![diagram](img/flow.png)'), /docs\/depman-json\.md:3: relative image "img\/flow\.png"/);
    assert.throws(() => doc('<img src="img/flow.png">'), ContentError);
    assert.throws(() => doc('[ref]: roadmap.md'), /not published/);
  });

  test('rewrites reference definitions to published files', () => {
    assert.equal(bodyOf(doc('[api][x]\n\n[x]: ingest-api.md')), '[api][x]\n\n[x]: /docs/reference/ingest-api');
  });
});

describe('renderDocPage', () => {
  test('requires a title', () => {
    assert.throws(() => renderDocPage('No title\n', {sourcePath: 'packages/x/README.md', slug: '/x', routes: noRoutes}), ContentError);
  });

  test('writes slug and sidebar label', () => {
    const out = renderDocPage('# @depman/client\n', {sourcePath: 'packages/npm-client/README.md', slug: '/clients/npm-client', sidebarLabel: 'npm-client', routes: noRoutes});
    assert.equal(out, '---\nslug: /clients/npm-client\nsidebar_label: "npm-client"\n---\n\n# @depman/client\n');
  });
});
