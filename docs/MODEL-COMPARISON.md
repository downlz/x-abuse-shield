# Hate-speech model vs toxicity model

Evaluation of [Horizon-Labs/multilingual-hate-speech-base](https://huggingface.co/Horizon-Labs/multilingual-hate-speech-base) as the default model, against the current [Horizon-Labs/multilingual-toxicity-small](https://huggingface.co/Horizon-Labs/multilingual-toxicity-small). Branch `feat/large-model`, 2026-10-28.

## What changed in the extension

- **Settings → AI model → Model:** *Hate speech* (default) or *Toxicity*. Each download needs its own approval, so switching to a model that isn't downloaded asks first and shows its size. Switching frees the old model before loading the new one.
- **How the hate model is used:** it outputs `hate` plus seven `target_*` labels (race, religion, origin, gender, sexuality, age, disability). `hate` drives the engine's *identity attack* category (Balanced threshold 0.5, as the model card suggests); its other categories score 0. Word lists, account checks and copy-paste detection are unchanged.
- **Phones** keep the light toxicity model either way (a 640 MB model isn't phone material; trimming comes later).
- Both models are converted to in-place `.ort` by `npm run model:build` (hate speech: 612 MB `.ort` + 33 MB tokenizer).

## Detection

**Our 68 labelled posts** (`npm run calibrate`, `docs/CALIBRATION.md` and `docs/CALIBRATION-hate.md`; Balanced, word lists + model). Mostly insults and threats:

| | Abusive caught | Clean posts hidden |
|---|---|---|
| Word lists only | 22/44 | 0/24 |
| + toxicity model | **36/44** | 2/24 |
| + hate-speech model | 25/44 | **0/24** |

**Hate speech probe** (22 hand-written posts; hate score vs the toxicity model's identity_attack):

| | Hate-speech model | Toxicity model |
|---|---|---|
| Hate speech (12; English, Hindi, Hinglish) | **9/12** ≥ 0.5 | 5/12 |
| e.g. "Ye mulle desh ke dushman hain, inko Pakistan bhejo" | 0.97 | 0.19 |
| e.g. "Dalits should know their place…" | 0.92 | 0.31 |
| Insults and threats (4) | 0/4 (all ≤ 0.03) | 3/4 via insult |
| Clean posts that mention groups (Eid greetings, "I'm a proud gay man…", calling out bigotry) | **all ≤ 0.22** | 0.39–0.61 ("proud gay man" hidden at Balanced) |

Missed by the hate model: slur-based Hinglish ("katue", "neech jaat", "andhbhakt sanghi") — candidates for the word lists.

## Cost

| | Hate speech | Toxicity |
|---|---|---|
| Download | 645 MB | 289 MB |
| Memory while loaded, Chrome (extension process) | **+906 MB** | +509 MB |
| Memory while loaded, Firefox (all processes) | **+1,047 MB** | +644 MB |
| Scoring, Chrome (4 threads, batches of 8) | 74 ms/post | 34 ms/post |
| Scoring, Firefox (1 thread, 24 posts) | 6.0 s | 2.4 s |
| First verdict after a post appears (e2e, Chrome / Firefox) | 510–570 / 663 ms | 295–350 / ~250 ms |

## Reading

- The hate model is far better at hate speech, including Hindi and Hinglish communal and caste hate, and doesn't misfire on posts that merely mention a group. It ignores insults, threats and profanity by design, so as a *replacement* it catches fewer abusive posts overall (25 vs 36 of 44 here).
- It costs about 400 MB more memory and twice the scoring time.
- Options from here: keep it as the default; make *Toxicity* the default with *Hate speech* as the option; or run **both** (best coverage, about 1.4 GB in Chrome — desktop only); and trim the hate model's vocabulary as was done for phones.
- Before a release: upload `public/models/Horizon-Labs/multilingual-hate-speech-base/` to the Hugging Face model repo (`npm run release` refuses to build until it's there).
