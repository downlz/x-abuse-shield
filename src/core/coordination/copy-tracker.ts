export interface CopyOptions {
  windowMinutes: number;
  minAuthors: number;
}

interface Copy {
  postId: string;
  /** Lowercase handle. */
  author: string;
  /** Epoch ms the post was published (not when it was seen). */
  postedAt: number;
}

/**
 * Groups posts by fingerprint and reports copy-paste clusters: at least
 * `minAuthors` distinct authors posting the same text within `windowMinutes`.
 * Only sees posts loaded in this tab.
 */
export class CopyTracker {
  private readonly byKey = new Map<string, Copy[]>();
  private readonly keyOf = new Map<string, string>();

  constructor(private options: CopyOptions) {}

  setOptions(options: CopyOptions) {
    this.options = options;
  }

  /** Records a post and returns the ids of every post in its cluster (empty if none). */
  add(key: string, copy: Copy): string[] {
    if (!this.keyOf.has(copy.postId)) {
      this.keyOf.set(copy.postId, key);
      this.byKey.set(key, [...(this.byKey.get(key) ?? []), copy]);
    }
    return this.clusterOf(copy.postId);
  }

  clusterOf(postId: string): string[] {
    const key = this.keyOf.get(postId);
    if (key === undefined) return [];
    const copies = [...(this.byKey.get(key) ?? [])].sort((a, b) => a.postedAt - b.postedAt);
    const windowMs = this.options.windowMinutes * 60_000;
    const members = new Set<string>();
    for (let start = 0; start < copies.length; start++) {
      const inWindow = copies.filter(
        (c) => c.postedAt >= copies[start]!.postedAt && c.postedAt - copies[start]!.postedAt <= windowMs,
      );
      if (new Set(inWindow.map((c) => c.author)).size >= this.options.minAuthors) {
        inWindow.forEach((c) => members.add(c.postId));
      }
    }
    return members.has(postId) ? [...members] : [];
  }
}
