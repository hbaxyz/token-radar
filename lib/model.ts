// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds every
// other rankable pre-token protocol the snapshot carries, at any TVL: the early rows the radar exists
// to find. A protocol is pre-token when its record carries no token (no market cap, no CoinGecko id,
// no symbol); the snapshot's live-token protocols are kept apart and shown at the market's own values,
// never mixed into the ranked board. Beyond the watchlist, a protocol is ranked only when it is a
// launch candidate in its own right (isRankable): exchange house products, versioned pools, canonical
// bridges and wrapped or staked products of a token that already trades are set aside, on the same
// principles the watchlist itself states. The watchlist's own slugs are always ranked: the floor is
// the floor.
//
// Implied value follows only from the snapshot's own figures. The market prices the tokenized
// protocols; the model reads that pricing off them and applies it to the ones still to come:
//
//   multiple(cat)  the median market-cap/TVL of the snapshot's tokenized protocols in the category,
//                  shrunk toward the global median by the comp count (SHRINK_K pseudo-comps), then
//                  clamped to [MULTIPLE_FLOOR, MULTIPLE_CAP]; a category with no comps takes the
//                  global median. No multiple is written down anywhere: all are computed per run.
//   base           = tvl_usd x multiple(category)
//   growthMult     = 1 + (clamp(change_7d, -60, 120) / 100) x GROWTH_WEIGHT   (no figure: 1)
//   maturityMult   = 0.6 + min(age_days, 1095) / 1095 x 0.4                   (age unknown: 365 days)
//   implied        = max(1, round(base x growthMult x maturityMult))
//
// Every row carries its own arithmetic (the multiple it used, how many comps priced it, its growth
// and maturity multipliers), so the dashboard's detail view can show the whole derivation. No
// protocol name is ever special-cased: the same function scores every row.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. The multiples are not constants: they are computed. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  multiple_floor: number;
  multiple_cap: number;
  shrink_k: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  multiple_floor: 0.05,
  multiple_cap: 3,
  shrink_k: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 60;

/** One category's pricing, read off the snapshot's tokenized protocols. */
export interface CategoryMultiple {
  category: string;
  multiple: number;
  comps: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row, with its derivation attached. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number;
    comps: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row: the board row's figures, its derivation and its farm plan. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  comps: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the multiples and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  multiples: CategoryMultiple[];
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/**
 * The pricing table: for every category, the multiple the snapshot's own tokenized protocols imply.
 * A comp is a protocol whose token trades with a recorded market cap and a positive TVL. Each
 * category's median mcap/TVL is shrunk toward the global median by its comp count, so a category
 * priced by one protocol leans on the market as a whole, and clamped to the stated band.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): { global: number; byCategory: Map<string, CategoryMultiple> } {
  const ratiosByCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    all.push(ratio);
    const key = p.category ?? '';
    const list = ratiosByCategory.get(key) ?? [];
    list.push(ratio);
    ratiosByCategory.set(key, list);
  }
  const globalRaw = all.length > 0 ? median(all) : 0.25;
  const clampMultiple = (m: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, m));
  const byCategory = new Map<string, CategoryMultiple>();
  for (const [category, ratios] of ratiosByCategory) {
    const shrunk = (ratios.length * median(ratios) + model.shrink_k * globalRaw) / (ratios.length + model.shrink_k);
    byCategory.set(category, { category, multiple: round4(clampMultiple(shrunk)), comps: ratios.length });
  }
  return { global: round4(clampMultiple(globalRaw)), byCategory };
}

/** The three multipliers and the implied value one protocol gets under `model` and the pricing table. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: { global: number; byCategory: Map<string, CategoryMultiple> },
): { implied: number; multiple: number; comps: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const priced = multiples.byCategory.get(protocol.category ?? '');
  const multiple = priced?.multiple ?? multiples.global;
  const comps = priced?.comps ?? 0;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const base = protocol.tvl_usd * multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult));
  return { implied, multiple, comps, growthPct, growthMult, maturityMult, age };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word that marks a wrapped or staked product of a token that already trades. */
const WRAPPED_OR_STAKED = /\b(wrapped|staked|staking)\b/i;

/** An exchange's own name at the front of a name: the house product of a company, not a launch candidate. */
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;

/** A wrapped asset's ticker worn as a name: W plus the underlying asset's ticker (WBTC, WETH and kin). */
const WRAPPED_TICKER = /^w(btc|eth|sol|avax|matic|bnb|ltc|doge|bch|xrp|ada|dot|ftm|near|atom)$/i;

/** A bridged form's name: a bare asset ticker with a trailing digit (USDT0 and kin), or a wrapped BTC/ETH ticker standing in the name as its own word (FBTC, LBTC, tBTC and kin). */
const BRIDGED_TICKER = /^[A-Z]{3,6}\d$/;
const WRAPPED_ASSET_WORD = /\b(fbtc|lbtc|ebtc|solvbtc|tbtc|wbtc|weth|cbtc|sbtc)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol is one the board may rank beyond the watchlist. The eligibility rule mirrors the
 * watchlist's own principles: pre-token, not an exchange house product (by category or by the
 * exchange's name up front), not a versioned pool of another protocol, not a canonical bridge (a mint
 * of another chain's asset, whose launch is the parent asset's affair), and not a wrapped or staked
 * product of a token that already trades, by word or by wrapped-ticker name.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    p.category !== 'CEX' &&
    p.category !== 'Canonical Bridge' &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_OR_STAKED.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name) &&
    !WRAPPED_TICKER.test(p.name) &&
    !BRIDGED_TICKER.test(p.name) &&
    !WRAPPED_ASSET_WORD.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const multiples = categoryMultiples(snapshot, model);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug is ranked, whatever its name or category.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, at any TVL. A protocol above the floor
  // that the watchlist's own exclusions left out (a liquid staking protocol, say) is exactly the kind
  // of row a radar exists to surface, so there is no TVL condition and no cap.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, model, multiples);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.multiple,
      comps: s.comps,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A typical swap-or-deposit gas cost by chain, in dollars, stated as an approximation wherever the
 * dashboard shows it. Ethereum mainnet is the expensive outlier; rollups and alt-L1s are cents.
 */
const CHAIN_GAS_USD: Record<string, number> = {
  Ethereum: 6,
  Solana: 0.05,
  Base: 0.15,
  Arbitrum: 0.2,
  Optimism: 0.15,
  'OP Mainnet': 0.15,
  Polygon: 0.05,
  'Polygon zkEVM': 0.1,
  BSC: 0.2,
  'BNB Chain': 0.2,
  Avalanche: 0.35,
  Gnosis: 0.05,
  Linea: 0.15,
  Scroll: 0.15,
  zkSync: 0.2,
  'zkSync Era': 0.2,
  Mantle: 0.1,
  Blast: 0.1,
  Mode: 0.1,
  Fantom: 0.05,
  Sonic: 0.05,
  Cronos: 0.05,
  Near: 0.05,
  Sui: 0.05,
  Aptos: 0.05,
  Tron: 1,
  Bitcoin: 1.5,
};

/** The gas one transaction costs on a chain, in dollars; chains the table does not name get the mid default. */
function gasFor(chain: string): number {
  return CHAIN_GAS_USD[chain] ?? 0.4;
}

/** A gas figure the way a reader budgets it. */
function gasText(chain: string): string {
  const gas = gasFor(chain);
  return gas < 0.1 ? 'under $0.10' : `about $${gas.toFixed(2).replace(/\.?0+$/, '')}`;
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The two moves a category's farmer makes: open the position, then work it. Derived from the category, never the name. */
function actionsFor(p: SnapshotProtocol, capital: number, chain: string): { open: string; work: string } {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      open: `Supply $${capital} of USDC to ${name} on ${chain} as collateral and keep the supply position open`,
      work: `Borrow about 30% of the supplied value against the position and repay it a week later, so the wallet shows both sides of the market`,
    };
  }
  if (c.includes('bridge')) {
    return {
      open: `Bridge $${capital} of USDC from Ethereum to ${chain} through ${name}, then use the bridged funds in one app on the far side`,
      work: `Bridge a smaller amount, about $25, back the other way two weeks later, so the wallet has crossings in both directions`,
    };
  }
  if (c.includes('restak') || c.includes('liquid staking') || c.includes('staking')) {
    return {
      open: `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the liquid receipt token in the wallet`,
      work: `Use the receipt token once, as collateral or in a pool the protocol itself lists, and claim any rewards the position accrues`,
    };
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) {
    return {
      open: `Deposit $${capital} of USDC as margin on ${name} and open one small position, about $25 of notional, hedged or fully collateralised`,
      work: `Place one small trade a week for four weeks, keeping each position under an hour, so the account reads as a user and not a wash trader`,
    };
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('yield')) {
    return {
      open: `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the vault shares in the wallet`,
      work: `Add about 10% to the position each fortnight and withdraw nothing, so the balance history grows the way a saver's does`,
    };
  }
  if (c.includes('rwa') || c.includes('stable')) {
    return {
      open: `Mint or deposit $${capital} of the protocol's yield-bearing asset through ${name} on ${chain} and hold it in the wallet`,
      work: `Hold the asset across at least two monthly distributions and claim each one from the protocol's own page`,
    };
  }
  if (c.includes('basis') || c.includes('funding')) {
    return {
      open: `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open`,
      work: `Top the position up by about $25 after a month and leave the yield compounding rather than harvesting it`,
    };
  }
  if (c.includes('chain') || c.includes('layer') || c.includes('rollup')) {
    return {
      open: `Bridge $${capital} of ETH or USDC onto ${name}'s network and make the wallet's first transactions there: one transfer and one swap`,
      work: `Transact on the network once a week for six weeks, small amounts on different days, and try one new app the network features each fortnight`,
    };
  }
  if (c.includes('insurance')) {
    return {
      open: `Buy about $${capital} of cover from ${name} on ${chain} against a position you actually hold, and keep the policy to expiry`,
      work: `Renew the cover once when it expires, so the wallet shows a second policy period`,
    };
  }
  if (c.includes('prediction')) {
    return {
      open: `Fund $${capital} on ${name} and place one position in a market you have a view on`,
      work: `Settle the position at resolution and place one more, so the account has a full trade history`,
    };
  }
  // Dexs and everything else: liquidity and swaps are the qualifying activity.
  return {
    open: `Provide $${capital} of liquidity to ${name}'s main stable or ETH pool on ${chain} and keep the LP position open`,
    work: `Swap about $25 through ${name} once a week, alternating direction, so the wallet shows regular volume as well as liquidity`,
  };
}

/**
 * Hand-checked farm plans for the watchlist rows whose real product could be verified against the
 * protocol's own site, docs or app (researched November 2026). The valuation above never reads
 * this table — pricing stays fully computed from the snapshot — but a farm plan is advice, and
 * advice that names the wrong vault is worse than a generic plan, so where a protocol's actual
 * vaults, points program or mint mechanism are public, the plan names them. Rows without an entry
 * here keep the derived category plan below; a protocol whose route could not be verified (Hive
 * Protocol's identity, for one) gets no entry rather than an invented one.
 */
const FARM_OVERRIDES: Record<string, FarmStep[]> = {
  'steakhouse-financial': [
    {
      text: "Fund a wallet with USDC and a little ETH for gas, then open the Morpho app's vault list and pick a Steakhouse Financial vault: deposits sit in Morpho contracts and Steakhouse only curates the vault's markets",
      cost: 'under $3 to fund, gas about $6 on Ethereum or cents on Base',
      time: '10 minutes',
    },
    {
      text: 'Deposit $150 of USDC into Steakhouse Prime USDC, the conservative family whose collateral is blue-chip, and keep the vault shares in the wallet; the High Yield family takes broader collateral for a higher rate',
      cost: '$150 of capital, one deposit of gas',
      time: '15 minutes to set up',
    },
    {
      text: 'Open a second, smaller position in Steakhouse High Yield USDC on Arbitrum and compare the two vaults\' APY breakdowns before adding more to either',
      cost: 'about $50 more capital, gas about $0.20 on Arbitrum',
      time: '15 minutes',
    },
    {
      text: 'Hold both positions across the window: the Prime and High Yield vaults have no deposit lockup, but withdrawals depend on market liquidity, and Steakhouse\'s Term vaults instead run to a fixed maturity, so check the vault page before using one',
      cost: 'the capital stays deployed for the window',
      time: '45 days, 5 minutes a week',
    },
    {
      text: 'Expect no points: Steakhouse runs no points program, so the lending yield is the whole return. Log every deposit hash and set the exit now: withdraw after a full quarter of compounding, or sooner if the vault\'s collateral list changes',
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  ],
  gauntlet: [
    {
      text: 'Fund a wallet with USDC and gas on Arbitrum, then open Gauntlet\'s vault list in the Morpho app: its vaults are organised by mandate — Prime takes blue-chip collateral only, Balanced mixes in higher-yield markets, Frontier chases maximum yield on mid-cap collateral',
      cost: 'under $3 to fund, gas about $0.20 on Arbitrum',
      time: '10 minutes',
    },
    {
      text: 'Deposit $150 of USDC into Gauntlet USDC Balanced on Morpho and keep the vault shares; stay in the Prime or Balanced mandates unless the Frontier risk is a deliberate choice',
      cost: '$150 of capital, one deposit of gas',
      time: '15 minutes to set up',
    },
    {
      text: 'Add a second position in a Gauntlet vault on Kamino, its Solana line, depositing USDC there so the farm spans both of the curator\'s platforms',
      cost: 'about $50 of capital, gas under $0.10 on Solana',
      time: '15 minutes',
    },
    {
      text: 'Hold across the window and re-check the mandate\'s market list monthly: a curator vault\'s risk is the markets it lends into, and Gauntlet rebalances them as conditions change',
      cost: 'the capital stays deployed for the window',
      time: '45 days, 5 minutes a week',
    },
    {
      text: 'Expect no points: Gauntlet has no token and no points program, so lending yield is the whole return. Log every hash and exit by withdrawing to USDC once the window closes',
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  ],
  'nonce-capital': [
    {
      text: 'Fund a wallet with ETH-side assets and gas on Ethereum: Nonce Capital has no retail app of its own — it curates yield strategies for ether.fi on Veda\'s vault infrastructure, so the farm runs through ether.fi\'s app, not a Nonce page',
      cost: 'under $3 to fund, gas about $6 on Ethereum',
      time: '10 minutes',
    },
    {
      text: 'Deposit $100 into an ether.fi Liquid vault from its ETH, BTC or USD line, the product family Nonce curates strategies for, and keep the Liquid vault tokens in the wallet',
      cost: '$100 of capital, one deposit of gas',
      time: '15 minutes to set up',
    },
    {
      text: 'Read the vault\'s own page for its curator and strategy notes before adding more: which Liquid vaults Nonce curates is disclosed only in general terms, so size the position as an ether.fi position, not a Nonce one',
      cost: 'nothing to read',
      time: '10 minutes',
    },
    {
      text: 'Hold the Liquid tokens across the window and claim whatever the position accrues from ether.fi\'s own rewards page, never from a link in a message or a search ad',
      cost: 'the capital stays deployed for the window',
      time: '45 days, 5 minutes a week',
    },
    {
      text: 'Expect no Nonce points: any points on this position belong to ether.fi\'s or Veda\'s programs, not to Nonce. Log every hash and exit by redeeming the Liquid tokens when the window closes',
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  ],
  rockawayx: [
    {
      text: 'Fund a wallet with USDC and ETH gas, then open the Morpho vault list filtered to RockawayX: its public line is rxUSDCp (Prime), rxUSDCy (Yield) and a wETH vault on Ethereum, plus an RWA vault on Kamino',
      cost: 'under $3 to fund, gas about $6 on Ethereum',
      time: '10 minutes',
    },
    {
      text: 'Deposit $100 of USDC into RockawayX USDC Prime, rxUSDCp, which lends against cbBTC, WBTC and wstETH at a 0% performance fee, and keep the vault token in the wallet',
      cost: '$100 of capital, one deposit of gas',
      time: '15 minutes to set up',
    },
    {
      text: 'Add a smaller position in USDC Yield, rxUSDCy, whose markets include RWA-backed collateral such as Maple\'s syrupUSDC, at a 5% performance fee, and compare the two vaults\' yields monthly',
      cost: 'about $50 more capital, one deposit of gas',
      time: '15 minutes',
    },
    {
      text: 'Optionally repeat a small version on Solana: deposit USDC into the RockawayX RWA Vault on Kamino, which allocates across OnRe, Huma, Figure and Solstice. Skip the Tori predeposit vault unless a lockup until its phase transition is acceptable',
      cost: 'about $25 of capital, gas under $0.10 on Solana',
      time: '15 minutes',
    },
    {
      text: 'Expect no RockawayX points: the yield is the return, and the points the Tori vault quotes belong to Tori. Log every hash and exit by withdrawing from each vault when the window closes',
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  ],
  veda: [
    {
      text: 'Fund a wallet with ETH-side assets and gas, then open the Veda Points dashboard on Veda\'s own site: Veda is vault infrastructure (its BoringVault design powers products such as ether.fi Liquid and Lombard\'s DeFi Vault), and the dashboard lists which activities currently earn Veda Points',
      cost: 'under $3 to fund, gas about $6 on Ethereum',
      time: '10 minutes',
    },
    {
      text: 'Deposit $150 into a qualifying Veda-powered vault from that list — the documented example is Lombard\'s DeFi Vault — and keep the vault token (LBTCv for the Lombard vault) in the wallet',
      cost: '$150 of capital, one deposit of gas',
      time: '15 minutes to set up',
    },
    {
      text: 'Check the dashboard monthly and stay in listed activities only: points accrue while the position sits in a qualifying vault, and a vault that leaves the list stops earning',
      cost: 'nothing to check',
      time: '10 minutes a month',
    },
    {
      text: 'Hold the position across the whole window rather than rotating weekly: the program rewards sustained participation, and US users are restricted from the points campaign, so confirm eligibility on the dashboard first',
      cost: 'the capital stays deployed for the window',
      time: '60 days, 5 minutes a week',
    },
    {
      text: 'Log the wallet, the vault and every hash, and set the exit now: unwind when Veda\'s token launches and any claim is live on Veda\'s own site, or after the window with no announcement. A claim that asks for a fee or a blind approval is a scam',
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  ],
  usdd: [
    {
      text: 'Fund a wallet with ETH and gas on Ethereum, then open USDD\'s own app at app.usdd.io/eth: USDD is the TRON DAO Reserve\'s over-collateralised stablecoin, issued against collateral in its ETH Vault and WBTC Vault',
      cost: 'under $3 to fund, gas about $6 on Ethereum',
      time: '10 minutes',
    },
    {
      text: 'Deposit ETH as collateral in the ETH Vault and mint about $150 of USDD against it, keeping the collateral ratio comfortably above the liquidation line the vault shows',
      cost: 'the ETH collateral, one mint of gas',
      time: '15 minutes to set up',
    },
    {
      text: 'Deposit the minted USDD into USDD Earn and hold the sUSDD receipt: Earn pays the protocol\'s savings rate (about 4% base APY in its recent reporting) with no lockup, so the position can be unwound at any time',
      cost: 'one deposit of gas',
      time: '10 minutes',
    },
    {
      text: 'Check the collateral ratio weekly and top the vault up if ETH falls: a CDP position is worked by defending its liquidation price, not by adding more debt',
      cost: 'the capital stays deployed for the window',
      time: '30 days, 5 minutes a week',
    },
    {
      text: 'Expect no points and no airdrop: USDD is already the token, so the Earn rate is the whole return. Log every hash and exit by repaying the mint and withdrawing the collateral, or by redeeming sUSDD back to USDD',
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  ],
  hyperithm: [
    {
      text: 'Fund a wallet with USDC on Solana and a little SOL for gas: Hyperithm is a Tokyo and Seoul asset manager whose onchain line is curator vaults, and its most accessible one is the Hyperithm USDC Apex Vault on Kamino',
      cost: 'under $3 to fund, gas under $0.10 on Solana',
      time: '10 minutes',
    },
    {
      text: 'Deposit $100 of USDC into the USDC Apex Vault on Kamino and keep the vault shares in the wallet; the vault lends the USDC out under Hyperithm\'s market-neutral management',
      cost: '$100 of capital, one deposit of gas',
      time: '15 minutes to set up',
    },
    {
      text: 'Optionally open the Monad side instead or as well: Hyperithm\'s vault on Accountable\'s YieldApp takes USDC and issues the aHYPER share token, which also serves as collateral in Morpho markets on Monad',
      cost: 'about $50 of capital, gas about $0.40 on Monad',
      time: '15 minutes',
    },
    {
      text: 'Hold across the window and check the vault page before adding more: the lockup and withdrawal terms are set per vault and are not stated in Hyperithm\'s public materials, so confirm them in the app first',
      cost: 'the capital stays deployed for the window',
      time: '45 days, 5 minutes a week',
    },
    {
      text: 'Expect no points: no Hyperithm points program is public, so the strategy yield is the whole return. Log every hash and exit by withdrawing from the vault when the window closes',
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  ],
  'k3-capital': [
    {
      text: 'Fund a wallet with the deposit asset and gas on Ethereum: K3 Capital is a delta-neutral fund that also runs public vaults through its app, routing deposits into strategies on venues such as Liquity, Morpho and Euler',
      cost: 'under $3 to fund, gas about $6 on Ethereum',
      time: '10 minutes',
    },
    {
      text: 'Deposit BOLD into K3\'s sBold vault, which directs the BOLD into Liquity v2\'s stability pool to earn liquidation gains, or deposit USDT into one of its Earn vaults if BOLD is not to hand, and keep the receipt tokens',
      cost: '$100 of capital, one deposit of gas',
      time: '15 minutes to set up',
    },
    {
      text: 'Verify the vault\'s terms inside the live app before adding more: K3\'s public Q&A describes the vaults, but the per-vault lockup and fee terms are the ones the app shows at deposit time',
      cost: 'nothing to read',
      time: '10 minutes',
    },
    {
      text: 'Hold the receipt tokens across the window and re-check the strategy allocation monthly: a routing vault\'s yield follows the venues underneath it, and K3 moves allocations as rates change',
      cost: 'the capital stays deployed for the window',
      time: '45 days, 5 minutes a week',
    },
    {
      text: 'Expect no token points: K3\'s own Q&A says it has no publicly traded governance token, so the vault yield is the whole return. Log every hash and exit by withdrawing from the vault when the window closes',
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  ],
  clearstar: [
    {
      text: 'Fund a wallet with USDC and gas on Base, then open the Morpho vault list filtered to Clearstar: its vaults (the Clearstar Labs brand, operated by NovaFusion SA) come in Core, Reactor and Boring families across Base, Arbitrum and Katana',
      cost: 'under $3 to fund, gas about $0.15 on Base',
      time: '10 minutes',
    },
    {
      text: 'Deposit $100 of USDC into Clearstar Boring USDC on Base, the conservative family at a 0% performance fee, and keep the vault shares in the wallet',
      cost: '$100 of capital, one deposit of gas',
      time: '15 minutes to set up',
    },
    {
      text: 'For the one real incentive angle in this row, open Clearstar Core USDC on Katana instead or as well: its published APY includes KAT token rewards on top of the lending rate, unlike Clearstar\'s own points, which do not exist',
      cost: 'about $50 more capital, gas about $0.40 on Katana',
      time: '15 minutes',
    },
    {
      text: 'Hold across the window and compare families before adding more: the Reactor vaults take a 20% performance fee for higher-yield markets, and parameter changes sit behind timelocks of days, so a vault\'s terms cannot change overnight',
      cost: 'the capital stays deployed for the window',
      time: '45 days, 5 minutes a week',
    },
    {
      text: 'Log every deposit hash and set the exit now: withdraw to USDC when the window closes, and claim any KAT rewards only from Katana\'s or Morpho\'s own pages, never from a link in a message',
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  ],
};

/**
 * A protocol's farm plan: five to seven steps, each an action with a cost and a time. Watchlist
 * rows with a verified product use the hand-checked plan in FARM_OVERRIDES above. Every other
 * plan is derived from the protocol's own record (category, chains, TVL, age): the category picks
 * the two moves, the first chain prices the gas, a second chain earns its own step, and the
 * protocol's age sets the qualifying window.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const override = FARM_OVERRIDES[p.slug];
  if (override !== undefined) return override.map((s) => ({ ...s }));
  // A bridge's working chain is the far side, not Ethereum; every other protocol works on its first chain.
  const isBridge = (p.category ?? '').toLowerCase().includes('bridge');
  const chain = isBridge
    ? (p.chains.find((c) => c !== 'Ethereum') ?? p.chains[0] ?? 'its main chain')
    : p.chains.length > 0
      ? p.chains[0]!
      : 'its main chain';
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const { open, work } = actionsFor(p, capital, chain);
  const steps: FarmStep[] = [
    {
      text: `Fund a fresh wallet with the farm capital plus a little of ${chain}'s gas token, and keep its seed phrase offline and never reused elsewhere`,
      cost: 'under $3 to set up and fund',
      time: '10 minutes',
    },
    {
      text: open,
      cost: `$${capital} of capital, gas ${gasText(chain)} at typical ${chain} fees`,
      time: '15 minutes to set up',
    },
    {
      text: work,
      cost: `gas ${gasText(chain)} a time on ${chain}`,
      time: '10 minutes a week',
    },
  ];
  if (p.chains.length > 1) {
    const second = p.chains[1]!;
    steps.push({
      text: `Repeat a small version of the position, about $${Math.max(25, Math.floor(capital / 4))}, on ${second}, ${p.name}'s second chain: multi-chain users are the ones points programs usually weight`,
      cost: `about $${Math.max(25, Math.floor(capital / 4))} of capital, gas ${gasText(second)} on ${second}`,
      time: '15 minutes',
    });
  }
  steps.push(
    {
      text: `Hold every position for at least ${hold} days and check in weekly, so the activity spans more than one snapshot instead of a single day's spike`,
      cost: `the $${capital} stays deployed for the window`,
      time: `${hold} days, 5 minutes a week`,
    },
    {
      text: `Open ${p.name}'s own points, rewards or governance page from the protocol's site only, and claim only what it shows: never pay a fee or sign a blind approval to claim`,
      cost: 'nothing to check; a claim that asks for payment is a scam',
      time: '10 minutes',
    },
    {
      text: `Log the wallet, the dates and every transaction hash in a farm note, and set the exit now: unwind when the token launches and the claim is live, or after ${hold + 30} days with no announcement`,
      cost: 'nothing but the note',
      time: '5 minutes',
    },
  );
  return steps;
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's form for data.js: everything the page renders, the farm plan included verbatim. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    comps: row.model.comps,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const multiples = categoryMultiples(snapshot, model);
  const early = board.filter((r) => !r.watchlist).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: multiples.global,
    multiples: [...multiples.byCategory.values()]
      .filter((m) => m.category !== '')
      .sort((a, b) => b.multiple - a.multiple || (a.category < b.category ? -1 : 1)),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
