import type { CategoryScores } from '@/core/engine/categories';
import type { ToxicityClassifier } from './toxicity-classifier';

export const BATCH_SIZE = 8;
const CACHE_LIMIT = 5000;

export type ServiceStatus =
  | { state: 'loading'; downloading: boolean; progress: number }
  | { state: 'ready' }
  | { state: 'error'; message: string };

interface Job {
  text: string;
  waiters: { resolve: (scores: CategoryScores) => void; reject: (error: unknown) => void }[];
}

/**
 * Runs in the offscreen document. Loads the model once, then scores texts
 * from every tab in batches. Newest requests go first: while scrolling, the
 * posts on screen now matter more than ones already scrolled past.
 */
export class ModelService {
  private classifier: Promise<ToxicityClassifier> | null = null;
  private readonly cache = new Map<string, CategoryScores>();
  private readonly queued = new Map<string, Job>();
  private queue: Job[] = [];
  private draining = false;

  constructor(
    private readonly loader: (report: (status: ServiceStatus) => void) => Promise<ToxicityClassifier>,
    private readonly report: (status: ServiceStatus) => void,
  ) {}

  ensureLoaded(): Promise<ToxicityClassifier> {
    this.classifier ??= this.loader(this.report).then(
      (classifier) => {
        this.report({ state: 'ready' });
        return classifier;
      },
      (error: unknown) => {
        this.classifier = null;
        this.report({ state: 'error', message: error instanceof Error ? error.message : String(error) });
        throw error;
      },
    );
    return this.classifier;
  }

  classify(texts: string[]): Promise<CategoryScores[]> {
    const fresh: Job[] = [];
    const results = texts.map((text) => {
      const cached = this.cache.get(text);
      if (cached) {
        this.remember(text, cached);
        return Promise.resolve(cached);
      }
      return new Promise<CategoryScores>((resolve, reject) => {
        let job = this.queued.get(text);
        if (!job) {
          job = { text, waiters: [] };
          this.queued.set(text, job);
          fresh.push(job);
        }
        job.waiters.push({ resolve, reject });
      });
    });
    this.queue = [...fresh, ...this.queue];
    void this.drain();
    return Promise.all(results);
  }

  private async drain(): Promise<void> {
    if (this.draining || this.queue.length === 0) return;
    this.draining = true;
    try {
      const classifier = await this.ensureLoaded();
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, BATCH_SIZE);
        try {
          const scores = await classifier.classify(batch.map((job) => job.text));
          batch.forEach((job, i) => this.settle(job, (w) => w.resolve(scores[i]!), scores[i]));
        } catch (error) {
          batch.forEach((job) => this.settle(job, (w) => w.reject(error)));
        }
      }
    } catch (error) {
      this.queue.splice(0).forEach((job) => this.settle(job, (w) => w.reject(error)));
    } finally {
      this.draining = false;
    }
  }

  private settle(job: Job, notify: (waiter: Job['waiters'][number]) => void, scores?: CategoryScores) {
    this.queued.delete(job.text);
    if (scores) this.remember(job.text, scores);
    job.waiters.forEach(notify);
  }

  /** Least-recently-used cache: Map keeps insertion order, so re-inserting marks an entry as fresh. */
  private remember(text: string, scores: CategoryScores) {
    this.cache.delete(text);
    this.cache.set(text, scores);
    if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
  }
}
