// @ts-check
import fs from 'node:fs';
import {themes as prismThemes} from 'prism-react-renderer';

// generated/ is written by scripts/pull-content.sh from a depman checkout and is
// never committed. Fail with instructions rather than a Docusaurus stack trace.
for (const dir of ['generated/docs', 'generated/changelog']) {
  if (!fs.existsSync(new URL(dir, import.meta.url))) {
    throw new Error(
      `${dir} is missing. Pull the content first: ./scripts/pull-content.sh --from <path to a depman checkout>`,
    );
  }
}

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'DepMan',
  tagline: 'Know when a security advisory covers a dependency you actually installed.',
  favicon: 'img/favicon.svg',

  future: {
    v4: true,
  },

  url: 'https://docs.depman.io',
  baseUrl: '/',
  trailingSlash: false,

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  onDuplicateRoutes: 'throw',

  markdown: {
    // Treat .md as CommonMark, not MDX. depman's files are written for GitHub
    // and contain things like `<severity>` and `{ulid}` outside code.
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          path: 'generated/docs',
          routeBasePath: 'docs',
          sidebarPath: './sidebars.js',
        },
        blog: {
          path: 'generated/changelog',
          routeBasePath: 'changelog',
          blogTitle: 'DepMan changelog',
          blogDescription: 'Every release of the DepMan application and its ingest clients.',
          blogSidebarTitle: 'All releases',
          blogSidebarCount: 'ALL',
          postsPerPage: 'ALL',
          showReadingTime: false,
          feedOptions: {
            type: ['rss', 'atom'],
            title: 'DepMan changelog',
            description: 'Every release of the DepMan application and its ingest clients.',
            copyright: `Copyright © ${new Date().getFullYear()} Cool Studio`,
            limit: false,
            xslt: true,
          },
          // The pull script generates tags.yml and a truncate marker for every
          // post, so any of these firing means the transform is broken.
          onInlineTags: 'throw',
          onInlineAuthors: 'throw',
          onUntruncatedBlogPosts: 'throw',
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'DepMan',
        items: [
          {type: 'docSidebar', sidebarId: 'docs', position: 'left', label: 'Docs'},
          {to: '/changelog', label: 'Changelog', position: 'left'},
          {href: 'pathname:///changelog/rss.xml', label: 'RSS', position: 'right'},
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {label: 'Clients', to: '/docs/clients'},
              {label: 'Reference', to: '/docs/reference'},
            ],
          },
          {
            title: 'Changelog',
            items: [
              {label: 'All releases', to: '/changelog'},
              {label: 'RSS', href: 'pathname:///changelog/rss.xml'},
              {label: 'Atom', href: 'pathname:///changelog/atom.xml'},
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Cool Studio.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'json', 'php', 'yaml'],
      },
    }),
};

export default config;
