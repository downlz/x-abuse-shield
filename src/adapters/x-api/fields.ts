/**
 * Every X API field path lives here, so a response-shape change on X is a
 * one-file fix (like selectors.ts for the DOM). Checked against maintained
 * open-source X clients, Oct 2026: GraphQL users keep handle, name and
 * creation date under `core` (older responses: `legacy`), the avatar under
 * `avatar.image_url`, and counts under `legacy`. Whether you follow an
 * account is `relationship_perspectives.following` (older: `legacy.following`).
 */
import type { AccountRecord } from '@/core/signals/suspicion';

export interface PostRecord {
  id: string;
  authorId?: string;
  authorHandle?: string;
  /** Full text, including long posts that the page truncates behind "Show more". */
  text?: string;
  lang?: string;
  /** Epoch ms. */
  createdAt?: number;
  inReplyToStatusId?: string;
  inReplyToHandle?: string;
  /** The post this one quotes. */
  quotedId?: string;
}

type Obj = Record<string, unknown>;

/** GraphQL user result: { rest_id, core: { screen_name, name, created_at }, legacy: { followers_count, … }, avatar, is_blue_verified }. */
export function readGraphqlUser(obj: Obj): AccountRecord | null {
  const core = asObj(obj.core);
  const legacy = asObj(obj.legacy);
  if (typeof obj.rest_id !== 'string' || !legacy || typeof legacy.followers_count !== 'number') return null;
  const handle = str(core?.screen_name) ?? str(legacy.screen_name);
  if (!handle) return null;
  const imageUrl = str(asObj(obj.avatar)?.image_url) ?? str(legacy.profile_image_url_https);
  return {
    handle,
    id: obj.rest_id,
    name: str(core?.name) ?? str(legacy.name),
    createdAt: date(core?.created_at ?? legacy.created_at),
    followers: num(legacy.followers_count),
    following: num(legacy.friends_count),
    defaultAvatar: bool(legacy.default_profile_image) ?? (imageUrl ? isDefaultAvatarUrl(imageUrl) : undefined),
    bio: str(legacy.description) ?? str(asObj(obj.profile_bio)?.description),
    blueVerified: bool(obj.is_blue_verified),
    youFollow: bool(asObj(obj.relationship_perspectives)?.following) ?? bool(legacy.following),
    source: 'api',
  };
}

/** REST v1.1 user, still used by some endpoints (e.g. notifications' globalObjects.users). */
export function readRestUser(obj: Obj): AccountRecord | null {
  if (typeof obj.id_str !== 'string' || typeof obj.screen_name !== 'string' || typeof obj.followers_count !== 'number') {
    return null;
  }
  const imageUrl = str(obj.profile_image_url_https);
  return {
    handle: obj.screen_name,
    id: obj.id_str,
    name: str(obj.name),
    createdAt: date(obj.created_at),
    followers: obj.followers_count,
    following: num(obj.friends_count),
    defaultAvatar: bool(obj.default_profile_image) ?? (imageUrl ? isDefaultAvatarUrl(imageUrl) : undefined),
    bio: str(obj.description),
    blueVerified: bool(obj.is_blue_verified),
    youFollow: bool(obj.following),
    source: 'api',
  };
}

/**
 * GraphQL tweet: { rest_id, legacy: { full_text, lang, created_at, user_id_str,
 * in_reply_to_status_id_str, in_reply_to_screen_name, quoted_status_id_str },
 * note_tweet, core.user_results.result, quoted_status_result.result }.
 * Also matches the inner `tweet` of TweetWithVisibilityResults, which has the same shape.
 */
export function readGraphqlTweet(obj: Obj): PostRecord | null {
  const legacy = asObj(obj.legacy);
  if (typeof obj.rest_id !== 'string' || !legacy || typeof legacy.full_text !== 'string') return null;
  const author = asObj(asObj(asObj(obj.core)?.user_results)?.result);
  const longText = str(asObj(asObj(asObj(obj.note_tweet)?.note_tweet_results)?.result)?.text);
  return {
    id: obj.rest_id,
    authorId: str(legacy.user_id_str) ?? str(author?.rest_id),
    authorHandle: author ? (readGraphqlUser(author)?.handle ?? undefined) : undefined,
    text: longText ?? legacy.full_text,
    lang: str(legacy.lang),
    createdAt: date(legacy.created_at),
    inReplyToStatusId: str(legacy.in_reply_to_status_id_str),
    inReplyToHandle: str(legacy.in_reply_to_screen_name),
    quotedId: str(legacy.quoted_status_id_str) ?? str(asObj(asObj(obj.quoted_status_result)?.result)?.rest_id),
  };
}

/** REST v1.1 tweet. */
export function readRestTweet(obj: Obj): PostRecord | null {
  const text = str(obj.full_text) ?? str(obj.text);
  if (typeof obj.id_str !== 'string' || text === undefined || typeof obj.user_id_str !== 'string') return null;
  return {
    id: obj.id_str,
    authorId: obj.user_id_str,
    text,
    lang: str(obj.lang),
    createdAt: date(obj.created_at),
    inReplyToStatusId: str(obj.in_reply_to_status_id_str),
    inReplyToHandle: str(obj.in_reply_to_screen_name),
    quotedId: str(obj.quoted_status_id_str),
  };
}

/**
 * The logged-in user's handle, from the Viewer query ({ data: { viewer: { user_results: { result } } } })
 * or REST account/settings.json ({ screen_name, … } without the id/followers of a user object).
 * The page's sidebar link isn't there in X's phone layout.
 */
export function readViewer(url: string, json: unknown): string | undefined {
  const data = asObj(asObj(json)?.data);
  for (const key of ['viewer', 'viewer_v2']) {
    const result = asObj(asObj(asObj(data?.[key])?.user_results)?.result);
    const handle = result ? readGraphqlUser(result)?.handle ?? str(asObj(result.core)?.screen_name) : undefined;
    if (handle) return handle;
  }
  if (/\/account\/settings\.json/.test(url)) return str(asObj(json)?.screen_name);
  return undefined;
}

export function isDefaultAvatarUrl(url: string): boolean {
  return url.includes('/default_profile_images/');
}

function asObj(value: unknown): Obj | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Obj) : undefined;
}
function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function bool(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}
/** X dates look like "Wed Oct 10 20:19:24 +0000 2018"; V8's Date parses them. */
function date(value: unknown): number | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : ms;
}
