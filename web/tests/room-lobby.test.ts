import type { Lobby } from "@/net/protocol";
import { inviteUrl, lobbySeats, seatLimit } from "@/pages/Room";

function lobby(preset: Lobby["preset"], kinds: ("empty" | "human" | "bot")[]): Lobby {
  return {
    preset,
    seats: kinds.map((kind, seat) => ({ seat, kind, name: kind === "human" ? `P${seat}` : "", pid: kind === "human" ? `pid-${seat}` : null, connected: true, level: kind === "bot" ? "flare" : null })),
    spectators: [],
    hostPid: "pid-0",
  } as unknown as Lobby;
}

describe("room lobby seats", () => {
  test("a two-seat mode shows two seats", () => {
    expect(seatLimit("duel")).toBe(2);
    expect(seatLimit("plane")).toBe(4);
    expect(seatLimit("custom")).toBe(4);
    expect(lobbySeats(lobby("duel", ["human", "empty", "empty", "empty"]), "pid-0")).toHaveLength(2);
    expect(lobbySeats(lobby("plane", ["human", "empty", "empty", "empty"]), "pid-0")).toHaveLength(4);
  });

  test("someone stranded past the limit is still shown", () => {
    const seats = lobbySeats(lobby("duel", ["human", "empty", "empty", "human"]), "pid-0");
    expect(seats.map((s) => s.kind)).toEqual(["player", "empty", "player"]);
  });

  test("the invite link points at the site you're on", () => {
    expect(inviteUrl("K7QXM")).toBe(`${window.location.origin}/r/K7QXM`);
  });
});
