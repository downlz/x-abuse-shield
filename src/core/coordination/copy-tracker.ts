import { hammingDistance, simhash, type SimHash } from './simhash';

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

interface Group {
  keys: Set<string>;
  hashes: SimHash[];
  copies: Copy[];
}

/**
 * Measured on brigade-style rewrites (a word added, swapped or dropped): 5–15
 * bits apart; unrelated replies on the same topic: 18–29. 12 keeps a wide
 * margin from unrelated text, since a cluster makes every member highly
 * suspicious.
 */
export const NEAR_DUPLICATE_BITS = 12;

/**
 * A tab stays open for hours and nearly every post starts its own group, so groups are capped: the least
 * recently active go first. Every new post is compared with every group's fingerprints, so the cap also
 * keeps that check from slowing down as the session goes on. A brigade needs only minAuthors copies
 * within minutes; the newest copies of a group are the ones kept.
 */
export const MAX_GROUPS = 2000;
export const MAX_COPIES_PER_GROUP = 100;

/**
 * Groups posts with the same or near-identical fingerprints and reports
 * copy-paste clusters: at least `minAuthors` distinct authors posting within
 * `windowMinutes`. Only sees posts loaded in this tab.
 */
export class CopyTracker {
  private readonly groups: Group[] = [];
  private readonly groupOfKey = new Map<string, Group>();
  private readonly groupOfPost = new Map<string, Group>();

  constructor(private options: CopyOptions) {}

  setOptions(options: CopyOptions) {
    this.options = options;
  }

  /** Records a post and returns the ids of every post in its cluster (empty if none). */
  add(key: string, copy: Copy): string[] {
    if (!this.groupOfPost.has(copy.postId)) {
      let group = this.groupOfKey.get(key);
      if (!group) {
        const hash = simhash(key);
        group = this.groups.find((g) => g.hashes.some((h) => hammingDistance(h, hash) <= NEAR_DUPLICATE_BITS));
        if (!group) {
          group = { keys: new Set(), hashes: [], copies: [] };
          this.groups.push(group);
        }
        if (group.hashes.length < MAX_COPIES_PER_GROUP) {
          group.keys.add(key);
          group.hashes.push(hash);
          this.groupOfKey.set(key, group);
        }
      }
      group.copies.push(copy);
      this.groupOfPost.set(copy.postId, group);
      if (group.copies.length > MAX_COPIES_PER_GROUP) this.groupOfPost.delete(group.copies.shift()!.postId);
      this.touch(group);
    }
    return this.clusterOf(copy.postId);
  }

  groupCount(): number {
    return this.groups.length;
  }

  /** Marks a group as the most recently active, and forgets the least recently active past MAX_GROUPS. */
  private touch(group: Group): void {
    const at = this.groups.lastIndexOf(group);
    if (at !== this.groups.length - 1) {
      this.groups.splice(at, 1);
      this.groups.push(group);
    }
    while (this.groups.length > MAX_GROUPS) {
      const old = this.groups.shift()!;
      for (const key of old.keys) if (this.groupOfKey.get(key) === old) this.groupOfKey.delete(key);
      for (const c of old.copies) if (this.groupOfPost.get(c.postId) === old) this.groupOfPost.delete(c.postId);
    }
  }

  clusterOf(postId: string): string[] {
    const group = this.groupOfPost.get(postId);
    if (!group) return [];
    const copies = [...group.copies].sort((a, b) => a.postedAt - b.postedAt);
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
