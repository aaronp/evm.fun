# Node cursors — short design

Board: t-140 (child of the roadmap t-136; after t-134 and t-132). Demo step g.

## Intent and why

A chain runs on several nodes: the cloud node (the Durable Object) and the user's devices (laptop, phone browsers).
Each should be able to see where the others are, e.g. "phone: block 412, 6 behind, 2 min ago". **Show only** (Aaron,
2026-11-23): nothing acts on a cursor yet.

## Design

- **The cloud node records cursors.** Every block fetch and subscription is a signed request, so the cloud node knows
  the device key. On each fetch it upserts `{address, name, block, hash, seenAt}` with the highest block it delivered
  to that key. Devices may send a name (`x-node-name`, e.g. "phone"); the latest name wins.
- **Kept in the cloud node's own storage**, a `cursors` table beside the chain store — not on chain, so recording a
  position never makes a block.
- **Superseded route (devices design):** `GET /chains/:id/nodes` (members with role, name, block, behind, seenAt; see [devices](2026-11-23-devices-follow-design.md)) replaces `/nodes/latest` below.
- **Served as a view:** `GET /chains/:id/nodes/latest` → `{ head: {block, hash}, nodes: [{address, name, block, hash,
  behind, seenAt}] }`, readable by whoever can read the chain (same rule as `access-controls/latest`).
- **evm.fun:** a deployed chain shows a **Nodes** panel (cloud head + each node's block, behind, last seen), refreshed
  on new heads.
- **Depends on t-132:** a device has a position only once it follows the chain (fetches blocks).

## Done when

- Two device keys following a deployed chain locally show their blocks and last-seen times in the view and the panel;
  a device that stops fetching falls behind as the chain advances; a key without read access gets 403.
- Docs (t-137): what a cursor is and what it isn't (inferred from fetches, not reported by the node).

## Non-goals

- Acting on cursors (pruning, warnings before removing a device); nodes reporting their own position; positions
  between devices without the cloud node.

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **Inferred at the cloud node (chosen)** | Record what each key fetched | No device changes; slightly optimistic (delivered ≠ applied) |
| Self-reported | Each node posts its head | Exact, but devices must report; needed only if we act on cursors |
| On chain | Cursor txs | Every report makes a block; circular |

## Left to the builder

- Whether WebSocket head notices count as delivery (default: only fetched blocks count).
