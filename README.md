# X Abuse Shield

On-device, multilingual abuse filter for x.com. Scores posts with
[`Horizon-Labs/multilingual-toxicity-small`](https://huggingface.co/Horizon-Labs/multilingual-toxicity-small)
via Transformers.js, plus word lists, and hides or blurs abusive posts and authors.

> **Status:** Phases 1 and 2 are built: word lists, account checks, copy-paste detection (including
> near-duplicates), strikes and local mutes, and the on-device AI model with download approval, idle
> unloading and per-category thresholds. The review log (Phase 3) is next. See [docs/PLAN.md](docs/PLAN.md).

## Goal

Stop throwaway, paid and coordinated troll accounts from bullying you on X. These accounts pile into replies with insults, threats and slurs, often in Hindi or Hinglish, and often from accounts created days earlier. The goal is to catch them on their first post, without your having to know who they are in advance and without hiding legitimate disagreement.

Abuse Shield judges both **what a post says** and **who is saying it**, entirely in your browser.

## Features

**Reading what a post says**
- An AI model gives 7 separate scores per post: toxicity, severe toxicity, threat, insult, identity attack, obscenity, sexual content. Each has its own threshold.
- It covers 34 languages, with built-in word lists for English, Hindi (Devanagari) and Hinglish.
- Disguised spellings are decoded before matching: `f*ck`, `fuuuck`, leetspeak.
- Mild words such as *pagal* or *gadha* only count when the model also finds the post toxic, so friendly teasing passes.
- Threat and extortion phrases are caught even without bad words ("I know where you live"). Harmless idioms ("kill it at your interview") are ignored.

**Looking at who is posting**
- Account signals: account age, follower count, following-to-follower ratio, default avatar, auto-generated handles like `rahul12345678`, and your own bio keywords.
- Copy-paste brigades: the same or near-identical reply from 3 or more accounts within 10 minutes is grouped. If one copy is abusive, every copy is hidden.
- Suspicious accounts face stricter thresholds. A 9-day-old, 12-follower account gets flagged for an insult that an established account would not. Account signals never hide a clean post on their own.

**Dealing with repeat offenders**
- Strikes: 3 flagged posts in 7 days mutes the author automatically, for 24 hours, 7 days, 30 days or forever.
- Muted authors are hidden everywhere: For you, Following and replies.
- An optional "Mute on X" button, which you click yourself.

**Staying fair and in control**
- By default posts are blurred with click-to-reveal; threats and severe abuse are collapsed. Nothing is deleted or blocked on X.
- A review log shows why each post was hidden: scores, matched words, account reasons, and other members of a copy-paste group. From there you can mark a post "Not abusive", unmute or allowlist.
- Relaxed / Balanced / Strict presets, per-category sliders, custom word lists, and import/export of your settings.

**Private and fast**
- Everything runs on your device. The only network call is the one-time model download (~289 MB). Account data is read from what X already sends to the page, so the extension makes no extra requests.
- Word-list, account and copy-paste checks run before a post appears on screen, so abuse doesn't flash. Model scoring takes about 28 ms per post.
- The model loads only while an x.com tab is open and unloads after 5 idle minutes. A word-list-only mode is available for low-memory devices.

## How it compares

Most current tools for X fall into two groups: **block-list tools** (block the accounts you pick, or import a list, e.g. [Twitter Blocker](https://chromewebstore.google.com/detail/twitter-blocker/mbjkhjgpomohfcodieeokjniidffmcga)) and **rule-based filters** (hide posts matching keywords, regex or account rules you write, e.g. [Twitter Filter](https://chromewebstore.google.com/detail/twitter-filter/ejhilomfbamkbfehkjbhemkpaghpcglj)).

| | Block-list tools | Rule-based filters | X Abuse Shield |
|---|---|---|---|
| Decides by | Accounts you choose | Rules you write | What the post says + who posted it |
| Catches an abuser you've never seen | No | Only if a rule happens to fit | Yes, on their first post |
| Understands meaning, not just keywords | No | No | Yes, 7 abuse categories |
| Hindi and Hinglish abuse | — | Only the words you add | Built-in word lists + model |
| Detects copy-paste brigades | No | No | Yes |
| Combines account signals with abuse scores | No | Separate rules | Yes, suspicious accounts face stricter thresholds |
| Repeat offenders | Manual | Manual | Automatic strikes → timed mute |
| Reversible | Blocks are permanent until undone | Depends on the rule | Blur by default, review log, one-click "Not abusive" |
| Automates actions on your X account | Yes (bulk blocking) | Optional auto-block | No; muting is local, and "Mute on X" is clicked by you |

Why that matters:
- **Trolls rotate accounts.** Block lists and handle rules fall behind as soon as a new account appears. Reading the post itself does not.
- **Abuse is often mild-sounding or in Hinglish.** Keyword rules miss "I know where you live" and need someone to write every slur variant. The model and the built-in lists cover these out of the box.
- **Brigades are the pattern, not one post.** Spotting the same reply from several new accounts catches organised campaigns that look harmless one post at a time.
- **Your account stays safe.** Nothing is automated against X, so there's no bulk-blocking behaviour that could get your account flagged.

What Abuse Shield doesn't do: it doesn't block accounts on X or bulk-import block lists. Block-list tools remain the right choice for that, and they work alongside this extension.

## Setup

```sh
npm install        # also copies ONNX Runtime's wasm into public/ort and generates WXT types
npm run build      # → .output/chrome-mv3
```

Load it in Chrome or Brave: `chrome://extensions` (or `brave://extensions`) → enable **Developer mode** → **Load unpacked** → pick `.output/chrome-mv3`. Reload any open x.com tabs afterwards — extensions only run on pages opened after they load.

The toolbar popup shows the sensitivity preset, today's counts, the AI model's status and whether the extension can read the current tab. **Settings** covers everything else.

The word lists work straight away. To add the AI model, click **Download (289 MB)** in the popup. It loads while x.com is open (about 850 MB of memory) and unloads after 5 idle minutes; scoring takes about 30 ms per post.

## Tests

```sh
npm test                  # unit + fixture tests (Vitest, happy-dom)
npm run test:e2e          # builds, then runs the extension in Chrome for Testing against fake x.com pages
npx tsx scripts/e2e-smoke.ts --idle   # also checks the idle unload (adds ~2 minutes)
```

The x.com fixtures in `tests/fixtures/` are synthetic, modelled on X's markup and API responses. The end-to-end run checks word-list verdicts in `requestAnimationFrame`, i.e. before the browser paints, downloads the real model into a fresh profile (~1 minute) to check model verdicts and their latency, and saves screenshots to `spike/results/e2e/`.

## Calibration

```sh
npm run calibrate   # scores labelled posts with word lists + model → docs/CALIBRATION.md
```

Add your own labelled posts to `calibration/posts.jsonl` (git-ignored); the format is in [calibration/README.md](calibration/README.md).

## Phase 0 spike

Measures model load time, latency, memory and output parity inside the extension.

```sh
npm run spike:reference   # scores spike/samples.json on onnxruntime-node (downloads the model once)
npm run spike:browser     # builds, then runs the spike page in Chrome for Testing (headless)
npm run spike:report      # writes docs/SPIKE-REPORT.md
```

Memory comparisons of ONNX Runtime session settings (variants in `src/spike/variants.ts`), on the already-cached profile:

```sh
npx tsx scripts/spike-browser.ts --variant=ort-arena
```

To run it by hand in your own Chrome, open `chrome-extension://<extension id>/spike.html` and click **Run spike**.

## Capturing x.com fixtures

Extractor tests run against saved copies of X's markup. With the extension loaded:

1. Open x.com and scroll until a few posts are on screen.
2. Press **Alt+Shift+S**. The main column downloads as `x-<context>-<timestamp>.html`.
3. Capture at least: the **For you** tab, the **Following** tab, and an opened post with replies.
4. Move the files into `tests/fixtures/x/`.

Fixtures contain the posts that were on screen, so don't publish them.

## Layout

| Path | What |
|---|---|
| `src/core/` | Platform-neutral engine: word lists, decisions, account suspicion, copy-paste clusters, strikes and mutes, settings. Reused by the mobile ports |
| `src/adapters/inference/` | Transformers.js classifier and the offscreen document host |
| `src/adapters/x-dom/` | Everything that touches x.com's DOM; all selectors in `selectors.ts` |
| `src/adapters/x-api/` | Reads the account and post data X fetches for itself; all field paths in `fields.ts` |
| `src/adapters/storage/` | `chrome.storage` layout |
| `src/entrypoints/` | Content scripts (`x.content/`, MAIN-world `x-api.content.ts`), background, popup, options, offscreen document, spike page |
| `src/ui/` | Shared React hooks, controls and theme for the popup and settings |
| `scripts/` | Spike runners, end-to-end smoke test, build helpers |
