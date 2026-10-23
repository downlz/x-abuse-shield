import type { AccountRecord } from '@/core/signals/suspicion';
import { readGraphqlTweet, readGraphqlUser, readRestTweet, readRestUser, type PostRecord } from './fields';

export interface Records {
  users: AccountRecord[];
  posts: PostRecord[];
}

/** Guards against pathological responses; a home timeline page is a few thousand nodes. */
const MAX_NODES = 250_000;

/**
 * Walks any X API response and picks out user and post records by shape, so
 * it keeps working when X moves entries around inside a response. Parents
 * are read before their children, so a GraphQL record wins over the bare
 * `legacy` object nested inside it.
 */
export function collectRecords(root: unknown): Records {
  const users = new Map<string, AccountRecord>();
  const posts = new Map<string, PostRecord>();
  const stack: unknown[] = [root];
  for (let visited = 0; stack.length > 0 && visited < MAX_NODES; visited++) {
    const node = stack.pop();
    if (typeof node !== 'object' || node === null) continue;
    if (Array.isArray(node)) {
      for (const child of node) if (typeof child === 'object' && child !== null) stack.push(child);
      continue;
    }
    const obj = node as Record<string, unknown>;
    const user = readGraphqlUser(obj) ?? readRestUser(obj);
    if (user && !users.has(user.handle.toLowerCase())) users.set(user.handle.toLowerCase(), user);
    const post = readGraphqlTweet(obj) ?? readRestTweet(obj);
    if (post && !posts.has(post.id)) posts.set(post.id, post);
    for (const child of Object.values(obj)) if (typeof child === 'object' && child !== null) stack.push(child);
  }

  const handleById = new Map([...users.values()].flatMap((u) => (u.id ? [[u.id, u.handle] as const] : [])));
  for (const post of posts.values()) {
    if (!post.authorHandle && post.authorId) post.authorHandle = handleById.get(post.authorId);
  }
  return { users: [...users.values()], posts: [...posts.values()] };
}
