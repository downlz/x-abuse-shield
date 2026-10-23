import { describe, expect, it } from 'vitest';
import { Lexicon } from '@/core/lexicon/match';
import { tokenize } from '@/core/lexicon/normalize';

const all = new Lexicon({ languages: { en: true, hi: true, hinglish: true, emoji: true }, customBlock: [], customAllow: [] });
const strong = (text: string) => all.match(text).hits.filter((h) => h.strength === 'strong');
const mild = (text: string) => all.match(text).hits.filter((h) => h.strength === 'mild');

describe('normalize', () => {
  it('undoes disguises', () => {
    const exact = (text: string) => tokenize(text).map((t) => t.exact);
    expect(exact('𝓬𝓱𝓾𝓽𝓲𝔂𝓪')).toEqual(['chutiya']);
    expect(exact('chu​tiya')).toEqual(['chutiya']);
    expect(exact('f.u.c.k sh1t')).toEqual(['fuck', 'shit']);
    expect(exact('@someone hello https://t.co/x')).toEqual(['hello']);
    expect(tokenize('fuuuuck')[0]!.loose).toBe('fuck');
    expect(tokenize('fuc#ing')[0]!.masked).toBe(true);
    // Nukta and chandrabindu folded, so either spelling matches.
    expect(exact('भोसड़ीके माँ')).toEqual(exact('भोसडीके मां'));
    // Bidi controls (right-to-left mark, override, isolate) can't split a word.
    expect(exact('chu‏tiya f‮uck sh⁦it')).toEqual(['chutiya', 'fuck', 'shit']);
  });
});

describe('emoji', () => {
  it('counts the middle finger on its own, once, whatever the skin tone', () => {
    expect(strong('🖕🖕🖕').map((h) => [h.term, h.category, h.source])).toEqual([['🖕', 'insult', 'emoji']]);
    expect(strong('@someone 🖕🏽').map((h) => h.matched)).toEqual(['🖕']);
  });

  it('treats 🤡 and 💩 as mild', () => {
    expect(strong('🤡🤡🤡 💩')).toEqual([]);
    expect(mild('🤡🤡🤡 💩').map((h) => h.term)).toEqual(['🤡', '💩']);
  });

  it('ignores everyday emoji, and all emoji when the list is off', () => {
    expect(all.match('😂😂🔥🙏 great match 👍').hits).toEqual([]);
    const off = new Lexicon({ languages: { en: true, hi: true, hinglish: true, emoji: false }, customBlock: [], customAllow: [] });
    expect(off.match('🖕').hits).toEqual([]);
  });

  it('takes emoji in the custom block and allow lists', () => {
    const custom = new Lexicon({ languages: { en: true, hi: true, hinglish: true, emoji: true }, customBlock: ['🐍'], customAllow: ['🤡️'] });
    expect(custom.match('you 🐍').hits.map((h) => [h.term, h.strength, h.source])).toEqual([['🐍', 'strong', 'custom']]);
    expect(custom.match('🤡🤡').hits).toEqual([]);
  });
});

describe('strong hits flag on their own', () => {
  it.each([
    // From the user's screenshots (the model scored ss-03 at 0.02).
    ['Chutiya fellow posting useless', 'chutiya'],
    ['Kio chutiya hi hoga jo ye facts layega ....odis is easiest format', 'chutiya'],
    ['Yes literacy you shithead chutiya', 'shithead'],
    ['Eat a bag of dicks,  moron', 'eat a bag of dicks'],
    // Phase 0 samples.
    ['Shut the fuck up, nobody asked for your stupid opinion.', 'shut the fuck up'],
    ['What a pathetic loser, crying online all day like a little bitch.', 'bitch'],
    ['f*ck you and your whole family, you moron', 'fuck you'],
    ['Chup kar bsdk, teri aukaat kya hai?', 'bsdk'],
    ['Madarchod, apni shakal dekh pehle.', 'madarchod'],
    ['Bhenchod tu pagal hai kya, kuch bhi bolta hai.', 'bhenchod'],
    ['Ullu ka pattha hai tu, kuch samajh nahi aata tujhe.', 'ullu ka pattha'],
    ['ch*tiya insaan, b*kwas band kar', 'chutiya'],
    ['मादरचोद, दिमाग खराब मत कर।', 'मादरचोद'],
    ['चुप कर कमीने, तेरी औकात क्या है?', 'कमीने'],
    ['हरामखोर, शर्म नहीं आती तुझे ऐसी बातें करते हुए?', 'हरामखोर'],
    // Live x.com replies missed in Phase 1 testing.
    ['Bsdwale @rahulkanwal gaand mei ghus ja', 'bsdwale'],
    ['Bsdwale @rahulkanwal gaand mei ghus ja', 'gand mei'],
    ['Haarami hai ye', 'harami'],
    // Disguises.
    ['chutiyaaaa', 'chutiya'],
    ['fuuuuck you', 'fuck you'],
    ['you sh1thead', 'shithead'],
    ['𝓬𝓱𝓾𝓽𝓲𝔂𝓪 hai tu', 'chutiya'],
  ])('%s', (text, term) => {
    expect(strong(text).map((h) => h.term)).toContain(term);
  });

  it.each([
    ['I know where you live. Keep talking and see what happens to you.', 'know-where-you-live'],
    ['Send me nudes or I’ll leak your photos everywhere.', 'or-ill-leak'],
    ['Go kill yourself, the world would be better without you.', 'kill-yourself'],
    ['Saale harami, tujhe ghar aake maarunga.', 'ghar-aake-maarunga'],
    ['तुझे घर आकर मारूंगा, देख लेना।', 'ghar-aakar-marunga'],
  ])('threat: %s', (text, rule) => {
    expect(strong(text).map((h) => h.term)).toContain(rule);
  });
});

describe('mild hits need corroboration', () => {
  it.each([
    ['This is fucking amazing, best concert all year!', 'fuck'],
    ["He's a fuc#ing moron.", 'fuck'],
    ['lol this meme is so dumb', 'dumb'],
    ['Abe gadhe, kuch bhi bakwas karta rehta hai.', 'gadhe'],
    ['Kisi ne mujhe pagal bola, but I don’t care.', 'pagal'],
    ['साले कुत्ते, अपनी बकवास बंद कर।', 'कुत्ते'],
    ['Nallo Ki Fauj hai bhaaai', 'nallo'],
  ])('%s', (text, term) => {
    expect(strong(text)).toEqual([]);
    expect(mild(text).map((h) => h.term)).toContain(term);
  });

  it('treats "chutiya banana" (to fool someone) as a mild idiom, not an insult', () => {
    const result = all.match('BC Logon Ko Chutiya Banane Ka Proudcers Ka New technique 😂😂😂');
    expect(result.hits.filter((h) => h.strength === 'strong')).toEqual([]);
    expect(result.hits.map((h) => h.term)).toEqual(expect.arrayContaining(['chutiya banane', 'bc']));
  });
});

describe('no false matches', () => {
  it.each([
    'bc I was late to the meeting',
    'Randi Zuckerberg spoke at the conference',
    'Studying at Lund University this fall',
    'shiitake mushrooms with rice',
    'That was a classic, as always',
    'dumbbell workout done',
    'fire retardant spray',
    'Kill it at your interview tomorrow, you’ve got this!',
    "I'm a proud gay man and I'm getting married next month 🎉",
    'घर हमारा है, सब ठीक है',
    'Arre yaar, tum toh kamaal ho! Bahut mazaa aaya.',
    'Partiamo dalla stazione alle otto',
    // Implicit abuse with no bad words is the model's job (Phase 2).
    'Next shot me joota  muh me hoga iske..🙂',
  ])('%s', (text) => {
    expect(all.match(text).hits).toEqual([]);
  });

  it('lets "bc" count once the post reads as Hinglish', () => {
    expect(all.match('bc ye kya hai yaar').hits.map((h) => h.term)).toContain('bc');
  });
});

describe('benign idioms', () => {
  it('suppress the model threat score', () => {
    expect(all.match('Kill it at your interview tomorrow!').suppressed).toEqual(['threat']);
    expect(all.match('I will find you').suppressed).toEqual([]);
  });
});

describe('options', () => {
  it('respects language toggles, custom blocks and allows', () => {
    const noHinglish = new Lexicon({ languages: { en: true, hi: true, hinglish: false, emoji: true }, customBlock: [], customAllow: [] });
    expect(noHinglish.match('Tu ekdum chutiya hai').hits).toEqual([]);

    const custom = new Lexicon({
      languages: { en: true, hi: true, hinglish: true, emoji: true },
      customBlock: ['scammer'],
      customAllow: ['pagal'],
    });
    expect(custom.match('you scammer').hits.map((h) => [h.term, h.strength, h.source])).toEqual([['scammer', 'strong', 'custom']]);
    expect(custom.match('pagal hai kya').hits).toEqual([]);
  });
});
