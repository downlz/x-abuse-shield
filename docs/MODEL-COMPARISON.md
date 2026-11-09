# Model alternatives (0.3.0 cycle)

Three models were tried as a replacement for, or alongside, [Horizon-Labs/multilingual-toxicity-small](https://huggingface.co/Horizon-Labs/multilingual-toxicity-small) (the "toxicity model") between 2026-10-28 and 2026-11-09. **None was adopted: the toxicity model stays the only model.** The code for them was removed before 0.3.0; it's in the history of `feat/large-model` (merged as PR #10, commit `7925959`), reverted on `release/v0.3.0`.

| Model | Why it was tried | Why it was dropped |
|---|---|---|
| [Horizon-Labs/multilingual-hate-speech-base](https://huggingface.co/Horizon-Labs/multilingual-hate-speech-base) | Hate speech, incl. Hindi/Hinglish communal and caste hate | Ignores insults and threats by design (25 vs 36 of 44 abusive posts caught); ~400 MB more memory |
| [gravitee-io/distilbert-multilingual-toxicity-classifier](https://huggingface.co/gravitee-io/distilbert-multilingual-toxicity-classifier) | Smaller (140 MB), one toxic / not-toxic score, 15 languages | **Many false positives**: hid 24.5% of clean Hinglish comments and 4 of our 24 clean posts |
| [gravitee-io/bert-small-toxicity](https://huggingface.co/gravitee-io/bert-small-toxicity) | Tiny (29 MB), fast, would run on phones unmodified | English-only tokenizer: hid **47% of clean Hindi** comments; 7 of our 24 clean posts |

## DistilBERT and bert-small vs the toxicity model (2026-11-09)

`.venv-trim/Scripts/python -I scripts/eval-models.py` — the models alone, without the word lists. Share of posts hidden at the Balanced setting (toxicity ≥ 0.75; for the toxicity model, any category over its Balanced threshold). Civil Comments: English comments with human labels ("clean" = no annotator called it toxic, "toxic" = most did) and their Hindi and Hinglish machine translations.

| Text | DistilBERT | bert-small | Toxicity model |
|---|---|---|---|
| English, clean (800) | 7.0% | 4.9% | 0.0%* |
| English, clean, mentions a religion, caste, gender… (400) | 4.2% | 2.8% | 0.0%* |
| English, toxic (400) | 51.5% | 42.8% | 17.5%* |
| Hindi, clean (800) | 4.1% | **46.8%** | 0.2%* |
| Hindi, toxic (400) | 19.5% | 60.8% | 12.5%* |
| Hinglish, clean (800) | **24.5%** | **22.1%** | 0.0%* |
| Hinglish, toxic (400) | 63.0% | 60.2% | 16.2%* |
| Our posts, clean (24) | 4 hidden | 7 hidden | **1 hidden** |
| Our posts, abusive (44) | 29 caught | 21 caught | 16 caught |
| Scoring, 1 thread, native CPU | 87 ms/post | 39 ms/post | 279 ms/post |

\* The toxicity model was trained on Civil Comments, so its rows there are flattering; the two Gravitee models (trained on TextDetox) compare fairly with each other, and all three on our posts. With the word lists, the toxicity model catches 36 of 44 of our abusive posts and hides 2 of 24 clean ones ([CALIBRATION.md](CALIBRATION.md)).

Notes:

- **bert-small** is built on an English BERT. Its tokenizer lowercases and strips accents, which removes Hindi vowel signs ("तू" → "त"), and turns many Devanagari words into `[UNK]`. A stricter threshold doesn't help: at 0.9 it still hides 19% of clean Hindi comments. It also misses Hinglish insults the others catch ("Abe gadhe, kuch bhi bakwas karta rehta hai": 0.15).
- **DistilBERT**'s published ONNX export has a batch of 1 baked into its reshapes, so it can only score one post per call. A phone version was built (vocabulary trimmed to English, Hindi and Hinglish: 136 → 70 MB, identical scores in those languages), but WordPiece has no byte fallback, so other languages fell apart (24–89% of their posts wrongly hidden) and had to skip the model.
- **Memory in Firefox** (same day, all processes): DistilBERT +348 MB, toxicity model +656 MB; phones: DistilBERT's phone version +140–254 MB, the toxicity phone model +193–354 MB (Firefox varies by ±100 MB between identical runs).

## Hate-speech model vs toxicity model (2026-10-28)

**Our 68 labelled posts** (`npm run calibrate`, [CALIBRATION-hate.md](CALIBRATION-hate.md); Balanced, word lists + model):

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

| Cost | Hate speech | Toxicity |
|---|---|---|
| Download | 645 MB | 289 MB |
| Memory while loaded, Chrome (extension process) | +906 MB | +509 MB |
| Memory while loaded, Firefox (all processes) | +1,047 MB | +644 MB |
| Scoring, Chrome (4 threads, batches of 8) | 74 ms/post | 34 ms/post |

## Re-running

`scripts/eval-models.py` compares whichever models are in `.cache/models`: the toxicity model comes from `npm run model:build`; for another, download its `config.json`, `tokenizer.json` and `model.quant.onnx` from Hugging Face into `.cache/models/<model id>/`. The most useful extra input is your own labelled posts (**Hidden posts → Export labelled posts**, saved as `calibration/posts.jsonl`): the script and `npm run calibrate` pick them up.
