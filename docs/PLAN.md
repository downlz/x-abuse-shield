# x-abuse-shield — Plan

Multilingual, on-device abuse filter for x.com. Chrome extension first, mobile later.

Judges both **what a post says** (model + word lists) and **who is saying it** (account signals + coordinated copy-paste replies), so new throwaway and paid troll accounts are caught on their first post.

Status: **Phase 1 built, awaiting validation on live x.com** — 2026-10-23. Phase 0 results: [SPIKE-REPORT.md](SPIKE-REPORT.md).

---

## 1. Detection model

`Horizon-Labs/multilingual-toxicity-small` via Transformers.js.

| Fact | Value | Plan impact |
|---|---|---|
| Architecture | mmBERT-small (ModernBERT), ~141M params, Apache-2.0 | Supported by Transformers.js 4.x |
| Output | 7 independent sigmoid scores: `toxicity`, `severe_toxicity`, `obscene`, `threat`, `insult`, `identity_attack`, `sexual_explicit` | One slider per category |
| Languages | 34; Hindi AUC 0.897, Hinglish AUC 0.749 | Hinglish backed by a word list |
| Size | q8 ONNX 268 MB + tokenizer 34 MB ≈ 300 MB | Downloaded once on first run, cached |
| Calibration | Non-English scores run lower (model card) | Per-language threshold offset |
| Weaknesses | Over-flags identity mentions and quoted/reclaimed language; misses sarcasm | Default action is a reversible blur; review log |

## 2. Decisions

| # | Decision | Choice |
|---|---|---|
| 1 | Muting | Local mute list + auto-mute after strikes. User-clicked "Mute on X" button in Phase 3. No X API automation |
| 2 | Default action | Blur with click-to-reveal; collapse for threats and severe toxicity |
| 3 | Cloud LLM tier | Out of scope. Only network call is the one-time model download |
| 4 | Distribution | Personal (load unpacked) first; Chrome Web Store-ready later |
| 5 | Languages | Model's 34 + built-in word lists for English, Hindi (Devanagari), Hinglish |
| 6 | Stack | TypeScript, WXT, React (popup/options), Vitest |
| 7 | Account data source | Read the user records in X's own API responses as the page loads them (passive, no extra requests). DOM-only fallback (avatar URL, handle) when a record is missing |
| 8 | Role of account signals | They lower thresholds; they never flag a clean post on their own. Copy-paste replies can be hidden even when clean, but only as an opt-in |
| 9 | Scopes | For you, Following, post replies, Notifications. Search is out for now |
| 10 | x.com fixtures | Hand-built HTML and API-response fixtures modelled on X's current markup (marked synthetic); real-world validation on live x.com via the health checks. Screenshots in `tests/fixtures/x/` are visual reference only |

## 3. Architecture

```
x.com tab
├─ API reader (MAIN world, document_start) ──────────────────────
│  wraps fetch/XHR, reads user records from X's timeline/thread
│  responses → postMessage to the content script. Makes no requests
└─ Content script ─────────────────────────────────────────────
   │  Observer   → watches the page for new posts
   │  Extractor  → post id, @handle, text (incl. emoji), timestamp, page context
   │  Accounts   → joins the post to its author record → suspicion score
   │  Fast path  → muted author? allowlisted? cached result? word-list hit?
   │               coordinated copy? (runs before the post is painted — no flash)
   │  Renderer   → blur / collapse / remove, "Show", "Not abusive", "Mute"
   │        │ batched messages
   ▼        ▼
Service worker (background)
   │  settings · mute list · strikes · stats · cache (IndexedDB)
   │  account records (7-day TTL) · reply fingerprints (24 h TTL)
   │  creates/closes the offscreen document
   ▼
Offscreen document (reason: WORKERS)
   └─ Transformers.js → ONNX Runtime (WASM, int8, multi-threaded)
      queue: visible posts first, batches of ~8, text cut to 256 tokens
```

`core/` holds platform-neutral logic (no Chrome APIs, no X selectors) so mobile ports reuse it.

### Phase 0 findings that change the design

- **Speed is a non-issue:** ~29 ms/post batched in Chrome (budget 150). Every post can be scored; the queue only needs to batch.
- **Hindi/Hinglish slurs are mostly missed by the model** (Balanced preset: Hindi 2/7, Hinglish 0/9 caught; abusive Hinglish scores ranged 0.11–0.69 while clean Hinglish reached 0.44). A per-language threshold offset alone cannot separate them. → The **word-list tier is the primary detector for Hindi/Hinglish**, not a backup, and the engine gets a **corroboration rule**: a strong word-list hit flags on its own; a mild term (e.g. *pagal*, *gadha*) flags when the model's toxicity is ≥ ~0.4.
- **English misses are implicit abuse** (veiled threat, sextortion, sexist and religious generalisations, sarcasm), plus one idiom false positive ("Kill it at your interview" → threat 0.74). → Add threat/extortion **phrase patterns** and a **benign-idiom list** that suppresses the threat category.
- **Model download:** 289 MB, ~55–64 s on the test connection; cached loads take ~2–3 s, including after a browser restart.
- **Memory is the real cost: +850–870 MB steady** in the extension process while the model is loaded (6 runs), with a transient **1.2–1.9 GB peak** during loading while V8 lazily frees load-time buffers. ONNX Runtime session options (CPU arena, graph optimisation) make no measurable difference, so library defaults stay. Closing the offscreen document returns the extension process to ~50 MB within 60 s. → **Load the model only while an x.com tab is open and unload after idle (default 5 min)**; offer a word-list-only mode, defaulting to it on devices reporting ≤ 4 GB (`navigator.deviceMemory`). Phase 2 investigates reductions (duplicate JS copy of the weights, tokenizer share).

## 4. Detection pipeline (per post)

1. Extract post id, author, text, timestamp (quoted post scored separately)
2. Muted author → hide immediately
3. Allowlisted author or own post → skip
4. Cache hit (post id / text hash) → apply
5. Account tier (sync): author record → suspicion level (§5.1)
6. Coordination tier (sync): fingerprint the text, look for copies by other authors (§5.2)
7. Word-list tier (sync): de-obfuscate (`f*ck`, `fuuuck`, leetspeak) and match EN/HI/Hinglish/custom lists
8. Model tier (async, queued, batched)
9. Decide: score ≥ category threshold − language offset − suspicion offset (§5.3; suspicion only for replies and mentions)
10. Act + record a strike against the author (every author in a flagged coordinated cluster gets one)
11. Strikes ≥ N within window → auto-mute (optional: instant mute on severe threat)

The review log records why: scores, word-list hits, and account reasons such as "account 9 days old · 12 followers · same reply as 4 other accounts in 6 min".

## 5. Account signals & coordination

Aimed at throwaway and paid troll accounts that brigade a post with insults that are often too mild for the model alone.

### 5.1 Account signals

From the author record in X's API responses: `created_at`, `followers_count`, `friends_count`, `default_profile_image`, `description`, `screen_name`. All field paths live in one file (`x-api/fields.ts`), like `selectors.ts`.

| Signal | Rule (starting values, calibrated in Phase 2) | Weight |
|---|---|---|
| Account age | < 30 days | +0.35 |
| | 30–180 days | +0.15 |
| Followers | < 50 | +0.20 |
| Follow ratio | following ÷ followers > 10 (and following > 100) | +0.15 |
| Default avatar | `default_profile_image` or default avatar URL | +0.15 |
| Handle pattern | X's auto-generated shape `^[A-Za-z]{1,15}\d{8,}$` (e.g. `Srihars47664037`). The looser `^[A-Za-z_]{1,10}\d{6,}$` also matched date-like handles such as `Sirius_091283` | +0.15 |
| Bio keywords | Match against a user-editable list (empty by default). Starter suggestions are neutral spam markers only ("follow back", "DM for promo"), never parties, religions or identities | +0.20 |

Suspicion = sum, capped at 1 → **low** (< 0.30) · **medium** (0.30–0.59) · **high** (≥ 0.60).

- No record yet (DOM fallback): only avatar and handle can count, so the level is capped at medium.
- Exempt: allowlisted accounts, own posts, and (Phase 4) accounts you follow.
- The subscription badge (`is_blue_verified`) is recorded and shown in the review log, but has weight 0 by default.

### 5.2 Coordination (copy-paste brigades)

- **Fingerprint:** extends the text-hash cache. Normalise the text (lowercase, de-obfuscate, strip @mentions, URLs and extra whitespace), then store an exact hash plus a 64-bit SimHash over word 3-grams.
- **Match:** another author's post with the same hash, or a SimHash within Hamming distance ≤ 3.
- **Cluster:** ≥ 3 distinct authors whose copies were posted within 10 minutes of each other. Uses post timestamps, not the time the user scrolled past them.
- **Too short to count:** texts under 5 words or 20 characters after normalisation ("lol", "😂😂", "true") match each other naturally.
- **Effect:** every author in a cluster is raised to high suspicion for that post. If any copy is flagged, every copy is flagged and each author gets a strike.
- **Opt-in:** "Hide copy-paste replies even if not abusive" (off by default) collapses whole clusters.
- **Limit:** it only sees posts loaded in this browser. Thread replies are the main case; one-off mentions on separate posts are rarely clustered.

### 5.3 Combined scoring

| Suspicion | Threshold offset | Mild word-list term |
|---|---|---|
| low | 0 | flags only with model toxicity ≥ ~0.4 (corroboration rule) |
| medium | −0.10 | flags with model toxicity ≥ ~0.25 |
| high | −0.20 | flags on its own |

- **Replies and mentions only.** Suspicion applies to posts aimed at someone: replies on a post's page, Notifications, and posts X marks as replies. Standalone posts are always scored as low suspicion.
- **Not for `identity_attack` or `obscene`.** Those categories misfire on identity mentions and friendly swearing, so their thresholds are never lowered.
- **Floor 0.45.** Offsets can't take a threshold below 0.45 (or the preset's own value, if lower). Clean Hinglish scored up to 0.44 in Phase 0.
- Offsets stack with the non-English offset, within the floor.
- Example (Balanced): insult threshold 0.70. A 9-day-old account with 12 followers and a default avatar (0.70, high) replying with insult 0.55 → threshold 0.50 → flagged. The same reply from a 6-year-old account with 3k followers → not flagged.
- Why (analysis of 65 scored posts, Balanced, model only): applying offsets to every post and category raised abusive posts caught from 20 to 31 of 41, but clean posts flagged from 2 to 7 of 24, including "I'm a proud gay man and I'm getting married" (identity_attack 0.49), "lol this meme is so dumb" and a post quoting an insult to condemn it. All of those were standalone posts. The old 0.20 floor made no difference at Balanced because those posts scored 0.49–0.74.

## 6. Scan engine settings

Starting thresholds (calibrated in Phase 2):

| Category | Relaxed | Balanced | Strict |
|---|---|---|---|
| toxicity | 0.90 | 0.75 | 0.50 |
| severe_toxicity | 0.60 | 0.40 | 0.25 |
| threat | 0.60 | 0.40 | 0.25 |
| insult | 0.85 | 0.70 | 0.50 |
| identity_attack | 0.70 | 0.50 | 0.35 |
| obscene | off | 0.85 | 0.60 |
| sexual_explicit | 0.80 | 0.60 | 0.40 |

Also configurable: action per severity · scopes (For you / Following / Replies / Notifications; focal post off) · strikes (3 in 7 days → mute 24h / 7d / 30d / forever) · built-in and custom word lists · allowlist · pre-blur until scored · non-English offset · account signals on/off and per-signal weights · bio keyword list · suspicion offsets · coordination window / minimum cluster size · hide copy-paste replies (opt-in) · model status / re-download / unload after idle · import/export JSON.

## 7. Project layout

```
x-abuse-shield/
├─ wxt.config.ts · package.json · tsconfig.json
├─ src/
│  ├─ core/                  # platform-neutral, reused on mobile
│  │  ├─ engine/             # decide, presets, categories
│  │  ├─ lexicon/            # normalize, match, lists/{en,hi,hinglish}.json
│  │  ├─ mute/               # muteList, strikes
│  │  ├─ signals/            # account suspicion score, handle patterns, bio match
│  │  ├─ coordination/       # fingerprint (hash + SimHash), clustering
│  │  └─ config/             # schema, defaults, migrate
│  ├─ adapters/
│  │  ├─ x-dom/              # selectors.ts (ALL X selectors), observer, extract, render, context
│  │  ├─ x-api/              # MAIN-world fetch/XHR reader, fields.ts (ALL response field paths)
│  │  ├─ storage/            # chrome.storage + IndexedDB behind an interface
│  │  └─ inference/          # transformers.js runner behind an interface
│  └─ entrypoints/           # content, background, offscreen, popup, options
├─ public/ort/               # ONNX Runtime wasm, bundled (MV3 bans remote code)
├─ scripts/                  # spike runner, reference, calibrate, copy-ort
├─ tests/                    # unit + x.com DOM and API-response fixtures
└─ docs/PLAN.md
```

## 8. Phases

### Phase 0 — Spike ✅ (fixtures pending)
- ✅ Model in an offscreen document with locally bundled ONNX Runtime (`'wasm-unsafe-eval'` CSP, COOP/COEP → 4 WASM threads)
- ✅ Measured download, cache load after restart, memory, latency (single and batch of 8) — `npm run spike:browser`
- ✅ Browser outputs identical to an onnxruntime-node reference run (max diff ~1e-7) on 54 EN/HI/Hinglish/other samples
- ✅ Fixture capture tool (Alt+Shift+S on x.com). Real captures weren't available, so Phase 1 uses synthetic fixtures (decision 10)
- ✅ User fields in §5.1 confirmed against maintained open-source X clients: `core.{screen_name,name,created_at}`, `avatar.image_url`, `legacy.{followers_count,friends_count,description,default_profile_image}`, `is_blue_verified` (older responses keep handle/name/date under `legacy`)
- **Exit:** ≤150 ms/post batched ✅, works from cache ✅, memory ⚠️ +850–870 MB while loaded → accepted with load-on-demand + idle unload

### Phase 1 — MVP: word lists + local mute + account signals ✅ built (live x.com validation pending)
- ✅ Config schema + presets + migration, decision engine with the corroboration rule and §5.3 suspicion rules, lexicon (EN/HI/Hinglish: strong terms, mild terms, idioms, threat/extortion phrases, benign idioms; de-obfuscation)
- ✅ Fixture-based tests (synthetic x.com HTML and API fixtures): 110 unit/fixture tests + 10 end-to-end checks in Chrome for Testing (`npm test`, `npm run test:e2e`)
- ✅ X adapter: page context (For you, Following, replies, Notifications), blur/collapse/remove + Show, health check (badge + popup warning)
- ✅ MAIN-world API reader (hooks `Response.json/text` and XHR `response/responseText`, so records reach the content script before X renders); suspicion score; DOM-only fallback; field health reported in the popup
- ✅ Suspicion feeds the mild-term rule, for replies and mentions only
- ✅ Coordination with exact (normalised) fingerprints
- ✅ Local mute list, strikes, auto-mute (background is the single writer)
- ✅ Popup (on/off, preset, today's counts, tab health) + options v1
- **Exit:**
  - ✅ word-list hits hidden in all 4 scopes before paint (checked in `requestAnimationFrame` in Chrome)
  - ✅ muted users hidden everywhere
  - ⏳ ≥ 90% of posts get an author record — needs live x.com; the popup shows the coverage per tab
  - ✅ a 3-account copy-paste reply cluster is detected
  - ✅ settings persist
  - ✅ content-script cost 0.085 ms/post in a 300-post batch (budget 2 ms)
- Differences from the plan:
  - Account records and copy-paste fingerprints live in the tab's memory, not in the service worker with 7-day / 24-hour TTLs. X resends the data on every page load, so nothing is lost within a session; cross-tab persistence moves to Phase 2.
  - The health check doesn't "pause": posts it can read are still filtered, and the badge plus popup say when it can't read the page.
  - If X's data ever arrives after a post was scored, that author's posts are re-checked (a late hide is better than none).

### Phase 2 — Model engine
- Offscreen inference, visible-first queue, batching, cache
- Model lifecycle: load when an x.com tab opens, unload after idle; word-list-only mode (default on ≤ 4 GB devices)
- Memory reduction investigation (target < 700 MB)
- First-run download with consent + progress; model status in popup
- Per-category sliders, language offset, pre-blur option
- Suspicion offsets on model thresholds; SimHash near-duplicate matching
- Persist account records (7-day TTL) and fingerprints (24-hour TTL) in the service worker, for clusters across tabs and reloads
- Calibration script on 100–200 labelled real posts, with author records; tunes signal weights and offsets too
- **Exit:** verdict within ~300 ms of a post appearing; presets sensible on the sample; suspicion offsets catch more brigade replies without raising false alarms on established accounts

### Phase 3 — Review & control
- Review log (what, why, scores, account reasons, cluster members) with "not abusive" / unmute / allowlist
- "Not abusive" on a post from a suspicious account offers to allowlist that account
- Mute/unmute from the placeholder; "Mute on X" button (user-clicked)
- Stats; import/export

### Phase 4 — Hardening & release
- Edge cases: "Show more", reposts, quotes, emoji-only, themes, RTL
- "Exempt accounts I follow" (investigate)
- Firefox desktop build
- Optional Chrome Web Store kit

## 9. Quality budgets
- Content-script work < 2 ms per post, account and coordination tiers included
- Word-list, account and coordination verdicts before paint
- No network calls except the model download. The API reader only reads responses X already fetched
- Unit tests (normalization, engine, strikes, migrations, suspicion score, fingerprints, clustering) + fixture tests on saved x.com HTML and API responses

## 10. Risks

| Risk | Mitigation |
|---|---|
| X changes its markup | Selectors in one file, health check, fixture tests |
| 289 MB download; +850–870 MB resident while loaded, 1.2–1.9 GB peak during load (Phase 0) | Consent + one-time cache; word lists work meanwhile; load only with x.com open, unload when idle; lexicon-only mode |
| Weak Hindi/Hinglish (confirmed in Phase 0) | Word list as primary detector, corroboration rule, custom words |
| False positives | Blur default, review log, feedback, allowlist |
| X changes its API response shape | Field paths in one file, field health check, API-response fixtures, DOM-only fallback |
| Penalising real new users (new accounts, people who don't post a photo) | Signals only lower thresholds, only on replies and mentions, never for identity_attack or obscene, a 0.45 threshold floor, no flags on signals alone, review log shows the account reasons, one-click allowlist |
| Coordination false matches (popular quotes, slogans, "happy birthday") | Minimum text length, ≥ 3 distinct authors, 10-minute window; only acts when a copy is abusive unless the opt-in is on |
| Brigades vary their text to dodge matching | SimHash near-duplicates; account signals still apply to each post |
| Transformers.js pins an ONNX Runtime dev build | Pin exact versions; re-run spike before upgrading |

## 11. Mobile roadmap

| Stage | Target | Work | Main risk |
|---|---|---|---|
| M1 | Firefox for Android | WXT Firefox target; inference in background page (no offscreen API); responsive options; AMO | Phone memory for a 300 MB model → lexicon-only fallback |
| M2 | Safari iOS | WXT Safari target + `safari-web-extension-converter`; needs Mac + Apple developer account | iOS extension memory caps → lexicon-only, or native inference in the container app |
| M3 (optional) | Android WebView app | Kotlin shell injecting `core/`; ONNX Runtime Mobile; sideloaded | Google sign-in blocked in WebViews; not Play-publishable |
| Sync | All devices | Import/export first; later "Mute on X" (real mutes sync via X) | — |
