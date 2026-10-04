import { defineContentScript } from 'wxt/utils/define-content-script';
import { answerMountedQueries } from '@/github/react';

/**
 * Runs in the page's own world, where React's properties on the DOM are
 * visible, and answers the one question the content script has: see `react.ts`.
 */
export default defineContentScript({
  matches: ['https://github.com/*'],
  world: 'MAIN',
  // There before the content script first asks.
  runAt: 'document_start',
  main() {
    answerMountedQueries();
  },
});
