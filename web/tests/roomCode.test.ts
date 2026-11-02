import { ROOM_ALPHABET, ROOM_CODE_LENGTH, isRoomCode, makeRoomCode, normalizeRoomCode } from "@/app/roomCode";

describe("room codes", () => {
  test("alphabet has 32 symbols and no lookalikes", () => {
    expect(ROOM_ALPHABET).toHaveLength(32);
    expect(new Set(ROOM_ALPHABET).size).toBe(32);
    for (const bad of ["I", "O", "0", "1"]) expect(ROOM_ALPHABET).not.toContain(bad);
  });

  test("makeRoomCode produces valid 5-character codes", () => {
    for (let i = 0; i < 500; i++) {
      const code = makeRoomCode();
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isRoomCode(code)).toBe(true);
    }
  });

  test("makeRoomCode maps bytes without bias and is deterministic for given bytes", () => {
    expect(makeRoomCode(() => new Uint8Array([0, 1, 2, 3, 4]))).toBe("ABCDE");
    expect(makeRoomCode(() => new Uint8Array([31, 63, 255, 32, 64]))).toBe("999AA");
  });

  test("codes are spread across the alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) for (const ch of makeRoomCode()) seen.add(ch);
    expect(seen.size).toBeGreaterThan(28);
  });

  test("isRoomCode rejects wrong length, lowercase and lookalikes", () => {
    expect(isRoomCode("ABCDE")).toBe(true);
    expect(isRoomCode("ABCD")).toBe(false);
    expect(isRoomCode("ABCDEF")).toBe(false);
    expect(isRoomCode("abcde")).toBe(false);
    expect(isRoomCode("ABCD0")).toBe(false);
    expect(isRoomCode("ABCDI")).toBe(false);
    expect(isRoomCode("")).toBe(false);
  });

  test("normalizeRoomCode accepts messy input and links", () => {
    expect(normalizeRoomCode(" abc-de ")).toBe("ABCDE");
    expect(normalizeRoomCode("k7q xm")).toBe("K7QXM");
    expect(normalizeRoomCode("https://playcubes.pages.dev/r/k7qxm")).toBe("K7QXM");
    expect(normalizeRoomCode("playcubes.pages.dev/r/K7QXM?x=1")).toBe("K7QXM");
    expect(normalizeRoomCode("HELLO0")).toBeNull();
    expect(normalizeRoomCode("OOOOO")).toBeNull();
  });
});
