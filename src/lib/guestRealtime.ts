export type GuestArrivalSocketEventType =
  | "guest_arrived"
  | "guest_expected"
  | "guest_unexpected"
  | "guest_approved"
  | "guest_rejected";

export type GuestArrivalSocketEvent = {
  type: GuestArrivalSocketEventType;
  data: Record<string, unknown>;
};

const GUEST_EVENTS = new Set<GuestArrivalSocketEventType>([
  "guest_arrived",
  "guest_expected",
  "guest_unexpected",
  "guest_approved",
  "guest_rejected",
]);

export function parseGuestArrivalSocketEvent(raw: string): GuestArrivalSocketEvent | null {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const t = parsed.type ?? parsed.event;
    const type =
      typeof t === "string" && GUEST_EVENTS.has(t as GuestArrivalSocketEventType)
        ? (t as GuestArrivalSocketEventType)
        : null;
    if (!type) return null;

    let data: Record<string, unknown> =
      parsed.data != null && typeof parsed.data === "object" && !Array.isArray(parsed.data)
        ? (parsed.data as Record<string, unknown>)
        : {};
    if (
      parsed.payload != null &&
      typeof parsed.payload === "object" &&
      !Array.isArray(parsed.payload)
    ) {
      data = parsed.payload as Record<string, unknown>;
    }
    return { type, data };
  } catch {
    return null;
  }
}

export type GuestRequestRow = {
  id: string;
  /** Opaque guest session id used for call signaling / approve paths. */
  guestId?: string;
  zoneId?: string;
  guestName?: string;
  hid?: string;
  createdAt?: string;
  expectation: "expected" | "unexpected";
  status: "PENDING" | "APPROVED" | "REJECTED" | "ARRIVED";
};

/** Merge realtime fields into an existing dashboard row keyed by matching `id` / request_id. */
export function mergeGuestRealtimeIntoRow(
  prev: GuestRequestRow,
  evt: GuestArrivalSocketEvent | null,
): GuestRequestRow {
  if (!evt) return prev;
  const d = evt.data;
  const evtIdRaw =
    d.request_id ??
    d.permission_request_id ??
    d.guest_id ??
    d.id ??
    d.guest_request_id;
  const evtId =
    typeof evtIdRaw === "string"
      ? evtIdRaw.trim()
      : evtIdRaw != null && evtIdRaw !== ""
        ? String(evtIdRaw).trim()
        : "";
  if (evtId && evtId !== prev.id) return prev;

  let next = { ...prev };
  const name = typeof d.guest_name === "string" ? d.guest_name.trim() : "";
  if (name) next = { ...next, guestName: name };
  if (typeof d.hid === "string") next = { ...next, hid: d.hid.trim() };
  const zone =
    typeof d.zone_id === "string"
      ? d.zone_id.trim()
      : typeof d.zoneId === "string"
        ? d.zoneId.trim()
        : "";
  if (zone) next = { ...next, zoneId: zone };

  if (evt.type === "guest_expected") next = { ...next, expectation: "expected" };
  if (evt.type === "guest_unexpected") next = { ...next, expectation: "unexpected" };

  if (evt.type === "guest_arrived") next = { ...next, status: "ARRIVED" };
  if (evt.type === "guest_approved") next = { ...next, status: "APPROVED" };
  if (evt.type === "guest_rejected") next = { ...next, status: "REJECTED" };

  return next;
}
