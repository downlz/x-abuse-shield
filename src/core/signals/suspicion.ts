/** What we know about a post's author, from X's API responses or, failing that, the page. */
export interface AccountRecord {
  handle: string;
  id?: string;
  name?: string;
  /** Epoch ms. */
  createdAt?: number;
  followers?: number;
  following?: number;
  defaultAvatar?: boolean;
  bio?: string;
  blueVerified?: boolean;
  /** The logged-in user follows this account. */
  youFollow?: boolean;
  /** 'dom' records only know the handle and avatar. */
  source: 'api' | 'dom';
}

export type SuspicionLevel = 'low' | 'medium' | 'high';

export interface SignalWeights {
  ageUnder30Days: number;
  ageUnder180Days: number;
  fewFollowers: number;
  followRatio: number;
  defaultAvatar: number;
  generatedHandle: number;
  bioKeyword: number;
}

/** Starting values from PLAN §5.1, calibrated in Phase 2. */
export const DEFAULT_SIGNAL_WEIGHTS: SignalWeights = {
  ageUnder30Days: 0.35,
  ageUnder180Days: 0.15,
  fewFollowers: 0.2,
  followRatio: 0.15,
  defaultAvatar: 0.15,
  generatedHandle: 0.15,
  bioKeyword: 0.2,
};

/**
 * X's auto-generated handle shape: letters then 8+ digits ("Srihars47664037").
 * Six digits or an underscore also matched date-like handles ("Sirius_091283").
 */
export const GENERATED_HANDLE = /^[A-Za-z]{1,15}\d{8,}$/;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Assessment {
  score: number;
  level: SuspicionLevel;
  /** Human-readable, for the review log: "account 9 days old". */
  reasons: string[];
}

export function assessAccount(
  account: AccountRecord,
  options: { weights: SignalWeights; bioKeywords: string[] },
  now: number,
): Assessment {
  // You chose to follow them: not a throwaway account to be wary of.
  if (account.youFollow) return { score: 0, level: 'low', reasons: [] };
  const { weights } = options;
  let score = 0;
  const reasons: string[] = [];
  const add = (weight: number, reason: string) => {
    if (weight <= 0) return;
    score += weight;
    reasons.push(reason);
  };

  if (account.createdAt !== undefined) {
    const days = Math.floor((now - account.createdAt) / DAY_MS);
    if (days < 30) add(weights.ageUnder30Days, `account ${days} ${days === 1 ? 'day' : 'days'} old`);
    else if (days < 180) add(weights.ageUnder180Days, `account ${Math.round(days / 30)} months old`);
  }
  if (account.followers !== undefined && account.followers < 50) {
    add(weights.fewFollowers, `${account.followers} ${account.followers === 1 ? 'follower' : 'followers'}`);
  }
  if (account.following !== undefined && account.followers !== undefined && account.following > 100) {
    const ratio = account.following / Math.max(account.followers, 1);
    if (ratio > 10) add(weights.followRatio, `follows ${Math.round(ratio)}× more accounts than follow it`);
  }
  if (account.defaultAvatar) add(weights.defaultAvatar, 'default avatar');
  if (GENERATED_HANDLE.test(account.handle)) add(weights.generatedHandle, 'auto-generated handle');
  if (account.bio) {
    const bio = account.bio.toLowerCase();
    const keyword = options.bioKeywords.find((k) => k.trim() && bio.includes(k.trim().toLowerCase()));
    if (keyword) add(weights.bioKeyword, `bio mentions “${keyword.trim()}”`);
  }

  // Rounded so sums like 0.15 + 0.15 land exactly on the level boundaries.
  score = Math.min(Math.round(score * 100) / 100, 1);
  let level: SuspicionLevel = score >= 0.6 ? 'high' : score >= 0.3 ? 'medium' : 'low';
  // Without X's data only the avatar and handle are known — too little to call an account highly suspicious.
  if (account.source === 'dom' && level === 'high') level = 'medium';
  return { score, level, reasons };
}
