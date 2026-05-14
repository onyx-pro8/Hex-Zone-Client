# Manual testing: PERMISSION visibility & inbox (2026)

## Member inbox (`/messages`)

1. Sign in as a member whose JWT `sub` maps to `owner_id`. Confirm `GET /messages?owner_id=…&skip=0&limit=100` hydrates the page (poll ~8s + WebSocket debounced refetch on `NEW_MESSAGE`, `PERMISSION_MESSAGE`, `NEW_GEO_MESSAGE`, `unexpected_guest`, `guest_is_here`).
2. Confirm the message list is a **single panel**, **newest first** by `created_at` (Access PERMISSION/CHAT and Alarm/Alert types together). PERMISSION rows still show **Zone alert** / **Private** badges when `permission_visibility` is set.
3. Seed or wait for a PERMISSION row with `permission_visibility: "zone_pending_broadcast"`: **Zone alert** badge and amber row styling; tooltip “Unscheduled guest waiting for approval” (order follows date, not pinned above newer rows).
4. Seed a row with `permission_visibility: "direct"`: **Private** badge + lock; tooltip notes other staff may not see the same row.
5. PERMISSION with `guest_id: null` (when backend sends it): detail panel still opens; detail shows `guest_id null` when present on the normalized model.
6. Force a `401` on `GET /messages`: error text should include **Please sign in again.** (structured `{ status: "error", message, error }` uses `message` / nested `error.message` when present).

## Guest thread (`/guest/...` messages UI)

1. With a guest Bearer, open a zone + peer thread. PERMISSION lines show body text only; optional `permission_visibility` from top-level or `raw_payload` shows **Zone alert** / **Private** consistent with member rules.

## Walk-in guest (no inbox dependency)

1. Arrival `POST /api/access/permission` → read `data.status` (EXPECTED vs UNEXPECTED); poll `GET /api/access/session/{guest_id}?zone_id=…` until APPROVED or REJECTED. Do not use member PERMISSION list as source of truth for guest waiting copy.

## Regression

- After backend deploy, fewer PERMISSION rows in the merged feed is expected; UI must not hide PERMISSION client-side beyond normal filters (type/zone/search).
