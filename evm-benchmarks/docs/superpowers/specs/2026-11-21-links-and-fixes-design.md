# Links (chain and persona in the URL) and fix-it actions — design

## Intent

Any page can be shared or bookmarked as a URL that reproduces what you were looking at and as whom; and an error
like "Not enough GBP — you have 0.00." offers a one-click fix that opens the page that fixes it, as the right
persona, and comes back when done.

## Decided with Aaron

- Every page carries `?chain=<registry id>&as=<persona>`; opening a link selects them; switching in the app
  rewrites the address. Existing page params (`base`, `quote`, `venue`, `auto`, `asset`, …) are kept.
- Balance shortfalls offer "Request {amount} {SYM} from {issuer}": the Assets page's Send dialog, acting as the
  token's issuer, prefilled (to = you, amount = the exact shortfall), with `back=<the failing URL>`.
- After the transfer lands, **go back automatically** (A) to the `back` URL — which carries `chain` and `as`, so the
  original persona and page are restored — with a short notice "Received {amount} {SYM} from {issuer}". A running
  walkthrough's ribbon is still on the failing step.

## Details (Claude's calls)

- `as` accepts a label or an address; the app writes the label when it's unique among accounts, else the address.
  Unknown `chain`/`as` → ignored with a notice ("No chain … in this browser"), never a crash.
- Sync is one place (`UrlSync` in the app shell): URL → state when the params change; state → URL (replace, no
  history entry) when the selection changes. Sidebar links drop params; the sync re-adds them.
- Request link: `/assets?chain=&as=<issuer>&asset=<id>&send=<recipient address>&amount=<decimal>&back=<encoded>`.
  The Assets page opens the Send dialog for `as` with those values when `send` is present. Offered only when the
  asset has a known issuer who isn't the acting account and the issuer holds at least the shortfall; otherwise no
  button (the message stays).
- Where: Swap (MakeOfferCard, TakePanel), Trade (OrderForm balance check and the venues' "You hold …" pre-checks),
  Pool (Swap and Add tabs). One shared `<Shortfall>` component renders the message and the button.
- Walkthroughs: a page handler's failure may carry a fix (`{ message, fix: { label, href } }`); the ribbon shows the
  fix button under the step error.
- The notice after returning: stored for one read in sessionStorage and shown once by the app shell.

## Non-goals

- Requesting ETH for gas (no form detects an ETH shortfall today; follow-up card).
- Minting new supply (only transfers from the issuer's balance).
- History/back-button semantics beyond `back=`.

## Approaches considered

| | Approach | Trade-off |
|---|---|---|
| **URL is the source for chain/persona, synced both ways (chosen)** | Links reproduce state; one sync component | Every page URL gets two params |
| Only read params on load | Simpler | Copying a URL later loses the current persona |
| Store a share token in kv | Short links | Not portable across browsers; opaque |

After the fix: auto-return (chosen) vs a "Back to …" button (one more click).
