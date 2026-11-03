// Spike: docs site for Arya, built from the repo's own Markdown (see scripts/sync.mjs).
const baseUrl = process.env.DOCS_BASE_URL || '/';
module.exports = {
  title: 'Arya docs',
  tagline: 'Arya learns how you shop from your receipts and helps shoppers help each other',
  favicon: 'repo/assistant/pwa/icons/favicon-48.png',
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
    image: 'repo/docs/images/social-preview.png',
    prism: {theme: require('prism-react-renderer').themes.github},
    colorMode: {defaultMode: 'light', disableSwitch: true, respectPrefersColorScheme: false},
    navbar: {
      title: 'Arya',
      logo: {alt: 'Arya basket icon', src: 'repo/assistant/pwa/icons/icon-192.png', width: 28, height: 28},
      items: [
        {to: '/docs/intro', label: 'Docs', position: 'left'},
        {to: '/docs/guide/user-journeys', label: 'Using Arya', position: 'left'},
        {to: '/api-reference', label: 'API reference', position: 'left'},
        {href: 'https://github.com/vibhortayal/arya', label: 'GitHub', position: 'right'},
        {href: 'https://arya.teamnightshift.org', label: 'Open Arya', position: 'right'},
      ],
    },
    footer: {style: 'light', copyright: 'Docs are generated from the repository Markdown.',
      links: [{title: 'Read these docs as plain text', items: [{html: `<a class="footer__link-item" href="${baseUrl}llms.txt">Short index (llms.txt)</a>`}, {html: `<a class="footer__link-item" href="${baseUrl}llms-full.txt">Everything in one file (llms-full.txt)</a>`}]}]},
  },
};
