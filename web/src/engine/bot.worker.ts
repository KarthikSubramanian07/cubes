/// <reference lib="webworker" />
/**
 * Bots think here, off the main thread, so the board keeps animating while
 * Nova searches. Each request carries the full game JSON (a few KB).
 */
import { LocalGame, loadEngine } from "./engine";
import type { BotRequest, BotResponse } from "./bots";

self.onmessage = async (e: MessageEvent<BotRequest>) => {
  const { id, gameJson, seat, level, seed, budgetMs } = e.data;
  let res: BotResponse;
  try {
    await loadEngine();
    const game = LocalGame.fromJSON(gameJson);
    try {
      res = { id, action: game.botAction(seat, level, seed, budgetMs) };
    } finally {
      game.free();
    }
  } catch (err) {
    res = { id, action: null, error: String(err) };
  }
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res);
};
