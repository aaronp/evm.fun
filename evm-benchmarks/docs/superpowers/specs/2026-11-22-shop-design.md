# Shop · Launch Site — design

Board: t-104 "Marketplace app: Launch Site". No mockup: designed from the conversation.

## Intent

A friendly, practical app built from the playground's pieces, to show how they compose: a **chain** is the
source of truth for data and state, **contracts** are the logic (the ledger / system of record), and every
thing sold or paid with — inventory, stablecoins, other digital assets — is just an asset contract. Someone who
knows nothing about chains clicks **Launch Site**, names it, adds inventory ("Chair", 10), maybe launches a
currency, and lists items for a price or for a swap ("1 chair for 2 sweeping-hours"). A buyer opens the site and
buys. Later contracts (governance / KYC allow-lists, t-110) plug into the same structure.

The Shop is friendly on top but makes the composition visible: every screen has an **Under the hood** panel.

## Decided with Aaron

- **A separate, simple front end** (not a playground section): its own layout, no chain picker / File menu /
  developer pages.
- **One storefront per site (A).** A link opens one shop. Each site defaults to a **new chain**; "Advanced" picks
  an existing chain. A browsable marketplace of many shops is later.
- **Code: a `/shop` area inside the existing web app (1)** with its own layout, reusing accounts, the chain
  registry, workspace files, walkthroughs, the order-book package and fix-it actions.
- **Site details on chain, in `Site.sol` (a).** The chain is the source of truth for the site's name, owner,
  inventory and currencies.

## Claude's calls (correct any)

- **One trading mechanism:** the existing on-chain `OrderBook.sol`. Listing 10 chairs at 50 USD = a sell order on
  the CHAIR/USD market; buying 2 fills part of it. "1 chair for 2 sweeping-hours" = the CHAIR/SWEEP market. Price
  and swap are the same thing underneath (a teaching point).
- **Inventory is a whole-unit asset** (`AssetToken`, 0 decimals): chairs, nights, seats. One-of-a-kind items (NFT
  style) are later.
- **Currencies are ordinary assets** (`AssetToken`, 2 decimals by default). "Stablecoin" is just a name.
- **Personas:** the site's owner and buyers, switched with the profile menu / `?as=` as today. A buyer gets a
  currency by "Request {amount} {SYM} from {issuer}" (existing fix-it).

## Contract: `Site.sol` (one per site)

```solidity
constructor(string name_, address owner_)
string public name; address public owner;
enum Kind { Inventory, Currency }
struct Entry { address asset; Kind kind; string description; }
function entries() view returns (Entry[] memory)
function add(address asset, Kind kind, string description)   // owner only; asset must be a contract; no duplicates
function setDescription(uint256 index, string description)     // owner only
address public market;                                         // the OrderBook it sells through
function setMarket(address orderBook)                          // owner only
event Added(address indexed asset, Kind kind); event MarketSet(address market);
error NotOwner(); error Duplicate(address asset); error BadAsset();
```

Listings are not stored in `Site.sol`: they are the owner's resting sell orders on `market` for the site's
inventory assets (read from the order book). No duplicate source of truth.

## Screens (`#/shop/…`, own layout, phone-first)

- **Home** `/shop`: "Launch Site" (name field; Advanced: existing chain) and "Your sites" (sites in this browser
  where you are the owner; found from `Site` contract records).
- **Launch** (one click): creates the chain (prefunding the owner), deploys `Site.sol` and `OrderBook.sol`,
  registers the market — progress shown as plain steps ("Creating your ledger…", "Writing your shop's
  rules…"), each with its Under-the-hood line.
- **Owner dashboard** `/shop/:site/manage` (owner only):
  - **Inventory:** "Add item" (name, quantity, description) → launches an `AssetToken` (0 dp, supply to owner)
    and `Site.add(Inventory)`.
  - **Currencies:** "Launch currency" (name, symbol, supply) → `AssetToken` + `Site.add(Currency)`; or "Accept
    an existing asset" (any asset on the chain).
  - **Listings:** per item, "List {n} for {price} {currency}" or "for {k} {other item}" → approve + sell order;
    shows open listings with "Delist" (cancel).
  - **Sales:** recent fills (from the order book's trades).
- **Storefront** `/shop/:site` (anyone): site name, items with "{n} left" and each listing's price(s), **Buy**
  (quantity) → approve + buy order that takes the listing; shortfall → "Request … from …".
- **My purchases** on the storefront for the acting account (balances of the site's inventory).
- **Under the hood** (collapsible, every screen): the chain (name, head), `Site.sol`, `OrderBook.sol`, each asset
  contract, and the last transactions — each linking to the playground page (Assets, Trade, Explorer, tx
  report). A "Open in playground" link per screen.
- The site link is `#/shop/<chainId>/<siteAddress>` (plus `?as=`).

## Walkthrough

`shop-chairs` (headless + ribbon, Install from Get started): Alice launches "Alice's Furniture", adds 10 Chairs,
launches a currency USD, lists 8 chairs at 50 USD; Bob requests 100 USD from Alice, buys 2 chairs; checks Bob
holds 2 CHAIR, Alice +100 USD, 6 listed. New step types for the Shop actions; the ribbon drives the Shop pages.

## Non-goals

- A marketplace across many shops; search; images/uploads (text descriptions only); unique (NFT) items;
  governance/KYC (t-110); a client/REST API (t-103, on hold); off-chain venue for shops; refunds/escrow beyond
  the order book's atomic settlement; changing the playground's pages.

## Anti-goals

- Hiding the machinery: every Shop action must be traceable to its chain, contract and transaction.
- A second source of truth: site data in browser storage that the chain doesn't hold.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **1 (chosen)** | `/shop` area in the web app, own layout | Least code; reuses state and pages; two layouts in one build |
| 2 | Separate `packages/shop` app | Cleaner split, but app state must first be extracted from the web app |
| **a (chosen)** | Site details on chain (`Site.sol`) | Chain is the source of truth; governance plugs in here later; ~half a page of Solidity |
| b | Site details in browser storage | Less code, but the site's identity lives off chain |

## Constraints

As earlier steps: tokens only, three themes, contrast tests, phone width; real chain data only; capture data at
origin and flag O(n) reads (sites from records, sales from trade logs) as risks with backlog cards; never commit
`design/`; commit with `git commit --only`; docs in `evm-benchmarks/docs/` (board t-104, a new ADR, risks).

## Settled after the builder check (Claude's calls)

1. **Fixes stay in the Shop.** "Request {amount} {SYM} from {issuer}" and "Request ETH" open a small confirm
   dialog inside the Shop layout (reusing the playground's Send logic), never the playground's Assets page.
   **Launch prefunds every account in this browser** with ETH (as the playground's New chain dialog does), so
   buyers rarely need gas.
2. **Requests are transfers** from the issuer, as today. The walkthrough's checks are measured after Bob's
   request: Bob holds 2 CHAIR and 0 USD, Alice's USD rises by 100 from after the request, 6 chairs stay listed.
3. **Swap listings are "1 {item} for k {asset}"** (whole numbers): inventory has 0 decimals, so the order book's
   price is k whole units of the payment asset. The payment asset is any asset the site has added — a currency or
   another item — and any account can launch one (e.g. Bob launches "Sweeping-hour" for his own labour, and the
   owner adds it as accepted). Arbitrary ratios ("2 for 3") are later.
4. **Each site deploys its own `OrderBook`**, recorded as `Site.market`, so playground Trade orders never mix in.
   The storefront shows **every** sell order on the site's market for its items, labelled by seller (the owner's
   as "Alice's Furniture", others as "resold by bob"); Buy fills the best price, as the order book does.
   Owner-only selling is a governance feature (t-110).
5. **Same browser.** Sites, chains and buyers live in this browser (buyers are personas via `?as=`). Sharing a
   shop with someone else is a workspace file (File → Save / Open). A link that works for another person is the
   device-local / deployed-chain question (t-111), not this step.

## Size

**L** — about one of our usual plans, 6 tasks: `Site.sol` (S); a small shop package (Site reads, listings and
sales from the order book, purchases) (M); Shop layout + Home + Launch (M); owner dashboard (M); storefront, Buy
and in-Shop fixes (M); the `shop-chairs` walkthrough with Install, docs, ADR and risks (M).

## Left to the builder

- Exact layout and copy within the description; the Shop's look (calmer than the playground, same tokens).
- Whether a small UI-free `@evmb/shop` package (Site ABI, reads, listing helpers) or `src/shop/` in the web app.
