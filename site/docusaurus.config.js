// Spike: docs site for Arya, built from the repo's own Markdown (see scripts/sync.mjs).
const baseUrl = process.env.DOCS_BASE_URL || '/';
module.exports = {
  title: 'Arya docs',
  tagline: 'Arya learns how you shop from your receipts and helps shoppers help each other',
  url: process.env.DOCS_URL || 'http://localhost:3000',
  baseUrl,
  onBrokenLinks: 'warn',
  onBrokenAnchors: 'ignore',
  markdown: {format: 'detect', hooks: {onBrokenMarkdownLinks: 'warn'}},
  staticDirectories: ['static', 'generated/static'],
  presets: [['classic', {
    docs: {path: 'generated/docs', routeBasePath: 'docs', sidebarPath: './sidebars.js'},
    blog: false,
    theme: {customCss: './src/custom.css'},
  }]],
  plugins: [],
  themes: [['@easyops-cn/docusaurus-search-local', {
    hashed: true, indexBlog: false, docsRouteBasePath: '/docs', docsDir: 'generated/docs',
  }]],
  themeConfig: {
    colorMode: {defaultMode: 'light', disableSwitch: true, respectPrefersColorScheme: false},
    navbar: {
      title: 'Arya',
      items: [
        {to: '/docs/intro', label: 'Docs', position: 'left'},
        {to: '/docs/guide/user-journeys', label: 'Using Arya', position: 'left'},
        {to: '/api-reference', label: 'API reference', position: 'left'},
        {href: 'https://github.com/vibhortayal/arya', label: 'GitHub', position: 'right'},
        {href: 'https://arya.teamnightshift.org', label: 'Open Arya', position: 'right'},
      ],
    },
    footer: {style: 'light', copyright: 'Built for the Meta AI Developer Hackathon. Docs are generated from the repository Markdown.'},
  },
};
