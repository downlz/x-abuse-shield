/**
 * Every x.com DOM selector lives here, so a markup change on X is a one-file
 * fix. Prefer data-testid / role attributes: class names are generated and
 * change with every X deploy. Checked against maintained open-source X
 * extensions, Oct 2026.
 */
export const X = {
  primaryColumn: '[data-testid="primaryColumn"]',
  timelineCell: '[data-testid="cellInnerDiv"]',
  post: 'article[data-testid="tweet"]',
  postText: '[data-testid="tweetText"]',
  /** First link inside is the author's profile: href="/<handle>". */
  postAuthor: '[data-testid="User-Name"]',
  /** The permalink wraps the timestamp: <a href="/<handle>/status/<id>"><time datetime=…>. */
  postTime: 'a[href*="/status/"] time',
  postAvatar: '[data-testid="Tweet-User-Avatar"] img',
  verifiedBadge: 'svg[data-testid="icon-verified"]',
  /** A quoted post is a div with role="link" inside the article. (X's plain <a> links carry role="link" too.) */
  quoteCard: 'div[role="link"]',
  /** The line above a repost, "<name> reposted", linking to the reposter's profile. Also "Pinned" (no link). */
  socialContext: '[data-testid="socialContext"]',
  /** "For you" is the first tab on /home, "Following" the second. Text is localised, so match by position. */
  homeTabs: '[data-testid="primaryColumn"] [role="tablist"] [role="tab"]',
  /** The logged-in user's profile link in the side navigation: href="/<handle>". */
  ownProfileLink: 'a[data-testid="AppTabBar_Profile_Link"]',
  /** The post's "More" (⋯) button, and the menu it opens in #layers: a dropdown, or a bottom sheet in the phone layout. */
  postMenuButton: '[data-testid="caret"]',
  postMenu: '#layers [data-testid="Dropdown"], #layers [data-testid="sheetDialog"]',
  menuItem: '[role="menuitem"]',
  /** "Block @handle"; "Mute @handle" sits right before it. A mute test id is used if X adds one. */
  blockMenuItem: '[data-testid="block"]',
  muteMenuItem: '[data-testid="mute"]',
} as const;

/** /<handle>/status/<id> — a post opened on its own page, with its replies. */
export const THREAD_PATH = /^\/[A-Za-z0-9_]{1,20}\/status\/(\d+)/;
export const STATUS_HREF = /\/status\/(\d+)/;
/** A profile link: /<handle>. */
export const PROFILE_HREF = /^\/([A-Za-z0-9_]{1,15})$/;
export const NOTIFICATIONS_PATH = /^\/notifications(\/|$)/;
