/**
 * Room codes: 5 characters from a 32-symbol alphabet with the lookalikes removed
 * (no I, O, 0 or 1), so a code read aloud over a call survives the trip.
 * 32^5 = 33,554,432 rooms, which is plenty for rooms that live for an evening.
 */
export const ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 5;

const VALID = new RegExp(`^[${ROOM_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** Random bytes source; injectable for tests. */
export type RandomBytes = (n: number) => Uint8Array;

const cryptoBytes: RandomBytes = (n) => {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
};

export function makeRoomCode(random: RandomBytes = cryptoBytes): string {
  // 256 is a multiple of 32, so `byte & 31` has no modulo bias.
  const bytes = random(ROOM_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) code += ROOM_ALPHABET[(bytes[i] ?? 0) & 31];
  return code;
}

export function isRoomCode(value: string): boolean {
  return VALID.test(value);
}

/**
 * Turns whatever a person typed or pasted into a room code, or null.
 * Accepts lowercase, spaces and dashes ("abc-de"), and full links
 * ("https://playcubes.pages.dev/r/ABCDE").
 */
export function normalizeRoomCode(input: string): string | null {
  const trimmed = input.trim();
  const fromUrl = /\/r\/([A-Za-z0-9-]+)/.exec(trimmed);
  const raw = (fromUrl?.[1] ?? trimmed).replace(/[\s-]/g, "").toUpperCase();
  return isRoomCode(raw) ? raw : null;
}
