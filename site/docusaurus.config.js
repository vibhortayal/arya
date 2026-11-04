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
      links: [{title: 'Links and contact', items: [{html: `<a class="footer__link-item arya-link" href="https://github.com/vibhortayal/arya" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg><span>Arya on GitHub</span></a>`}, {html: `<a class="footer__link-item arya-link" href="https://github.com/vibhortayal/" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg><span>GitHub profile</span></a>`}, {html: `<a class="footer__link-item arya-link" href="https://www.linkedin.com/in/vibhortayal" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg><span>LinkedIn</span></a>`}, {html: `<a class="footer__link-item arya-link" href="https://x.com/VibTayal" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path fill="currentColor" stroke="none" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg><span>X (@VibTayal)</span></a>`}, {html: `<a class="footer__link-item arya-link" href="https://vibhortayal.github.io/" target="_blank" rel="noopener"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg><span>Website</span></a>`}, {html: `<a class="footer__link-item arya-link" href="mailto:support@teamnightshift.org"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg><span>Email</span></a>`}]}, {title: 'Read these docs as plain text', items: [{html: `<a class="footer__link-item" href="${baseUrl}llms.txt">Short index (llms.txt)</a>`}, {html: `<a class="footer__link-item" href="${baseUrl}llms-full.txt">Everything in one file (llms-full.txt)</a>`}]}]},
  },
};
