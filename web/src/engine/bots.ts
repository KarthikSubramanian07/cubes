import type { Action, AiLevel } from "./types";
import { randomSeed } from "./engine";

export interface BotRequest {
  id: number;
  gameJson: string;
  seat: number;
  level: AiLevel;
  seed: number;
  budgetMs: number;
}

export interface BotResponse {
  id: number;
  action: Action | null;
  error?: string;
}

export const BOT_BUDGET_MS: Record<AiLevel, number> = { ember: 0, flare: 0, nova: 650 };

/** Runs bot decisions in a Web Worker. One request at a time per seat is plenty. */
export class BotRunner {
  private worker: Worker | null = null;
  private next = 1;
  private pending = new Map<number, (r: BotResponse) => void>();

  private ensure(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./bot.worker.ts", import.meta.url), { type: "module" });
      this.worker.onmessage = (e: MessageEvent<BotResponse>) => {
        const done = this.pending.get(e.data.id);
        this.pending.delete(e.data.id);
        done?.(e.data);
      };
    }
    return this.worker;
  }

  think(gameJson: string, seat: number, level: AiLevel): Promise<Action | null> {
    const id = this.next++;
    const req: BotRequest = { id, gameJson, seat, level, seed: randomSeed(), budgetMs: BOT_BUDGET_MS[level] };
    return new Promise((resolve) => {
      this.pending.set(id, (r) => resolve(r.error ? null : r.action));
      this.ensure().postMessage(req);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }
}
