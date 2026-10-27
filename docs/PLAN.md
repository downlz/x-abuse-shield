# x-abuse-shield — Plan

Multilingual, on-device abuse filter for x.com. Chrome and Firefox extensions first, mobile later.

Judges both **what a post says** (model + word lists) and **who is saying it** (account signals + coordinated copy-paste replies), so new throwaway and paid troll accounts are caught on their first post.

Status: **v0.2.6** — 2026-10-27 ([notes](releases/v0.2.6.md)). **Firefox (desktop and Android) is live on [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/x-abuse-shield/)**, approved from 0.2.5; Chrome and Brave install from GitHub releases. 0.2.6: compact hidden-post panels on phones (centred icon buttons, reason below) (from the first real-phone test), the phone model card names its five languages, README badges.

Distribution today:

| Browser | How | Model |
|---|---|---|
| Firefox desktop | [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/x-abuse-shield/) (signed, auto-updates) | full, 289 MB download |
| Firefox for Android | same listing | lite, 93 MB download |
| Chrome, Brave | GitHub releases (`.zip` → Load unpacked; `.crx` for managed installs) | full, 289 MB download |

Earlier: **v0.2.5 released on GitHub** — 2026-10-24 ([notes](releases/v0.2.5.md)): Firefox for Android support (one Firefox add-on for desktop and phones, [ANDROID.md](ANDROID.md)), the lite phone model, and the permanent add-on id `x-abuse-shield@downlz.github.io` for the Firefox Add-ons listing. Release files tested as shipped against the real model host: Chrome `.zip` 17/17, Firefox `.xpi` 17/17 on desktop and 23/23 emulating a phone. Not yet run on a real phone.

Earlier: **v0.2.1 released on GitHub** — 2026-10-24 ([notes](releases/v0.2.1.md)): the model is downloaded on first use from [downlz/x-abuse-shield-model](https://huggingface.co/downlz/x-abuse-shield-model), so downloads are ~7 MB instead of ~240 MB. Tested as shipped against the real host: Chrome `.zip` and Firefox `.xpi` 17/17 each, model downloaded in ~55–60 s on a fresh profile, verdicts 217–350 ms. v0.2.0 ([notes](releases/v0.2.0.md)): each download was tested end to end as shipped (the packed `.xpi` exposed a model-loading bug, fixed: Firefox reports the compressed size of files inside an `.xpi`). **Phase 4 built**: Firefox build, hosted-model option, edge cases, follow exemption, store kit ([STORE.md](STORE.md), [PRIVACY.md](PRIVACY.md)). Phase 1 validated on live x.com by the user; the Phase 4 edge cases still need a live check. Model memory cut from ~850 MB to ~507 MB by shipping it in ONNX Runtime format, run in place (2026-10-24). Results: [SPIKE-REPORT.md](SPIKE-REPORT.md) (model, memory), [CALIBRATION.md](CALIBRATION.md) (detection quality).

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
| 4 | Distribution | GitHub releases: Chrome/Brave `.zip` (Load unpacked), signed `.crx`, unsigned Firefox `.xpi` (`npm run release`). Since 0.2.1 the model is downloaded on first use from [downlz/x-abuse-shield-model](https://huggingface.co/downlz/x-abuse-shield-model) (~7 MB downloads instead of ~240 MB); an approval covers one model source, so updating from a build that shipped the model asks before downloading. Not in the browser stores (Chrome Web Store policy); STORE.md kept for reference |
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
Offscreen document (reason: WORKERS)       Firefox: a Web Worker owned by the
   └─ ONNX Runtime (WASM, int8, 4 threads)    persistent MV2 background page (no
      in-place .ort model; Transformers.js    offscreen API); 1 thread (extensions
      tokenizer                               can't be cross-origin isolated there)
      queue: newest first, batches of ~8, text cut to 256 tokens
```

The two browsers share everything except where the model runs (`ModelRunner`: `offscreen-host.ts` / `worker-host.ts`) and the manifest (MV3 / MV2, set per browser in `wxt.config.ts`).

### Model source

The model ships or downloads in one of three ways, chosen at build time (`wxt.config.ts`):

| Build | Extension | First use | Memory (Chrome) |
|---|---|---|---|
| **Bundled** (default after `npm run model:build`) | ~331 MB | nothing to download | +507 MB |
| **Hosted** (`WXT_BUNDLE_MODEL=false WXT_MODEL_URL=…`) | ~28 MB | the converted `.ort` + tokenizer downloaded once (289 MB) into the Cache API | +507 MB |
| **Fallback** (neither) | ~28 MB | the original `.onnx` from Hugging Face via Transformers.js | +850 MB |

- Converting `.onnx` → `.ort` in the browser isn't possible: onnxruntime-web has no model converter or file system, so conversion stays an offline step (`npm run model:build`, onnxruntime-node).
- Hosted is the only small build with the low-memory model, and the only option for AMO (200 MB file limit). It needs somewhere public to put the files, e.g. a Hugging Face repo (CORS headers included). End-to-end test with a local host: `npm run test:e2e:hosted` (Chrome: downloaded in 7.5 s locally, then reloaded from cache in 3.7 s with no requests; Firefox: 5.1 s, 2.0 s).

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
- Exempt: allowlisted accounts, own posts, and accounts you follow (from X's data; Phase 4).
- The subscription badge (`is_blue_verified`) is recorded and shown in the review log, but has weight 0 by default.

### 5.2 Coordination (copy-paste brigades)

- **Fingerprint:** extends the text-hash cache. Normalise the text (lowercase, de-obfuscate, strip @mentions, URLs and extra whitespace), then store the exact key plus a 64-bit SimHash over character 4-grams (word 3-grams change too much when one word of a short reply changes).
- **Match:** another author's post with the same key, or a SimHash within Hamming distance ≤ 12 (measured: rewrites 5–15, unrelated same-topic replies 18–29).
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
- **Mild words also count only in replies and mentions** (Phase 2 calibration; a setting). In standalone posts — "this is fucking amazing", "lol this meme is so dumb", quoting an insult to condemn it — the model scored 0.54–0.70 toxicity, so no corroboration bar separated them from mild abuse.
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

### Phase 2 — Model engine ✅ built (real labelled data pending)
- ✅ Offscreen inference: one model for all tabs, batches of 8, LRU cache by text. "Visible-first" is done as **newest request first** — while scrolling, the posts on screen now are scored before ones scrolled past — so the content script never forces a layout to measure visibility
- ✅ Model lifecycle: loads on the first score request (or right after the download is approved), unloads after idle minutes (1-minute alarm; verified: unloaded 115 s after a 1-minute idle setting); word-list-only by default on devices reporting ≤ 4 GB
- ✅ Memory reduction (after Phase 3): **+507 MB instead of +850 MB** (target < 700 MB met). The model ships with the extension in ONNX Runtime's `.ort` format (`npm run model:build`, converted locally with onnxruntime-node — no Python) and runs in place: `use_ort_model_bytes_for_initializers` + `disable_prepacking`, with onnxruntime-web patched at build time to keep the model bytes (scripts/ort-in-place-plugin.ts; the build fails if a new onnxruntime-web changes the patched code). Same speed, scores within 1e-6, load 4 s after "Turn on" instead of a ~60 s download. The extension grows to ~331 MB on disk. Without `model:build` it falls back to downloading the `.onnx` (850 MB). Tokenizer (~180 MB) is the next-largest cost (vocabulary trimming would shrink both)
- ✅ First-run download only after approval, with progress; model status in popup and settings
- ✅ Per-category sliders (switch the preset to Custom), non-English offset, pre-blur option
- ✅ Suspicion offsets on model thresholds (from Phase 1); near-duplicate matching with SimHash over **character 4-grams** (word 3-grams are too coarse for tweet-length text). Threshold 12 of 64 bits, measured: rewrites 5–15, unrelated same-topic replies 18–29
- ⏸ Persisting account records and fingerprints in the service worker: deferred. A thread's replies load in one tab and are re-detected after a reload, so cross-tab persistence adds little for its complexity (an async cross-tab round trip that can't act before paint)
- ✅ Calibration script (`npm run calibrate`, data format in `calibration/README.md`), run on 68 posts (54 hand-written + 14 real). Led to one default change: **mild words count only in replies and mentions** (Balanced: 38/44 caught · 5/24 false alarms → 36/44 · 2/24)
- Word lists extended from live testing: *bsdwale*, *gaand mei/mein…* phrases, *nalla/nallo*, *dalla* (Hinglish-only), Hinglish markers matched loosely ("bhaaai")
- **Exit:**
  - ✅ verdict 217–262 ms after a post appears, model loaded (end-to-end in Chrome)
  - ✅ presets sensible on the available sample (Balanced, word lists + model: 36/44 caught, 2/24 false alarms; word lists only: 22/44, 0/24) — provisional until 100–200 real labelled posts
  - ⏳ suspicion offsets vs. brigade replies — needs labelled posts with account details

### Phase 3 — Review & control ✅ built ("Mute on X" needs a live check)
- ✅ Review page (`review.html`, from the popup's "Hidden posts"): every hidden post with why — word hits, model scores, account details and suspicion reasons, copy-paste members — filters (to review / abusive / not abusive), search, optional text blur. Last 30 days, up to 500 posts, stored only in this browser
- ✅ "Not abusive" (on the hidden post or the review page) shows it again in every tab, withdraws its strike and lifts an automatic mute that falls below the strike count; changing it back to "abusive" hides it again
- ✅ "Not abusive" on a suspicious account's post offers "Always allow @handle"
- ✅ Buttons on hidden posts: Show · Not abusive · Mute here · Mute on X; muted posts get Unmute
- ✅ "Mute on X" opens the post's ⋯ menu and clicks "Mute @handle" only when that item names the account (and isn't "Unmute"); otherwise it leaves X's menu open for you. Also mutes locally. Selector for the Mute item is inferred (the item before `data-testid="block"`), so it needs checking on live x.com
- ✅ Export labelled posts as `posts.jsonl` (no handles) for `npm run calibrate`; "Add a missed post" records abuse that wasn't hidden, so calibration sees misses too
- ✅ Stats on the review page (hidden, reviewed, marked not abusive, top categories and accounts); backup export/import of settings + mutes in Settings
- Not included: marking a *visible* post as abusive directly on x.com (use "Add a missed post")

### Phase 4 — Hardening & release ✅ built (edge cases need a live check)
- ✅ **Firefox desktop build** (`npm run build:firefox`, Firefox 128+): Manifest V2 with a persistent background page that runs the model in a Web Worker (Firefox has no offscreen documents), single-threaded. The same end-to-end suite passes in the installed Firefox 158 over WebDriver BiDi (`npm run test:e2e:firefox`): 17/17, model ready 2–4 s after "Turn on", verdict 205–260 ms after a post appears, unloaded 110 s after a 1-minute idle setting. Memory not yet measured in Firefox
- ✅ **Hosted model** (see "Model source"): a ~28 MB extension that downloads the in-place `.ort` once. In-browser conversion was investigated and isn't possible
- ✅ **"Show more":** long posts are scored on their full text from X's data (`note_tweet`), not the truncated page text
- ✅ **Reposts:** a muted account's reposts are hidden like X's own mute does ("Muted @reposter · reposted by a muted account"; Unmute acts on the reposter). The reposter comes from the "… reposted" line's profile link (`socialContext`); "Pinned" and community labels are ignored
- ✅ **Quotes:** the quoted post is scored on its own, as a post by its author (strikes and review log included), and only the quote card is hidden ("Quoted post hidden by Abuse Shield"). It needs the quoted post's id from X's data (`quoted_status_result`); without it the quote is left alone. Judged as a standalone post unless it was itself a reply. No "Mute on X" button on quotes (X's ⋯ menu belongs to the quoting post)
- ✅ **Emoji:** the model barely reacts to emoji (🖕 alone: toxicity 0.05; "@name 🖕": 0.17), so a new emoji list catches 🖕 (strong insult) and 🤡 💩 (mild: only from suspicious accounts in replies). Skin tones are ignored; custom block/allow lists take emoji; a switch under Word lists turns it off
- ✅ **Themes:** placeholders take X's background and text colours from the body's inline background colour (Default, Dim, Lights out); checked end to end in Dim
- ✅ **RTL:** bidi control characters (RLM, overrides, isolates) are stripped before matching, so they can't split a word; placeholder text uses `dir="auto"`
- ✅ **Accounts you follow:** read from X's data (`relationship_perspectives.following`, older `legacy.following`). They never count as suspicious; "Never filter accounts I follow" (off by default) skips them entirely
- ✅ **Store kit:** [STORE.md](STORE.md) (decisions, hosting, packaging, listing text, permission justifications, AMO notes) and [PRIVACY.md](PRIVACY.md). The Firefox sources zip leaves out the model and local-only files (real screenshots, labelled posts, results)
- Not done then: Edge/Opera builds (not tested); Firefox for Android and Firefox memory measurement followed in 0.2.5

### Planned improvements

**Vocabulary trimming ✅ delivered (0.2.5), for phones.** Built by `npm run model:trim` ([scripts/trim/README.md](../scripts/trim/README.md)); details and measurements in [ANDROID.md](ANDROID.md#the-lite-model).

| | Planned estimate | Delivered (lite model, Firefox, phone settings) |
|---|---|---|
| Languages kept | English, Hindi, Hinglish (+?) | English, Hindi, Hinglish, Urdu, Bengali (109,232 of 256,000 tokens) |
| Memory while loaded | ~200–300 MB | +334 MB (full model in Firefox: +629 MB) |
| Download | ~60–90 MB | 93 MB (86 MB model + 7 MB tokenizer) |
| Accuracy | unchanged on kept languages | trimming alone: identical scores on kept text (checked on 25,000 texts); with int8 layers: 0.5–1.8% of verdicts change |

- Went further than planned: the transformer layers are stored as int8 too (most of the size and speed gain), and no PyTorch was needed (ONNX + `tokenizers` only).
- Not yet: the lite model as a desktop option (Settings) for low-memory computers.

## 9. Quality budgets
- Content-script work < 2 ms per post, account and coordination tiers included
- Word-list, account and coordination verdicts before paint
- No network calls except the model download. The API reader only reads responses X already fetched
- Unit tests (normalization, engine, strikes, migrations, suspicion score, fingerprints, clustering) + fixture tests on saved x.com HTML and API responses

## 10. Risks

| Risk | Mitigation |
|---|---|
| X changes its markup | Selectors in one file, health check, fixture tests |
| Model memory: +507 MB while loaded, 0.84 GB peak (in-place `.ort`; +850 MB / 1.2–1.9 GB for the `.onnx`) | Opt-in; word lists work meanwhile; load only with x.com open, unload when idle; lexicon-only mode |
| The in-place patch to onnxruntime-web (pinned dev build) | Build fails if the patched code changes; unit test on the pinned source; re-measure (`spike-browser --variant=bundled-ort`) before upgrading |
| Shipping the model makes the extension ~331 MB | Fine for personal use; for the stores, the hosted build (~28 MB) downloads the same `.ort` (required for AMO, 200 MB limit) |
| Firefox-only differences: temporary add-ons vanish on restart; release Firefox installs only signed add-ons | Unlisted AMO signing with the hosted model (STORE.md) |
| Quote and repost markup (`div[role="link"]` cards, `socialContext`) is inferred, like "Mute on X" | Selectors in one file; quotes need X's data for the quoted id, so a markup change leaves quotes unfiltered rather than wrong |
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
| M1 | Firefox for Android — ✅ **delivered** (0.2.5, [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/x-abuse-shield/); compact icon panels 0.2.6), [ANDROID.md](ANDROID.md) | The desktop Firefox build on Android, adapted at run time (smaller batches, touch layouts, phone x.com layout), with a trimmed phone model; public AMO listing | Phone memory → trimmed model (English, Hindi, Hinglish, Urdu, Bengali) |
| M2 | Safari iOS | WXT Safari target + `safari-web-extension-converter`; needs Mac + Apple developer account | iOS extension memory caps → lexicon-only, or native inference in the container app |
| M3 (optional) | Android WebView app | Kotlin shell injecting `core/`; ONNX Runtime Mobile; sideloaded | Google sign-in blocked in WebViews; not Play-publishable |
| Sync | All devices | Import/export first; later "Mute on X" (real mutes sync via X) | — |

## 12. Next up

In rough priority order:

1. **Live-x.com checks on a phone** (from the first test, 2026-10-27, word lists + model working): "Mute on X" with the phone's ⋯ bottom sheet, quote cards, reposts by muted accounts, your own posts recognised without the sidebar; memory and scoring speed on the device (`about:memory` via remote debugging).
2. **Chrome Web Store** (optional): a neutral name and icon (no "X" letterform), the bundled-model package (`npm run release -- --bundled`), privacy policy URL; the downloaded model is a policy grey area there.
3. **Lite model as a desktop option** for computers with less memory.
4. **Calibration on real labelled posts** (100–200) — presets are still provisional; suspicion offsets vs real brigades.
5. **Safari on iPhone/iPad (M2)**, Edge and Opera builds.
6. **Flag a visible post as abusive** directly on x.com; mutes across devices.
