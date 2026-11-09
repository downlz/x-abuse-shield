import { describe, expect, it, vi } from 'vitest';
import { BATCH_SIZE, ModelService, type ServiceStatus } from '@/adapters/inference/model-service';
import { chunks, scoreMapper, type ToxicityClassifier } from '@/adapters/inference/toxicity-classifier';
import type { CategoryScores } from '@/core/engine/categories';

const scoreFor = (text: string): CategoryScores => ({
  toxicity: text.length / 100,
  severe_toxicity: 0,
  obscene: 0,
  threat: 0,
  insult: 0,
  identity_attack: 0,
  sexual_explicit: 0,
});

function fakeClassifier() {
  const batches: string[][] = [];
  const classifier: ToxicityClassifier = {
    classify: vi.fn(async (texts: string[]) => {
      batches.push(texts);
      return texts.map(scoreFor);
    }),
    dispose: vi.fn(async () => undefined),
  };
  return { classifier, batches };
}

function service(classifier: ToxicityClassifier, statuses: ServiceStatus[] = []) {
  const loader = vi.fn(async (report: (s: ServiceStatus) => void) => {
    report({ state: 'loading', downloading: false, progress: 0 });
    return classifier;
  });
  return { svc: new ModelService(loader, (s) => statuses.push(s)), loader };
}

describe('ModelService', () => {
  it('loads once, reports status and returns scores in request order', async () => {
    const { classifier } = fakeClassifier();
    const statuses: ServiceStatus[] = [];
    const { svc, loader } = service(classifier, statuses);
    const [a, b] = await Promise.all([svc.classify(['one', 'three']), svc.classify(['two'])]);
    expect(a.map((s) => s.toxicity)).toEqual([0.03, 0.05]);
    expect(b[0]!.toxicity).toBe(0.03);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(statuses.map((s) => s.state)).toEqual(['loading', 'ready']);
  });

  it(`batches up to ${BATCH_SIZE} texts and serves the newest request first`, async () => {
    const { classifier, batches } = fakeClassifier();
    const { svc } = service(classifier);
    const older = Array.from({ length: 10 }, (_, i) => `old ${i}`);
    const first = svc.classify(older);
    const second = svc.classify(['new 0', 'new 1']);
    await Promise.all([first, second]);
    expect(batches.every((b) => b.length <= BATCH_SIZE)).toBe(true);
    expect(batches[0]!.slice(0, 2)).toEqual(['new 0', 'new 1']);
  });

  it('de-duplicates queued texts and caches results', async () => {
    const { classifier, batches } = fakeClassifier();
    const { svc } = service(classifier);
    await Promise.all([svc.classify(['same', 'same']), svc.classify(['same'])]);
    await svc.classify(['same']);
    expect(batches.flat()).toEqual(['same']);
  });

  it('rejects waiting requests when loading fails, and retries the load next time', async () => {
    const { classifier } = fakeClassifier();
    const statuses: ServiceStatus[] = [];
    let attempts = 0;
    const svc = new ModelService(async () => {
      if (attempts++ === 0) throw new Error('network down');
      return classifier;
    }, (s) => statuses.push(s));
    await expect(svc.classify(['x'])).rejects.toThrow('network down');
    expect(statuses.at(-1)).toEqual({ state: 'error', message: 'network down' });
    await expect(svc.classify(['x'])).resolves.toHaveLength(1);
  });
});

describe('scoreMapper', () => {
  const logit = (p: number) => Math.log(p / (1 - p));

  it('reads the toxicity model’s labels as the categories, each its own sigmoid', () => {
    const map = scoreMapper({ id2label: { 0: 'toxicity', 1: 'severe_toxicity', 2: 'obscene', 3: 'threat', 4: 'insult', 5: 'identity_attack', 6: 'sexual_explicit' } });
    const scores = map([0.9, 0.1, 0.2, 0.3, 0.8, 0.05, 0.01].map(logit));
    expect(scores.toxicity).toBeCloseTo(0.9);
    expect(scores.insult).toBeCloseTo(0.8);
    expect(scores.identity_attack).toBeCloseTo(0.05);
  });

  it('turns the DistilBERT model’s softmax toxic probability into toxicity, nothing else', () => {
    const map = scoreMapper({ id2label: { 0: 'not-toxic', 1: 'toxic' }, problem_type: 'single_label_classification' });
    const scores = map([-1.2, 2.3]);
    expect(scores.toxicity).toBeCloseTo(Math.exp(2.3) / (Math.exp(-1.2) + Math.exp(2.3)));
    expect({ ...scores, toxicity: 0 }).toEqual({
      toxicity: 0, severe_toxicity: 0, obscene: 0, threat: 0, insult: 0, identity_attack: 0, sexual_explicit: 0,
    });
    expect(map([3, -3]).toxicity).toBeLessThan(0.01);
  });

  it('fails loudly on unknown labels', () => {
    expect(() => scoreMapper({ id2label: { 0: 'positive', 1: 'negative' } })).toThrow(/Unexpected model labels/);
  });
});

describe('chunks', () => {
  it('splits texts into model calls of at most the model’s batch size', () => {
    expect(chunks(['a', 'b', 'c'], 1)).toEqual([['a'], ['b'], ['c']]);
    expect(chunks(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']]);
    expect(chunks(['a', 'b', 'c'], Infinity)).toEqual([['a', 'b', 'c']]);
    expect(chunks([], 1)).toEqual([]);
  });
});
