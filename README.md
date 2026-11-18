# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hbaxyz/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hbaxyz/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An entry for the make.fun bounty [Build the best token launch radar](https://make.fun/bounty/token-radar-01).

A program that reads one sealed DefiLlama snapshot (758 protocols, fetched 2026-11-14) and ranks the
protocols that record no token by the value a token would have if it were priced the way the market
already prices their tokenized peers — plus a working dashboard and a concrete farm plan for every row.

## The model (radar-2)

Nothing is priced by hand and no protocol name is special-cased in the pricing. Every figure is
computed from the snapshot at run time. (Farm plans are a separate matter — see The board.)

```
implied = TVL × multiple(category) × growth × maturity
```

- **Multiple** — for each category, the median market-cap/TVL of the snapshot's own tokenized
  protocols in it, shrunk toward the global median by the comp count (3 pseudo-comps) and clamped
  to ×0.05–×3. A category with no tokenized comps takes the global median.
- **Growth** — 1 + (7-day TVL change, clamped to −60%…+120%) × 0.5. No recorded change is neutral.
- **Maturity** — 0.6 + (days tracked tokenless, capped at 1,095) × 0.4.

Every board row carries its own arithmetic (the multiple it used, how many comps priced it, its
growth and maturity multipliers), and the dashboard's detail view shows the full derivation.

## The board

- All 40 watchlist protocols, always — the watchlist is the floor, never the ceiling.
- Beyond it, every other protocol that records no token and is a launch candidate in its own right,
  at any TVL (243 rows on this snapshot, 203 of them below the $50M floor). Set aside on the
  watchlist's own principles: exchange house products, versioned pools, canonical bridges, and
  wrapped or staked products of a token that already trades.
- Protocols whose token already trades are never ranked; the dashboard lists them separately at the
  market's own values — they are the comparables that price the board.
- Each row's farm plan states what it costs and how long it takes. Most are derived from the row's
  record (category, chains, TVL, age): the category picks the moves, the chains price the gas, a
  second chain earns its own step, and the protocol's age sets the qualifying window. The
  researched watchlist rows instead carry a hand-checked plan that names the protocol's real
  vaults, points program or mint route, verified against its own site, docs or app — a curator's
  actual Morpho or Kamino vaults, Veda's points dashboard, USDD's mint-and-Earn route. A protocol
  whose route could not be verified keeps the derived plan rather than an invented one.

## The dashboard

A static page with no network and no framework: the ranked board (sortable, searchable, filterable
by category, chain, TVL floor and watchlist), a detail view per protocol with its valuation
breakdown and farm plan, the already-tokenized comparables, and a method page that states the model
and prints the category multiples exactly as computed from the snapshot.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input snapshot.json
# writes out/board.json, out/data.js, out/dashboard/, out/screenshots/, out/dossier.json
```

MIT licensed.
