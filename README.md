# Zone Weaver Frontend (M2)

React + Tailwind UI for the Zone Weaver platform.

## Run locally

1. Install dependencies
   ```bash
   npm install
   ```
2. Start the development server
   ```bash
   npm run dev
   ```
3. Open the app in the browser
   - http://localhost:5173

## Backend integration

The frontend is configured to connect to the Zone Weaver backend at:

- `https://hex-zone-server.onrender.com/`

You can also override the API base URL using the environment variable:

- `VITE_API_BASE_URL`

### Guest session (approved anonymous guests)

**Backend handoff:** copy or share **`docs/BACKEND_ACCESS_ZONE_FULL_CONTRACT.md`** with the API team — it summarizes Access Zone messaging (PERMISSION / CHAT), guest JWT routes, **`GET /api/access/guest-requests`**, **`GET .../peers`**, and `POST /messages` with **`guest_id`**, aligned with the Access Zone propagation PDF set.

Coordinate your API release: extended `GET` access session poll (`APPROVED` may include `exchange_code` / `exchange_expires_at`), `POST /api/access/guest-session`, and authenticated `/api/guest/*` (`/me`, **`/zones/{id}/peers`** (critical for guest Messaging), `/messages`, optional `/zones/{id}/dashboard`). This client does not pin a server semver.

When the backend implements the guest contract (session poll may return `exchange_code` when status is `APPROVED`), the client exchanges that code at `POST /api/access/guest-session`, stores the returned JWT in **session storage** under `zoneweaver_guest_access_token`, and uses it only for `/api/guest/*` routes via a dedicated axios instance (never mixed with the member `zoneweaver_token`).

Configure paths if your router differs (see `.env.example`):

- `VITE_GUEST_SESSION_EXCHANGE_URL` (default `/api/access/guest-session`)
- `VITE_GUEST_API_BASE_PATH` (default `/api/guest`)

Guest UI routes: `/guest/dashboard`, `/guest/messages`. Until the backend ships these endpoints, exchange or guest calls may 404; the UI surfaces errors where relevant.

Member **Messages** compose for **PERMISSION** and **CHAT** uses the guest list from `GET` guest-requests for the zone and sends `guest_id` on `POST /messages` (not `receiver_id`). **PRIVATE** still uses owner `receiver_id`. Align field names with your server if needed.

### Guest arrival messages (admin)

Administrators can edit zone-level copy for the guest access flow at **`/guest-arrival-messages`**. The UI calls the Access Zone HTTP API using the same **`VITE_API_BASE_URL`** and **member JWT** (`Authorization: Bearer …` from login) as other `/api/access/...` routes.

- **GET** `/api/access/zones/{zone_id}/guest-arrival-messages` — load current overrides and server defaults.
- **PATCH** (default) or **PUT** `/api/access/zones/{zone_id}/guest-arrival-messages` — save; set `VITE_GUEST_ARRIVAL_MESSAGES_SAVE_METHOD=put` if your backend only supports PUT.

Optional overrides:

- **`VITE_GUEST_ARRIVAL_MESSAGES_PATH_TEMPLATE`** — e.g. `/api/access/zones/{zone_id}/guest-arrival-messages` (placeholders `{zone_id}` / `{zoneId}` are URL-encoded).

**Auth:** same as other zone admin tools (e.g. Guest QR): the signed-in user must be an **administrator** for the zone; the backend should enforce zone scope on its side (return **403** if the token cannot manage that zone). Guest apps are unchanged; they keep consuming `message` from the existing permission and poll APIs.

## Testing

Run unit tests with:

```bash
npm test
```

## Project structure

- `src/components` — reusable UI pieces
- `src/pages` — application screens
- `src/hooks` — auth and API helpers
- `src/lib` — API client and H3 utilities

## Notes

- Dark teal theme with hex-style UI accents
- H3 grid and polygon zone builder powered by `h3-js` and `react-leaflet`
- JWT login stored in `localStorage`

## Collaboration

This project demonstrates collaborative development using Git.