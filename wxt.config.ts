import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'OpenSpec Tab for GitHub',
    description:
      'Adds an OpenSpec tab to GitHub pull requests: read and review spec changes as requirements and scenarios, not raw Markdown.',
    // github.com: the content script and same-origin file reads with the signed-in session.
    // api.github.com: pull request facts and the openspec/ tree, with an optional read-only token.
    host_permissions: ['https://github.com/*', 'https://api.github.com/*'],
    permissions: ['storage'],
  },
});
