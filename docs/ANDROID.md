# Firefox for Android (mobile roadmap M1)

Goal: the same protection on a phone, running smoothly on a **6 GB phone** while scrolling x.com in Firefox for Android.

Status: **delivered** — on [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/x-abuse-shield/) since 0.2.5 (2026-10). First real-phone test 2026-10-27: word lists and the lite model hide posts on live x.com; it showed the hidden-post panel wrapping onto 3–4 lines, so 0.2.6 puts a centred row of icon buttons on top with the reason below. Still to check on a phone: see [PLAN.md](PLAN.md#12-next-up).

## Decisions (2026-10-24)

| Question | Decision |
|---|---|
| How people install it | **Public listing on Firefox Add-ons (AMO).** Regular Firefox for Android only installs add-ons signed by Mozilla; installing from a file is a hidden Nightly option |
| Testing | **Emulate on desktop first** (Firefox with an Android user agent, touch-only pointer and a phone-sized window); real-phone checks later with `web-ext run -t firefox-android` |
| Where the model runs | **Everywhere, like desktop** (For you, Following, replies, Notifications) |
| Memory | **Trim the model's vocabulary first**, then ship |

## Same extension, adapted at run time

Firefox for Android runs the desktop Firefox build (Manifest V2, `gecko_android` in the manifest), so there is one `.xpi`. What differs on a phone is decided at run time:

| | Desktop | Phone (Android user agent / `getPlatformInfo().os === 'android'`) |
|---|---|---|
| AI model | full: 34 languages, 289 MB download, ~630 MB memory | **lite**: 5 languages, 93 MB download, ~334 MB memory (below) |
| Model batches | 8 posts | 4 posts: one slower core, so the first verdicts appear sooner |
| Unload after idle | 5 minutes | 3 minutes (default on install) |
| Download note | — | "use Wi-Fi" |
| Popup | 340 px panel | full screen; closes itself after opening Settings or Hidden posts |
| Touch targets | — | buttons ≥ 40 px (`pointer: coarse`), on x.com placeholders and extension pages |
| Hidden-post panel | floats over the blurred post, text buttons | over the blurred post: a centred row of 40 px icon buttons — 👁 Show, ✓ Not abusive, person-minus Mute here, muted speaker + X Mute on X — and the reason below (0.2.6); blurred posts are at least 128 px tall so it always fits |
| Badge "!" | toolbar button | none (the extension lives in Firefox's menu); the popup still shows page health |

### What Android does differently, and how it's handled

- **Android kills idle extension processes** and Firefox restarts the background page when needed ([Extension Workshop](https://extensionworkshop.com/documentation/develop/differences-between-desktop-and-android-extensions/)). The model's worker dies with it. Everything the extension needs is in storage, the model reloads from the browser's cache on the next post (a few seconds), and a fresh background page resets the model status so the popup never shows a model that's gone.
- **No sidebar on x.com's phone layout**, so the profile link that tells us which posts are yours isn't there. The logged-in account is also read from X's own data (the `Viewer` query and `account/settings.json`), so your posts are never filtered on a phone either.
- **X's ⋯ menu is a bottom sheet** on phones; "Mute on X" looks for it as well as the desktop dropdown (inferred — check on a real phone).
- **Single-threaded model:** extensions can't be cross-origin isolated in Firefox, on desktop or Android.

## Memory and speed budget (6 GB phone)

The model is the only large cost; word lists, account checks and brigade detection take a few MB. So phones get their own, smaller model, the **lite model** (`LITE_MODEL_ID`, built by `npm run model:trim`, [scripts/trim/README.md](../scripts/trim/README.md)); desktop keeps the full one.

### The lite model

1. **Vocabulary trimmed to English, Hindi, Hinglish, Urdu and Bengali.** The tokenizer had 256,000 tokens for 1,800+ languages. The lite model keeps the 109,232 tokens these five languages use, replayed from the model's own fine-tuning data plus two Hinglish corpora, and every token BPE builds them from. Text whose words only need kept tokens is tokenized exactly as before, so it gets exactly the same scores; the build checks this on 25,000 texts and our 404 word-list terms and test posts, and stops if any differ. Urdu and Bengali cost only ~3,000 tokens over the other three.
2. **Transformer layers stored as int8.** The original "int8" model only quantized the vocabulary table; its 22 layers were float32 (~170 MB). Quantizing them is what makes the phone model small and fast, at the cost of small score changes (below).

Files, memory and speed, in Firefox with phone settings (Android user agent, batches of 4, one thread; `npm run memory:firefox -- --phone …`, private bytes of all Firefox processes 60 s after scoring 24 posts, on a desktop CPU):

| Model | Download | Memory while loaded | Load (cached) | 24 posts |
|---|---|---|---|---|
| Full (desktop) | 289 MB | +629 MB | 4.6 s | 1.7 s |
| Trimmed only | 210 MB | +475 MB | 3.6 s | 1.5 s |
| **Lite: trimmed + int8 layers (phones)** | **93 MB** | **+334 MB** | **2.6 s** | **1.0 s** |

How the scores move, against the original model on held-out text (`scripts/trim/compare.py`; a verdict is "hidden or not" at the Balanced thresholds):

| Text | Trimmed only: verdicts changed | Lite: verdicts changed |
|---|---|---|
| English, Hindi, Hinglish, Urdu, Bengali (400 each) | none (identical scores) | 0.5–1.8% (mean score change 0.006–0.014) |
| Our 68 test posts | none | 1 |
| Other languages (French, German, Spanish, Arabic, Russian, Japanese; 150 each) | 1.3–4% | 1.3–6% |

The lite model's changes in the five languages go both ways and lean slightly stricter: of 2,000 posts, 14 became hidden and 9 shown (our test posts: 1 newly hidden). On a phone that's a post or two in a hundred, all near the thresholds; the word lists, which catch most Hindi and Hinglish abuse, are unaffected. Phone CPUs are several times slower than this desktop on one thread, so expect roughly 0.2–0.5 s per batch of 4 posts there; to be measured on a real phone.

## Testing

```sh
npm run test:e2e:mobile    # Firefox emulating a phone: x.com's phone layout, touch, 412×915
npm run memory:firefox -- <model folders>   # memory per model variant, single-threaded like Android
```

On a real phone (later): enable USB debugging, install Firefox Nightly, then `npx web-ext run -t firefox-android --adb-device <id> --firefox-apk org.mozilla.fenix -s .output/firefox-mv2` ([Extension Workshop](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android)).

Emulated results (`test:e2e:mobile`, desktop Firefox 158 as a phone): the full suite passes, plus phone checks: placeholder buttons ≥ 40 px and inside their post, popup / settings / review pages fill a 412 px screen without sideways scrolling, your own posts recognised from X's data without the sidebar link, and (hosted) only the lite model's files downloaded.

## Next steps

1. **Real phone:** install Firefox Nightly, enable USB debugging, `web-ext run` the build; check memory (`about:memory` via remote debugging), scoring speed, and the inferred bits on live x.com: the phone layout's tab bar and ⋯ bottom sheet ("Mute on X"), quote cards, reposts.
2. ✅ **Lite model hosted** next to the full one: `x-abuse-shield/multilingual-toxicity-lite/` in [downlz/x-abuse-shield-model](https://huggingface.co/downlz/x-abuse-shield-model) (2026-10-24, commit `3834f9c`). Checked end to end: a hosted build in phone emulation downloaded it from Hugging Face in 19 s on a fresh profile and passed the suite (23/23).
3. **Firefox Add-ons listing** (below).

## Publishing on Firefox Add-ons

From 0.2.5, one listing covers Firefox desktop and Firefox for Android; the add-on id is `x-abuse-shield@downlz.github.io` (permanent). Upload steps, reviewer notes, listing text, privacy policy and permission notes: [STORE.md](STORE.md) section 6 and [PRIVACY.md](PRIVACY.md). The hosted-model build (~7 MB) is far under AMO's 200 MB limit.
