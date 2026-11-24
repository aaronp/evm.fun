# Invite a device: wizard, join link, QR — short design

Board: t-145 (child of t-112; builds on t-133 device invites and plan 18's Devices panel). Agreed with Aaron, 2026-11-24.

## Intent

Adding a device should feel like a guided step, not a form: make an access code, then get something to open on the
other device. The owner chooses between sending the link and code separately (safer if the link leaks) or one link
that carries the code (one tap). A QR code makes "open this on another device" a phone-camera scan.

## Design

- **Invite a device** in the Devices panel (admin only) becomes a 2-step wizard:
  1. **Create an access code:** code (generated, editable), valid for, uses (default 1), role (default reader) —
     today's fields; the multi-use writer warning (R55) stays. Checkbox **Create a single join link (includes the
     code)**, off by default; when ticked a warning sits beside it: "Anyone with this link can join as <role> until
     it's used up or expires. Share it only somewhere private." **Next** submits the invite tx (as today).
  2. **Open this on another device:** a QR code of the link, the link, **Copy link**. Unticked: the link prefills
     node and chain only, and the code is shown separately with **Copy code** and "send this separately". Ticked: the
     one link, no separate code. The code is shown once; **Invite another** restarts, **Done** closes.
- **Join link:** `#/cloud/join?node=…&chain=…[&code=…]`. The code is after the `#`, so it never reaches a server.
- **Joining device:** the Join form also prefills `code`; once read, the code is removed from the address bar
  (history entry replaced). The user still picks the account and presses **Join** — opening a link never joins.
  Links without a code work as before.
- **QR:** `uqr` 0.1.3 (MIT, no dependencies) renders an SVG; drawn dark on light in every theme (scannable), from two
  theme-invariant tokens covered by the contrast test.
- Spec change: the devices design's "never a code in a URL" becomes "a code is in a link only when the owner chooses
  it"; risk R58 (a leaked single join link) records the trade-off.

## Non-goals

QR for deploy codes; scanning QR codes inside evm.fun; codes that expire when viewed (uses + expiry already bound a
code, and opening a link never spends it).

## Approaches

| | Approach | Trade-off |
|---|---|---|
| **Both, chosen per invite (chosen)** | Checkbox picks single link or link + code | Owner decides per invite; one extra control and warning |
| Code always in the link | One tap | A leaked link is a working invite until used or expired |
| Code never in the link (today) | Link + code sent separately | Two things to send; safest |

## Left to the builder

Wizard layout and copy beyond the above; QR size; the code's accepted length in a link (trimmed, 1–200 chars).
