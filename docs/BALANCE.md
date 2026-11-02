# cubes: balance notes

> How the bots were tuned, how fair the seats are, and what changed because
> of it. Every number here came out of `cubes-sim`; the commands are listed
> so anyone can rerun them.

## Method

**The simulator.** `crates/sim` plays bot-against-bot games on plain std
threads. Game *i* uses seed `seed + i`, and records are put back in game
order before anything is summed, so a report is reproducible for a given
seed. The one exception is Nova on a clock budget, whose strength depends on
how fast the machine is that day. For that reason every Nova result below
uses `--iters`, a fixed number of search iterations per decision.

```
cargo run -p cubes-sim --release -- --preset duel --seats 2 --games 400 \
    --bots flare,ember --iters 3000 --threads 8
```

Seats cycle through the `--bots` list, and the assignment rotates by one
every game, so each bot sits in each seat equally often. Win share splits
ties evenly. Intervals are 95% normal-approximation intervals on the per-game
mean (±1.96 standard errors), which is fine at these sample sizes and
honest about how little 100 games can tell you.

**Timing.** Wall-clock numbers in the simulator report are whatever the
machine gave us. The `--bench` mode measures process CPU time and keeps the
fastest of five trials. Every result in this file was produced on a laptop
that was also running several other heavy jobs (load average 25 to 80 on 8
cores), so treat absolute microseconds as an upper bound and the ratios as
the real result. The benchmark positions come from a fixed policy that only
looks at the *set* of legal moves (biggest shard, then a seeded pick over
placements sorted by id), so the same positions appear before and after any
change to the generator.

**First-player advantage** is seat 0's win share minus the fair share
(`1/seats`), measured with the same bot in every seat. Flare is the
workhorse for balance runs because it is deterministic and fast enough for
thousands of games. Nova spot-checks the conclusions.

## Results

All numbers below are from the final engine on this branch, Flare in every
seat unless noted, two rounds of Ember openings (`--opening 2`) so games
don't all start the same way, on a loaded laptop with `--threads 2`.

### Speed

`cubes-sim --bench --reps 40`, CPU time per call, same positions for the old
and new generator:

| Position | Old generator | New generator | Speedup |
|---|---:|---:|---:|
| Plane 20×20, 4 seats, mid-game | 34.3 µs | 3.5 µs | 9.9× |
| Duel 14×14, mid-game | 23.6 µs | 2.2 µs | 10.7× |
| Torus 18×18, 4 seats | 40.6 µs | 3.7 µs | 11.1× |
| Stack 8×8×8, 4 seats | 426 µs | 102 µs | 4.2× |

A Flare decision costs about 0.4–1 ms on 2D boards and 2.5 ms in 3D. A Nova
search iteration is 26–65 µs in 2D, so its 650 ms browser budget buys ten to
twenty thousand iterations.

### The ladder

| Match | Games | Winner's share (95% CI) | Average score |
|---|---:|---|---|
| Nova vs Flare, Duel (`--iters 1500`) | 60 | Nova 91.7% [84.6, 98.7] | 75.9 vs 64.5 |
| Flare vs Ember, Duel | 120 | Flare 93.3% [89.0, 97.7] | 74.8 vs 59.4 |
| Nova, Flare, Ember, Flare on Plane | 40 | Nova 90.0% [80.6, 99.4] | 87.9 / 77.6 / 64.9 / 74.7 |

Each level clearly beats the one below it, which is what a ladder is for.
Ember still finishes with a respectable score, so it loses like a person
rather than like a random number generator.

### Fairness, before

First-player edge with Flare in every seat, 80 games each:

| Preset | Edge (95% CI) | Shards left per seat | Rounds |
|---|---|---:|---:|
| Plane, 2 seats (14×14) | **+20.0%** [10.2, 29.8] | 4.9 | 20.0 |
| Plane, 4 seats | +0.6% [−8.9, 10.1] | 3.1 | 22.5 |
| Duel | **+20.0%** [10.2, 29.8] | 4.9 | 20.0 |
| Pure, 4 seats | +8.3% [−1.5, 18.1] | 3.2 | 19.0 |
| Fog, 2 seats | **+13.8%** [3.3, 24.3] | 5.6 | 19.2 |
| Storm, 4 seats | +9.4% [−1.0, 19.8] | 8.6 | 15.5 |
| Torus, 2 seats | +5.6% [−4.7, 15.9] | 5.3 | 19.7 |
| Teams | +5.3% [0.0, 10.6] | 1.7 | 24.0 |
| Stack, 2 seats (6×6×6) | +3.1% | **6.5** | 14.1 |
| Stack, 4 seats | +9.6% [−0.6, 19.8] | 0.7 | 20.7 |
| Orbit, 2 seats (7×7×7) | +8.8% [0.1, 17.5] | **0.0** | 20.7 |

Three problems stood out.

1. **Moving second is a real handicap in two-seat 2D games.** Duel's seat 0
   won two games in three. It also collected more charge (3.2 against 2.6 per
   game) because it reaches the nodes first. The margin was 2.3 points.
2. **Two-seat Stack jammed.** You can't stack on your own colour, so a 6×6×6
   board ran out of legal moves around round 12 with a third of each kit
   still in hand.
3. **Two-seat Orbit never jammed at all.** On 7×7×7 the players never meet,
   both place every shard, and the game is decided by whoever sparked once
   more off a node.

### What changed

**Second-seat charge.** The second seat in a two-seat 2D arena game starts
with charge in hand. Duel, 160 games per row:

| Second seat's starting charge | Flare edge | Margin |
|---:|---|---|
| 0 | +16.6% [9.4, 23.7] | +2.30 |
| 1 | +9.7% [2.4, 17.0] | +1.07 |
| **2** | **−0.9% [−8.5, 6.6]** | −0.61 |
| 3 | −7.2% [−14.6, 0.2] | −1.62 |

Nova agrees (120 games each, seed 77): +11.2% at 0, **+5.0% [−3.7, 13.7]**
at 2, −5.0% at 3. Two it is. Applying the same 2 to 3D boards overshot badly
(Stack −17%, Orbit −26%), so 3D gets none, and the torus, which overshot to
−10% with 2, gets 1. With the rule: Duel −1.7%, Torus −2.5%, Fog −5.8%, all
with intervals across zero.

**Two-seat Stack grew to 8×8×6.** 60 games per row:

| Board | Shards left | Edge | Rounds |
|---|---:|---|---:|
| 6×6×6 (old) | 6.53 | +7.5% | 14.1 |
| 7×7×6 | 4.38 | +5.0% | 16.2 |
| 8×8×6 | **2.37** | **+0.8%** | 18.4 |
| 8×8×8 | 1.90 | +2.5% | 18.9 |

8×8×6 lets players place almost the whole kit, and the extra floor matters
more than the extra height. Four-seat Stack stays at 8×8×8: it already
leaves under one shard per seat, and bigger boards started favouring seat 0
(9×9×8: +16%).

**Two-seat Orbit shrank to 6×6×6.** 120 games per row:

| Board | Edge | Shards left |
|---|---|---:|
| 7×7×7 (old) | +11.7% [4.7, 18.6] | 0.0 |
| **6×6×6** | **+3.8% [−4.9, 12.4]** | **2.5** |
| 6×6×5 | +17.1% [9.1, 25.1] | 4.5 |
| 5×5×5 | +26.7% [19.2, 34.1] | 7.9 |

At 6×6×6 the two players actually get in each other's way, and the result
stops being a coin flip on node timing. Smaller than that and moving first
matters again. Four-seat Orbit stays at 7×7×7 (−5.4%, interval across zero).

### Things we noticed but left alone

- **Bots barely use Shatter, Leap or Scan.** Spark is everywhere (about
  three per seat per game) because it's a cheap extra placement. The others
  only pay off in specific spots, and the bots' surge policy is conservative
  on purpose so they don't throw charge away. People will use them more than
  bots do.
- **Storm games are short and leave a lot unplayed** (8.6 shards per seat in
  4-seat Storm). That's the point of Storm.
- **Four-seat Pure and Storm show a seat-0 lean of around 8 to 9%** with
  intervals that just cross zero. Pure has no charge to hand out, so if it
  firms up with more games, a points komi for later seats is the next thing
  to try.
