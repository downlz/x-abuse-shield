import { dispatchRecords } from '@/adapters/x-api/bridge';
import { collectRecords } from '@/adapters/x-api/collect';
import { installApiReader, operationName } from '@/adapters/x-api/reader';

/**
 * Runs in the page's own JavaScript world, before X's scripts, to read the
 * account and post data X fetches for itself. It makes no requests.
 */
export default defineContentScript({
  matches: ['https://x.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    installApiReader(globalThis, (url, json) => {
      const records = collectRecords(json);
      if (records.users.length > 0 || records.posts.length > 0) {
        dispatchRecords({ ...records, operation: operationName(url) });
      }
    });
  },
});
