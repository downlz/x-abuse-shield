import type { ScoreReply } from '@/shared/messages';
import type { ServiceStatus } from './model-service';

/**
 * Where the model runs, as seen from the background: Chrome's offscreen
 * document (offscreen-host.ts) or Firefox's background worker (worker-host.ts).
 */
export interface ModelRunner {
  /** Scores texts, starting the model's context first if needed. */
  classify(texts: string[], modelId: string): Promise<ScoreReply>;
  /** Starts loading (or downloading) the model now. */
  load(modelId: string): Promise<void>;
  /** Frees the model's memory. */
  close(): Promise<void>;
  isOpen(): Promise<boolean>;
}

/** Background → Firefox model worker. */
export type WorkerRequest = { type: 'load'; modelId: string } | { type: 'classify'; id: number; texts: string[]; modelId: string };

/** Firefox model worker → background. */
export type WorkerReply = { type: 'status'; status: ServiceStatus } | { type: 'scores'; id: number; reply: ScoreReply };
