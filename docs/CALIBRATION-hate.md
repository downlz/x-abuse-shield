# Calibration report — hate-speech model

Generated 2026-10-27 by `npm run calibrate -- --model hate` with `Horizon-Labs/multilingual-hate-speech-base`. 68 labelled posts: 54 Phase 0 samples (`spike/samples.json`), 14 real posts from screenshots (`calibration/screenshots.jsonl`).

The hate-speech model scores only `hate`, read as identity_attack; its other categories are 0, so mild words get no model corroboration.

Cells show **abusive posts caught / abusive** · **clean posts flagged / clean**.

## Presets

| Tiers | Preset | All | English | Hindi | Hinglish | Other |
|---|---|---|---|---|---|---|
| Word lists only | relaxed | 17/44 · 0/24 | 7/17 · 0/9 | 3/7 · 0/5 | 7/15 · 0/7 | 0/5 · 0/3 |
| Word lists only | balanced | 22/44 · 0/24 | 7/17 · 0/9 | 4/7 · 0/5 | 11/15 · 0/7 | 0/5 · 0/3 |
| Word lists only | strict | 22/44 · 0/24 | 7/17 · 0/9 | 4/7 · 0/5 | 11/15 · 0/7 | 0/5 · 0/3 |
| Word lists + model | relaxed | 20/44 · 0/24 | 9/17 · 0/9 | 4/7 · 0/5 | 7/15 · 0/7 | 0/5 · 0/3 |
| Word lists + model | balanced | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 | 0/5 · 0/3 |
| Word lists + model | strict | 26/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 12/15 · 0/7 | 0/5 · 0/3 |

## Mild words: corroboration bar (Balanced, word lists + model)

A mild word ("idiot", "pagal") counts when model toxicity reaches the bar. Optionally only in replies and mentions.

| Bar | Mild words count in | All | English | Hindi | Hinglish |
|---|---|---|---|---|---|
| 0.40 | all posts | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.50 | all posts | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.60 | all posts | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.72 | all posts | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.80 | all posts | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.40 (default) | replies and mentions | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.50 | replies and mentions | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.60 | replies and mentions | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.72 | replies and mentions | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.80 | replies and mentions | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |

## Threshold sweep (Balanced, word lists + model)

One category varied at a time; the others stay at Balanced.

### toxicity

| Threshold | All | English | Hindi | Hinglish |
|---|---|---|---|---|
| 0.40 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.50 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.60 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.70 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.75 (Balanced) | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.80 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.90 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |

### insult

| Threshold | All | English | Hindi | Hinglish |
|---|---|---|---|---|
| 0.40 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.50 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.60 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.70 (Balanced) | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.75 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.80 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.90 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |

### threat

| Threshold | All | English | Hindi | Hinglish |
|---|---|---|---|---|
| 0.40 (Balanced) | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.50 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.60 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.70 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.75 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.80 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.90 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |

### identity_attack

| Threshold | All | English | Hindi | Hinglish |
|---|---|---|---|---|
| 0.40 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.50 (Balanced) | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.60 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.70 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.75 | 25/44 · 0/24 | 9/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.80 | 24/44 · 0/24 | 8/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |
| 0.90 | 24/44 · 0/24 | 8/17 · 0/9 | 5/7 · 0/5 | 11/15 · 0/7 |

## Account suspicion

No labelled posts carry account details yet, so suspicion offsets can’t be tuned. See `calibration/README.md`.

## Balanced: misses and false alarms (word lists + model)

| Id | Lang | Expected | Model top | Word lists | Text |
|---|---|---|---|---|---|
| en-09 | en | abusive | identity_attack 0.03 | worthless, idiot | You're a worthless idiot and everyone here knows it. |
| en-16 | en | abusive | identity_attack 0.02 | dumb, braindead, clown, 🤡 | Ur so dumb lmao, braindead clown 🤡🤡 |
| en-18 | en | abusive | identity_attack 0.03 | stupid | Imagine being this stupid. Uninstall life. |
| en-20 | en | abusive (sarcasm) | identity_attack 0.01 | dumbest | Great, another genius take from the dumbest account on this app 🙄 |
| hi-06 | hi | abusive | identity_attack 0.12 | बेवकूफ़, नालायक | तू एक नंबर का बेवकूफ और नालायक इंसान है। |
| hi-11 | hi | abusive | identity_attack 0.05 | साले, कुत्ते, बकवास | साले कुत्ते, अपनी बकवास बंद कर। |
| hng-09 | hinglish | abusive | identity_attack 0.05 | gadhe, bakwas | Abe gadhe, kuch bhi bakwas karta rehta hai. |
| hng-12 | hinglish | abusive | identity_attack 0.40 | gaddar | Tere jaise logon ko desh se nikaal dena chahiye, gaddar kahin ke. |
| es-02 | es | abusive | identity_attack 0.04 | — | Eres un imbécil y un inútil, cállate ya. |
| de-02 | de | abusive | identity_attack 0.09 | — | Halt die Klappe, du Vollidiot. |
| fr-01 | fr | abusive | identity_attack 0.07 | — | Ferme ta gueule, espèce de connard. |
| ar-01 | ar | abusive | identity_attack 0.03 | — | أنت غبي وحقير، اسكت. |
| bn-01 | bn | abusive | identity_attack 0.08 | — | তুই একটা গাধা, চুপ কর। |
| ss-06 | en | abusive | identity_attack 0.09 | dick, loser | Eat a big dick, loser |
| ss-07 | en | abusive (obfuscated with #) | identity_attack 0.04 | fuck, moron | He's a fuc#ing moron. |
| ss-09 | en | abusive (mild) | identity_attack 0.03 | loser | Physical and psychological torture counts as trauma. Stop bullying people, loser. |
| ss-10 | en | abusive | identity_attack 0.02 | loser | Not true! I have been watching the WNBA for over 25 years! Definitely; not, for a loser, l |
| live-01 | hinglish | abusive (implicit: a shoe in his face) | identity_attack 0.02 | — | Next shot me joota muh me hoga iske..🙂 |
| live-03 | hinglish | abusive (mild: army of useless people) | identity_attack 0.09 | nallo | Nallo Ki Fauj hai bhaaai |
