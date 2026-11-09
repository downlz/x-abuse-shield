# Calibration report

Generated 2026-10-23 by `npm run calibrate`. 68 labelled posts: 54 Phase 0 samples (`spike/samples.json`), 14 real posts from screenshots (`calibration/screenshots.jsonl`).

Cells show **abusive posts caught / abusive** · **clean posts flagged / clean**.

## Presets

| Tiers | Preset | All | English | Hindi | Hinglish | Other |
|---|---|---|---|---|---|---|
| Word lists only | relaxed | 17/44 · 0/24 | 7/17 · 0/9 | 3/7 · 0/5 | 7/15 · 0/7 | 0/5 · 0/3 |
| Word lists only | balanced | 22/44 · 0/24 | 7/17 · 0/9 | 4/7 · 0/5 | 11/15 · 0/7 | 0/5 · 0/3 |
| Word lists only | strict | 22/44 · 0/24 | 7/17 · 0/9 | 4/7 · 0/5 | 11/15 · 0/7 | 0/5 · 0/3 |
| Word lists + model | relaxed | 28/44 · 1/24 | 13/17 · 1/9 | 4/7 · 0/5 | 7/15 · 0/7 | 4/5 · 0/3 |
| Word lists + model | balanced | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 | 4/5 · 0/3 |
| Word lists + model | strict | 39/44 · 7/24 | 16/17 · 6/9 | 7/7 · 1/5 | 11/15 · 0/7 | 5/5 · 0/3 |

## Mild words: corroboration bar (Balanced, word lists + model)

A mild word ("idiot", "pagal") counts when model toxicity reaches the bar. Optionally only in replies and mentions.

| Bar | Mild words count in | All | English | Hindi | Hinglish |
|---|---|---|---|---|---|
| 0.40 | all posts | 38/44 · 5/24 | 15/17 · 4/9 | 7/7 · 1/5 | 12/15 · 0/7 |
| 0.50 | all posts | 37/44 · 5/24 | 15/17 · 4/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.60 | all posts | 36/44 · 4/24 | 14/17 · 3/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.72 | all posts | 34/44 · 1/24 | 12/17 · 0/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.80 | all posts | 34/44 · 1/24 | 12/17 · 0/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.40 (default) | replies and mentions | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.50 | replies and mentions | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.60 | replies and mentions | 35/44 · 1/24 | 13/17 · 0/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.72 | replies and mentions | 34/44 · 1/24 | 12/17 · 0/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.80 | replies and mentions | 34/44 · 1/24 | 12/17 · 0/9 | 7/7 · 1/5 | 11/15 · 0/7 |

## Threshold sweep (Balanced, word lists + model)

One category varied at a time; the others stay at Balanced.

### toxicity

| Threshold | All | English | Hindi | Hinglish |
|---|---|---|---|---|
| 0.40 | 40/44 · 8/24 | 16/17 · 6/9 | 7/7 · 1/5 | 12/15 · 1/7 |
| 0.50 | 39/44 · 6/24 | 16/17 · 5/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.60 | 38/44 · 6/24 | 16/17 · 5/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.70 | 37/44 · 3/24 | 15/17 · 2/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.75 (Balanced) | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.80 | 35/44 · 2/24 | 14/17 · 1/9 | 6/7 · 1/5 | 11/15 · 0/7 |
| 0.90 | 35/44 · 2/24 | 14/17 · 1/9 | 6/7 · 1/5 | 11/15 · 0/7 |

### insult

| Threshold | All | English | Hindi | Hinglish |
|---|---|---|---|---|
| 0.40 | 40/44 · 4/24 | 16/17 · 3/9 | 7/7 · 1/5 | 12/15 · 0/7 |
| 0.50 | 38/44 · 4/24 | 16/17 · 3/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.60 | 37/44 · 4/24 | 15/17 · 3/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.70 (Balanced) | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.75 | 36/44 · 1/24 | 14/17 · 1/9 | 7/7 · 0/5 | 11/15 · 0/7 |
| 0.80 | 36/44 · 1/24 | 14/17 · 1/9 | 7/7 · 0/5 | 11/15 · 0/7 |
| 0.90 | 36/44 · 1/24 | 14/17 · 1/9 | 7/7 · 0/5 | 11/15 · 0/7 |

### threat

| Threshold | All | English | Hindi | Hinglish |
|---|---|---|---|---|
| 0.40 (Balanced) | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.50 | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.60 | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.70 | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.75 | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.80 | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.90 | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |

### identity_attack

| Threshold | All | English | Hindi | Hinglish |
|---|---|---|---|---|
| 0.40 | 37/44 · 3/24 | 15/17 · 2/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.50 (Balanced) | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.60 | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.70 | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.75 | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.80 | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |
| 0.90 | 36/44 · 2/24 | 14/17 · 1/9 | 7/7 · 1/5 | 11/15 · 0/7 |

## Account suspicion

No labelled posts carry account details yet, so suspicion offsets can’t be tuned. See `calibration/README.md`.

## Balanced: misses and false alarms (word lists + model)

| Id | Lang | Expected | Model top | Word lists | Text |
|---|---|---|---|---|---|
| en-13 | en | abusive (identity attack) | toxicity 0.74 | — | People like you from that religion are all terrorists and should be kicked out of this cou |
| en-19 | en | abusive (identity attack) | toxicity 0.32 | — | Women like you belong in the kitchen, not giving opinions on politics. |
| en-20 | en | abusive (sarcasm) | toxicity 0.65 | dumbest | Great, another genius take from the dumbest account on this app 🙄 |
| hi-05 | hi | clean (quoting abuse) | toxicity 0.64 | बेवकूफ़ | किसी ने मुझे बेवकूफ कहा, पर मैं ध्यान नहीं देता। सबके साथ अच्छे से पेश आओ। |
| hng-09 | hinglish | abusive | toxicity 0.45 | gadhe, bakwas | Abe gadhe, kuch bhi bakwas karta rehta hai. |
| hng-12 | hinglish | abusive | toxicity 0.38 | gaddar | Tere jaise logon ko desh se nikaal dena chahiye, gaddar kahin ke. |
| de-02 | de | abusive | toxicity 0.47 | — | Halt die Klappe, du Vollidiot. |
| ss-08 | en | clean (ambiguous fetish post) | toxicity 0.54 | loser | kneeling at Their cruel feet is a loser's purpose |
| live-01 | hinglish | abusive (implicit: a shoe in his face) | toxicity 0.26 | — | Next shot me joota muh me hoga iske..🙂 |
| live-03 | hinglish | abusive (mild: army of useless people) | toxicity 0.31 | nallo | Nallo Ki Fauj hai bhaaai |
