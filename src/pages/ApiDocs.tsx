import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { dispatchGeoPropagationInbox } from "../lib/inboxRealtime";
import type { MessageFeaturePropagationResponse } from "../services/api/messageFeature";

const API_BASE =
  import.meta.env.VITE_API_BASE_URL || "https://safe-zone-patrol-server.onrender.com";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

type ParamIn = "path" | "query" | "body";

interface ParamDef {
  name: string;
  in: ParamIn;
  type?: "string" | "number";
  required?: boolean;
  placeholder?: string;
}

interface EndpointSpec {
  id: string;
  method: HttpMethod;
  /** Path starting with /; may include {param} segments */
  path: string;
  group: "core" | "contract";
  description: string;
  params: ParamDef[];
  /** When true, show one JSON body textarea (uses param name "body" in values) */
  bodyJson?: boolean;
  /** Skip Authorization header (login/register/public utilities) */
  public?: boolean;
}

const ENDPOINTS: EndpointSpec[] = [
  { id: "root-info", method: "GET", path: "/", group: "core", description: "Service info and docs links.", public: true, params: [] },
  { id: "health-check", method: "GET", path: "/health", group: "core", description: "Health check endpoint.", public: true, params: [] },
  {
    id: "utils-registration-code",
    method: "GET",
    path: "/utils/registration-code",
    group: "core",
    description:
      "Public: server issues a registration code for the create-account flow (frontend loads on /register). Fallback: GET /owners/registration-code.",
    public: true,
    params: [],
  },
  {
    id: "owners-register",
    method: "POST",
    path: "/owners/register",
    group: "core",
    description: "Register owner/user account.",
    public: true,
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "owners-login",
    method: "POST",
    path: "/owners/login",
    group: "core",
    description: "Core owner login and JWT issuance.",
    public: true,
    params: [
      { name: "email", in: "body", required: true, placeholder: "owner@example.com" },
      { name: "password", in: "body", required: true, placeholder: "password" },
    ],
  },
  { id: "owners-me", method: "GET", path: "/owners/me", group: "core", description: "Get current authenticated owner profile.", params: [] },
  {
    id: "owners-list",
    method: "GET",
    path: "/owners/",
    group: "core",
    description: "List caller-visible owners.",
    params: [
      { name: "skip", in: "query", type: "number", placeholder: "0" },
      { name: "limit", in: "query", type: "number", placeholder: "100" },
    ],
  },
  {
    id: "owners-get-by-id",
    method: "GET",
    path: "/owners/{owner_id}",
    group: "core",
    description: "Get caller-visible owner by id.",
    params: [{ name: "owner_id", in: "path", required: true, placeholder: "owner id" }],
  },
  {
    id: "owners-patch",
    method: "PATCH",
    path: "/owners/{owner_id}",
    group: "core",
    description: "Update owner profile (self).",
    bodyJson: true,
    params: [
      { name: "owner_id", in: "path", required: true, placeholder: "owner id" },
      { name: "body", in: "body", required: true, placeholder: "JSON body" },
    ],
  },
  {
    id: "owners-delete",
    method: "DELETE",
    path: "/owners/{owner_id}",
    group: "core",
    description: "Delete owner profile (self).",
    params: [{ name: "owner_id", in: "path", required: true, placeholder: "owner id" }],
  },
  { id: "devices-list", method: "GET", path: "/devices/", group: "core", description: "List caller-visible devices.", params: [] },
  {
    id: "devices-create",
    method: "POST",
    path: "/devices/",
    group: "core",
    description: "Create device.",
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "devices-get",
    method: "GET",
    path: "/devices/{device_id}",
    group: "core",
    description: "Get device by numeric id.",
    params: [{ name: "device_id", in: "path", required: true, placeholder: "device id" }],
  },
  {
    id: "devices-get-by-hid",
    method: "GET",
    path: "/devices/network/hid/{hid}",
    group: "core",
    description: "Get device by hardware id (HID).",
    params: [{ name: "hid", in: "path", required: true, placeholder: "DEV-A1B2C3" }],
  },
  {
    id: "devices-patch",
    method: "PATCH",
    path: "/devices/{device_id}",
    group: "core",
    description: "Update device settings.",
    bodyJson: true,
    params: [
      { name: "device_id", in: "path", required: true, placeholder: "device id" },
      { name: "body", in: "body", required: true, placeholder: "JSON body" },
    ],
  },
  {
    id: "devices-location",
    method: "POST",
    path: "/devices/{device_id}/location",
    group: "core",
    description: "Update location and H3 cell for device.",
    params: [
      { name: "device_id", in: "path", required: true, placeholder: "device id" },
      { name: "latitude", in: "body", type: "number", required: true, placeholder: "47.6205" },
      { name: "longitude", in: "body", type: "number", required: true, placeholder: "-122.3493" },
      { name: "address", in: "body", placeholder: "optional address" },
    ],
  },
  {
    id: "devices-heartbeat",
    method: "POST",
    path: "/devices/{device_id}/heartbeat",
    group: "core",
    description: "Update online/last_seen presence.",
    params: [{ name: "device_id", in: "path", required: true, placeholder: "device id" }],
  },
  {
    id: "devices-delete",
    method: "DELETE",
    path: "/devices/{device_id}",
    group: "core",
    description: "Delete device.",
    params: [{ name: "device_id", in: "path", required: true, placeholder: "device id" }],
  },
  {
    id: "zones-create",
    method: "POST",
    path: "/zones/",
    group: "core",
    description: "Create zone.",
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "zones-list",
    method: "GET",
    path: "/zones/",
    group: "core",
    description: "List zones (supports owner_id, zone_id, skip, limit).",
    params: [
      { name: "owner_id", in: "query", placeholder: "42" },
      { name: "zone_id", in: "query", placeholder: "ZONE-7A29" },
      { name: "skip", in: "query", type: "number", placeholder: "0" },
      { name: "limit", in: "query", type: "number", placeholder: "100" },
    ],
  },
  {
    id: "zones-by-zone-id",
    method: "GET",
    path: "/zones/{zone_id}",
    group: "core",
    description: "List zones by shared zone_id visible to caller.",
    params: [{ name: "zone_id", in: "path", required: true, placeholder: "ZONE-7A29" }],
  },
  {
    id: "zones-patch",
    method: "PATCH",
    path: "/zones/{zone_id}",
    group: "core",
    description: "Update zone.",
    bodyJson: true,
    params: [
      { name: "zone_id", in: "path", required: true, placeholder: "ZONE-7A29" },
      { name: "body", in: "body", required: true, placeholder: "JSON body" },
    ],
  },
  {
    id: "zones-delete",
    method: "DELETE",
    path: "/zones/{zone_id}",
    group: "core",
    description: "Delete zone.",
    params: [{ name: "zone_id", in: "path", required: true, placeholder: "ZONE-7A29" }],
  },
  {
    id: "messages-create-core",
    method: "POST",
    path: "/messages/",
    group: "core",
    description: "Create zone message (public/private).",
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "messages-list-core",
    method: "GET",
    path: "/messages",
    group: "core",
    description: "Canonical messages list endpoint.",
    params: [
      { name: "owner_id", in: "query", required: true, placeholder: "42" },
      { name: "other_owner_id", in: "query", placeholder: "84" },
      { name: "skip", in: "query", type: "number", placeholder: "0" },
      { name: "limit", in: "query", type: "number", placeholder: "100" },
    ],
  },
  {
    id: "messages-list-core-compat",
    method: "GET",
    path: "/messages/",
    group: "core",
    description: "Backward-compatible alias for /messages.",
    params: [
      { name: "owner_id", in: "query", required: true, placeholder: "42" },
      { name: "other_owner_id", in: "query", placeholder: "84" },
      { name: "skip", in: "query", type: "number", placeholder: "0" },
      { name: "limit", in: "query", type: "number", placeholder: "100" },
    ],
  },
  {
    id: "message-feature-members-location",
    method: "POST",
    path: "/message-feature/members/location",
    group: "core",
    description:
      "Refresh dynamic zone memberships for the current JWT member before geo messaging.",
    params: [
      { name: "latitude", in: "body", type: "number", required: true, placeholder: "34.0522" },
      { name: "longitude", in: "body", type: "number", required: true, placeholder: "-118.2437" },
    ],
  },
  {
    id: "message-feature-propagate",
    method: "POST",
    path: "/message-feature/messages/propagate",
    group: "core",
    description: "Send geo-aware message propagation with strict delivery accounting.",
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "message-feature-ingest",
    method: "POST",
    path: "/message-feature/messages/ingest",
    group: "core",
    description:
      "Ingest message payload using x-api-key auth (set custom header in curl editor).",
    bodyJson: true,
    public: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "message-feature-messages-new",
    method: "GET",
    path: "/message-feature/messages/new",
    group: "core",
    description: "Pull new message-feature messages by ISO cursor.",
    params: [{ name: "since", in: "query", required: true, placeholder: "2026-01-01T00:00:00Z" }],
  },
  {
    id: "message-feature-blocks-create",
    method: "POST",
    path: "/message-feature/blocks",
    group: "core",
    description: "Create access block by owner id or message type.",
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "message-feature-blocks-list",
    method: "GET",
    path: "/message-feature/blocks",
    group: "core",
    description: "List blocks visible to the current member context.",
    params: [],
  },
  {
    id: "message-feature-blocks-delete",
    method: "DELETE",
    path: "/message-feature/blocks/{block_id}",
    group: "core",
    description: "Delete a block entry by block id.",
    params: [{ name: "block_id", in: "path", required: true, placeholder: "block-id" }],
  },
  {
    id: "message-feature-access-schedules-create",
    method: "POST",
    path: "/message-feature/access/schedules",
    group: "core",
    description: "Create expected-guest schedule and member-assist policy.",
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "message-feature-access-schedules-list",
    method: "GET",
    path: "/message-feature/access/schedules",
    group: "core",
    description: "List access schedules by zone_id query.",
    params: [{ name: "zone_id", in: "query", required: true, placeholder: "ZONE-7A29" }],
  },
  {
    id: "message-feature-access-permission",
    method: "POST",
    path: "/message-feature/access/permission",
    group: "core",
    description: "Permission decision endpoint; payload type must be PERMISSION.",
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "h3-convert",
    method: "POST",
    path: "/utils/h3/convert",
    group: "core",
    description: "Convert lat/lng to H3.",
    params: [
      { name: "latitude", in: "body", type: "number", required: true, placeholder: "34.0522" },
      { name: "longitude", in: "body", type: "number", required: true, placeholder: "-118.2437" },
      { name: "resolution", in: "body", type: "number", placeholder: "13" },
    ],
  },
  {
    id: "qr-generate",
    method: "POST",
    path: "/utils/qr/generate",
    group: "core",
    description: "Generate member-invite QR token (Private, Private+, Exclusive, Enhanced+ administrators).",
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "qr-join",
    method: "POST",
    path: "/utils/qr/join",
    group: "core",
    description: "Register via QR invite token.",
    public: true,
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "contract-login",
    method: "POST",
    path: "/login",
    group: "contract",
    description: "Contract login endpoint.",
    public: true,
    params: [
      { name: "email", in: "body", required: true, placeholder: "owner@example.com" },
      { name: "password", in: "body", required: true, placeholder: "password" },
    ],
  },
  {
    id: "contract-register",
    method: "POST",
    path: "/register",
    group: "contract",
    description: "Contract registration endpoint.",
    public: true,
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  { id: "contract-me", method: "GET", path: "/me", group: "contract", description: "Contract owner profile endpoint.", params: [] },
  { id: "contract-zones-list", method: "GET", path: "/zones", group: "contract", description: "Contract zones list endpoint.", params: [] },
  {
    id: "contract-zones-create",
    method: "POST",
    path: "/zones",
    group: "contract",
    description: "Contract create zone endpoint.",
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "contract-zones-update",
    method: "PUT",
    path: "/zones/{zone_id}",
    group: "contract",
    description: "Contract update zone endpoint.",
    bodyJson: true,
    params: [
      { name: "zone_id", in: "path", required: true, placeholder: "ZONE-7A29" },
      { name: "body", in: "body", required: true, placeholder: "JSON body" },
    ],
  },
  {
    id: "contract-zones-delete",
    method: "DELETE",
    path: "/zones/{zone_id}",
    group: "contract",
    description: "Contract delete zone endpoint.",
    params: [{ name: "zone_id", in: "path", required: true, placeholder: "ZONE-7A29" }],
  },
  {
    id: "contract-messages-create",
    method: "POST",
    path: "/messages",
    group: "contract",
    description: "Create contract message (legacy/chat payload).",
    bodyJson: true,
    params: [{ name: "body", in: "body", required: true, placeholder: "JSON body" }],
  },
  {
    id: "contract-messages-new",
    method: "GET",
    path: "/messages/new",
    group: "contract",
    description: "Get new messages since an ISO datetime cursor.",
    params: [{ name: "since", in: "query", required: true, placeholder: "2026-01-01T00:00:00Z" }],
  },
  { id: "contract-members-list", method: "GET", path: "/members", group: "contract", description: "List visible members.", params: [] },
  {
    id: "contract-members-location",
    method: "POST",
    path: "/members/location",
    group: "contract",
    description: "Upsert current member location.",
    params: [
      { name: "latitude", in: "body", type: "number", required: true, placeholder: "34.0522" },
      { name: "longitude", in: "body", type: "number", required: true, placeholder: "-118.2437" },
    ],
  },
  {
    id: "contract-devices-push-token",
    method: "POST",
    path: "/devices/push-token",
    group: "contract",
    description: "Register push token.",
    params: [
      { name: "token", in: "body", required: true, placeholder: "<push-token>" },
      { name: "platform", in: "body", required: true, placeholder: "FCM" },
    ],
  },
];

const DEFAULT_JSON: Record<string, string> = {
  "owners-register": `{
  "email": "admin@example.com",
  "zone_id": "ZONE-7A29",
  "first_name": "Avery",
  "last_name": "Stone",
  "account_type": "private",
  "role": "administrator",
  "address": "101 Main St, Denver, CO, USA",
  "password": "strong-password-123",
  "registration_code": "FREE"
}`,
  "owners-patch": `{
  "first_name": "Alex",
  "active": true
}`,
  "devices-create": `{
  "hid": "DEV-A1B2C3",
  "name": "Front Gate Tracker",
  "address": "123 Main St, Anytown",
  "latitude": 47.6205,
  "longitude": -122.3493,
  "propagate_enabled": true,
  "propagate_radius_km": 2.5,
  "enable_notification": true,
  "alert_threshold_meters": 150.0,
  "update_interval_seconds": 120
}`,
  "devices-patch": `{
  "name": "Front Gate Tracker v2",
  "propagate_enabled": false
}`,
  "zones-create": `{
  "zone_id": "ZONE-7A29",
  "name": "Main Zone",
  "zone_type": "geofence",
  "h3_cells": ["8928308280fffff"]
}`,
  "zones-patch": `{
  "name": "Main Zone (updated)",
  "h3_cells": ["8928308280fffff", "8928308280bffff"]
}`,
  "messages-create-core": `{
  "owner_id": 42,
  "zone_id": "ZONE-7A29",
  "message": "Perimeter updated",
  "visibility": "public"
}`,
  "message-feature-propagate": `{
  "type": "PANIC",
  "hid": "DEV-A1B2C3",
  "tt": "2026-01-01T00:00:00Z",
  "msg": {
    "text": "Assistance needed"
  },
  "position": {
    "latitude": 34.0522,
    "longitude": -118.2437
  },
  "city": "Los Angeles",
  "province": "CA",
  "country": "US"
}`,
  "message-feature-ingest": `{
  "type": "CHAT",
  "hid": "DEV-A1B2C3",
  "msg": {
    "text": "Ingested message"
  },
  "position": {
    "latitude": 34.0522,
    "longitude": -118.2437
  }
}`,
  "message-feature-blocks-create": `{
  "blocked_message_type": "PANIC"
}`,
  "message-feature-access-schedules-create": `{
  "zone_id": "ZONE-7A29",
  "guest_name": "Jordan Rivera",
  "starts_at": "2026-01-01T00:00:00Z",
  "ends_at": "2026-01-01T04:00:00Z",
  "notify_member_assist": true
}`,
  "message-feature-access-permission": `{
  "type": "PERMISSION",
  "hid": "DEV-A1B2C3",
  "msg": {
    "guest_name": "Jordan Rivera"
  },
  "position": {
    "latitude": 34.0522,
    "longitude": -118.2437
  }
}`,
  "h3-convert": `{
  "latitude": 34.0522,
  "longitude": -118.2437,
  "resolution": 13
}`,
  "qr-generate": `{
  "zone_id": "ZONE-7A29",
  "expires_in_seconds": 900
}`,
  "qr-join": `{
  "token": "<invite-token>",
  "email": "new.user@example.com",
  "password": "strong-password-123",
  "first_name": "Sam",
  "last_name": "Rivera"
}`,
  "contract-register": `{
  "name": "Alex Chen",
  "email": "alex@geozone.io",
  "password": "strong-password-123",
  "accountType": "PRIVATE",
  "registrationType": "ADMINISTRATOR",
  "zoneId": "ZONE-7A29",
  "address": "101 Main St, Denver, CO, USA",
  "registrationCode": "FREE"
}`,
  "contract-zones-create": `{
  "zone_id": "ZONE-7A29",
  "name": "Contract Zone",
  "zone_type": "geofence",
  "h3_cells": ["8928308280fffff"]
}`,
  "contract-zones-update": `{
  "name": "Contract Zone (updated)",
  "h3_cells": ["8928308280fffff", "8928308280bffff"]
}`,
  "contract-messages-create": `{
  "zone_id": "ZONE-7A29",
  "message": "Hello from contract route",
  "visibility": "public"
}`,
};

function methodPillClass(method: HttpMethod) {
  switch (method) {
    case "GET":
      return "bg-[#EDF3FB] text-[#2F80ED] ring-[#2F80ED]/30";
    case "POST":
      return "bg-[#E3F4E8] text-[#2FA24A] ring-[#2FA24A]/30";
    case "PUT":
    case "PATCH":
      return "bg-[#FBEFD8] text-[#E0992A] ring-[#E0992A]/30";
    case "DELETE":
      return "bg-[#FCE7EA] text-[#E23B4E] ring-[#E23B4E]/30";
    default:
      return "bg-[#EDF3FB] text-[#8694AC] ring-[#DCE6F2]";
  }
}

function buildResolvedPath(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => {
    const v = values[key]?.trim();
    return v != null && v !== "" ? encodeURIComponent(v) : `{${key}}`;
  });
}

function buildUrl(
  path: string,
  values: Record<string, string>,
  ep: EndpointSpec,
): string {
  const resolved = buildResolvedPath(path, values);
  const u = new URL(API_BASE.replace(/\/$/, "") + resolved);
  for (const p of ep.params) {
    if (p.in !== "query") continue;
    const v = values[p.name]?.trim();
    if (v === undefined || v === "") continue;
    u.searchParams.set(p.name, v);
  }
  return u.toString();
}

function buildBodyObject(
  ep: EndpointSpec,
  values: Record<string, string>,
): Record<string, unknown> | null {
  if (ep.bodyJson) {
    const raw = values.body?.trim();
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  const bodyParams = ep.params.filter((p) => p.in === "body");
  if (bodyParams.length === 0) return null;
  const o: Record<string, unknown> = {};
  for (const p of bodyParams) {
    const v = values[p.name]?.trim();
    if (v === undefined || v === "") continue;
    if (p.type === "number") {
      const n = Number(v);
      if (!Number.isNaN(n)) o[p.name] = n;
    } else {
      o[p.name] = v;
    }
  }
  return Object.keys(o).length ? o : null;
}

export default function ApiDocs() {
  const { user, token } = useAuth();
  const [selectedId, setSelectedId] = useState(ENDPOINTS[0]?.id ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [responseText, setResponseText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"curl" | "zone" | null>(null);
  const [curlDraft, setCurlDraft] = useState("");
  const curlEditedRef = useRef(false);
  const prevEndpointRef = useRef(selectedId);

  const selected = useMemo(
    () => ENDPOINTS.find((e) => e.id === selectedId) ?? ENDPOINTS[0],
    [selectedId],
  );

  useEffect(() => {
    if (!selected) return;
    setValues((prev) => {
      const next = { ...prev };
      if (selected.bodyJson) {
        next.body = next.body ?? DEFAULT_JSON[selected.id] ?? "{}";
      }
      for (const p of selected.params) {
        if (p.in === "body" && p.name !== "body" && next[p.name] === undefined) {
          next[p.name] = "";
        }
      }
      return next;
    });
    setResponseText("");
    setError(null);
  }, [selected?.id]);

  const generatedCurl = useMemo(() => {
    if (!selected) return "";
    const url = buildUrl(selected.path, values, selected);
    const lines: string[] = [`curl -X ${selected.method} "${url}" \\`];
    if (!selected.public && token) {
      lines.push(`  -H "Authorization: Bearer <token>" \\`);
    }
    const body = buildBodyObject(selected, values);
    const hasBody = body && selected.method !== "GET";
    if (hasBody) {
      lines.push(`  -H "Content-Type: application/json" \\`);
      const escaped = JSON.stringify(body)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"');
      lines.push(`  -d "${escaped}"`);
    } else {
      lines.push(`  -H "Content-Type: application/json"`);
    }
    return lines.join("\n");
  }, [selected, values, token]);

  useEffect(() => {
    const endpointChanged = prevEndpointRef.current !== selectedId;
    prevEndpointRef.current = selectedId;
    if (endpointChanged) {
      curlEditedRef.current = false;
      setCurlDraft(generatedCurl);
      return;
    }
    if (!curlEditedRef.current) {
      setCurlDraft(generatedCurl);
    }
  }, [selectedId, generatedCurl]);

  const zoneLabel = useMemo(() => {
    if (user?.id != null) {
      const hex = Number(user.id).toString(16).toUpperCase().padStart(6, "0");
      return `ZN-${hex.slice(-6)}`;
    }
    return "ZN-4F8A2C";
  }, [user?.id]);

  const displayName = user
    ? `${user.first_name} ${user.last_name}`.trim() || user.email
    : "Guest";

  const copyToClipboard = useCallback(async (text: string, kind: "curl" | "zone") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }, []);

  const sendLive = async () => {
    if (!selected) return;
    setLoading(true);
    setError(null);
    setResponseText("");
    try {
      const url = buildUrl(selected.path, values, selected);
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (!selected.public && token) {
        headers.Authorization = `Bearer ${token}`;
      }
      let body: string | undefined;
      if (selected.method !== "GET") {
        if (selected.bodyJson) {
          const raw = values.body?.trim();
          if (!raw) {
            throw new Error("Body JSON is required for this request.");
          }
          try {
            body = JSON.stringify(JSON.parse(raw));
          } catch {
            throw new Error("Invalid JSON in body.");
          }
        } else {
          const obj = buildBodyObject(selected, values);
          if (obj) body = JSON.stringify(obj);
        }
      }
      const res = await fetch(url, { method: selected.method, headers, body });
      const text = await res.text();
      let formatted = text;
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* keep raw */
      }
      setResponseText(
        `${res.status} ${res.statusText}\n\n${formatted}`,
      );
      if (!res.ok) {
        setError(`HTTP ${res.status}`);
      } else if (selected.id === "message-feature-propagate") {
        try {
          const body = JSON.parse(text) as MessageFeaturePropagationResponse;
          if (!body.skipped && body.id) {
            const enriched: MessageFeaturePropagationResponse = {
              ...body,
              sender_id:
                body.sender_id ??
                (user?.id != null ? Number(user.id) : undefined),
              zone_id:
                body.zone_id ??
                body.zone_ids?.[0] ??
                (typeof user?.zone_id === "string"
                  ? user.zone_id
                  : typeof user?.zoneId === "string"
                    ? user.zoneId
                    : undefined),
            };
            dispatchGeoPropagationInbox(enriched);
          }
        } catch {
          /* response shown in panel only */
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      setResponseText(msg);
    } finally {
      setLoading(false);
    }
  };

  const setField = (name: string, v: string) => {
    setValues((prev) => ({ ...prev, [name]: v }));
  };

  return (
    <div className="layer-card flex h-[calc(100vh-8rem)] flex-col gap-0 overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE6F2] bg-[#F3F7FD] px-5 py-4">
        <div className="flex flex-wrap items-center gap-6">
          <p className="text-sm font-semibold tracking-[0.2em] text-[#0F2C5C]">
            ZONE WEAVER
          </p>
          <div className="flex items-center gap-2 rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-1.5 text-xs text-[#566784]">
            <span className="text-[#8694AC]">NETWORK</span>
            <span className="font-mono text-[#2F80ED]">{zoneLabel}</span>
            <button
              type="button"
              onClick={() => copyToClipboard(zoneLabel, "zone")}
              className="rounded p-0.5 text-[#8694AC] transition hover:bg-[#EDF3FB] hover:text-[#2F80ED]"
              title="Copy network id"
            >
              {copied === "zone" ? (
                <Check size={14} className="text-[#2FA24A]" />
              ) : (
                <Copy size={14} />
              )}
            </button>
          </div>
        </div>
        <p className="text-sm text-[#566784]">{displayName}</p>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-b border-[#DCE6F2] bg-[#F7FAFE] lg:h-full lg:w-80 lg:border-b-0 lg:border-r">
          <div className="p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
              API endpoints
            </p>
            <p className="mt-1 text-xs text-[#8694AC]">
              OpenAPI-style paths against{" "}
              <code className="rounded bg-[#EDF3FB] px-1 py-0.5 text-[#2F80ED]">
                {API_BASE.replace(/^https?:\/\//, "")}
              </code>
            </p>
            <nav className="mt-4 space-y-1 p-1">
              {ENDPOINTS.map((ep) => (
                <button
                  key={ep.id}
                  type="button"
                  onClick={() => setSelectedId(ep.id)}
                  className={`flex w-full flex-col items-start gap-1 rounded-xl px-3 py-2.5 text-left text-sm transition ${
                    ep.id === selectedId
                      ? "bg-[#EDF3FB] ring-1 ring-[#2F80ED]/45"
                      : "hover:bg-[#EDF3FB]"
                  }`}
                >
                  <span className="flex w-full flex-wrap items-baseline gap-2">
                    <span
                      className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${methodPillClass(ep.method)}`}
                    >
                      {ep.method}
                    </span>
                    <span className="rounded bg-[#EDF3FB] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#8694AC]">
                      {ep.group}
                    </span>
                    <span className="break-all font-mono text-xs text-[#566784]">
                      {ep.path}
                    </span>
                  </span>
                  <span className="text-xs text-[#8694AC]">{ep.description}</span>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        <div className="min-w-0 flex-1 overflow-y-auto p-5">
          <section className="mb-6 rounded-2xl border border-[#DCE6F2] bg-white p-4 text-sm text-[#566784]">
            <p>
              Auth styles: <span className="font-semibold text-[#0F2C5C]">Core routes</span>{" "}
              use token from <code>/owners/login</code>;{" "}
              <span className="font-semibold text-[#0F2C5C]">Contract routes</span>{" "}
              use token from <code>/login</code>.
            </p>
            <p className="mt-2 text-[#8694AC]">
              WebSocket endpoints: <code>/ws?token=&lt;jwt&gt;</code> and{" "}
              <code>/ws/messages?token=&lt;jwt&gt;</code> (compat alias).
              Event envelope: <code>{`{ type, data }`}</code> with{" "}
              <code>NEW_GEO_MESSAGE</code>, <code>PERMISSION_MESSAGE</code>, and{" "}
              <code>NEW_MESSAGE</code>.
            </p>
          </section>
          {selected && (
            <div className="space-y-6">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`inline-flex rounded px-2 py-1 text-xs font-bold uppercase tracking-wide ring-1 ${methodPillClass(selected.method)}`}
                  >
                    {selected.method}
                  </span>
                  <h1 className="font-mono text-lg text-[#0F2C5C] break-all">
                    {selected.path}
                  </h1>
                </div>
                <p className="mt-2 text-sm text-[#8694AC]">{selected.description}</p>
              </div>

              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
                  Parameters
                </h2>
                {(() => {
                  const pathQuery = selected.params.filter(
                    (p) => p.in === "path" || p.in === "query",
                  );
                  const bodyInputs = selected.params.filter(
                    (p) => p.in === "body" && p.name !== "body",
                  );
                  const hasAny =
                    pathQuery.length > 0 ||
                    selected.bodyJson ||
                    bodyInputs.length > 0;
                  if (!hasAny) {
                    return (
                      <p className="text-sm text-[#8694AC]">No parameters.</p>
                    );
                  }
                  return (
                    <div className="space-y-6">
                      {pathQuery.map((p) => (
                        <div
                          key={`${p.in}-${p.name}`}
                          className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"
                        >
                          <div>
                            <label className="text-sm text-[#566784]">
                              {p.name}
                              {p.required ? (
                                <span className="text-[#E23B4E]"> *</span>
                              ) : null}
                              <span className="ml-2 text-xs text-[#8694AC]">
                                ({p.type ?? "string"})
                              </span>
                            </label>
                            <input
                              type="text"
                              value={values[p.name] ?? ""}
                              onChange={(e) => setField(p.name, e.target.value)}
                              placeholder={p.placeholder ?? p.name}
                              className="mt-1.5 w-full rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C] outline-none transition focus:border-[#2F80ED]/60 focus:ring-2 focus:ring-[#2F80ED]/25"
                            />
                          </div>
                          <p className="text-right text-[10px] uppercase tracking-wide text-[#8694AC] sm:pt-6">
                            {p.in}
                          </p>
                        </div>
                      ))}
                      {selected.bodyJson ? (
                        <div className="space-y-2">
                          <label className="block text-xs text-[#8694AC]">
                            body (JSON)
                          </label>
                          <textarea
                            value={values.body ?? ""}
                            onChange={(e) => setField("body", e.target.value)}
                            rows={14}
                            spellCheck={false}
                            className="w-full rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 font-mono text-xs text-[#0F2C5C] outline-none ring-[#2F80ED]/0 transition focus:border-[#2F80ED]/60 focus:ring-2 focus:ring-[#2F80ED]/25"
                          />
                        </div>
                      ) : (
                        bodyInputs.map((p) => (
                          <div
                            key={`${p.in}-${p.name}`}
                            className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center"
                          >
                            <div>
                              <label className="text-sm text-[#566784]">
                                {p.name}
                                {p.required ? (
                                  <span className="text-[#E23B4E]"> *</span>
                                ) : null}
                                <span className="ml-2 text-xs text-[#8694AC]">
                                  ({p.type ?? "string"})
                                </span>
                              </label>
                              <input
                                type={
                                  p.name.toLowerCase().includes("password")
                                    ? "password"
                                    : "text"
                                }
                                value={values[p.name] ?? ""}
                                onChange={(e) =>
                                  setField(p.name, e.target.value)
                                }
                                placeholder={p.placeholder ?? p.name}
                                className="mt-1.5 w-full rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-2 text-sm text-[#0F2C5C] outline-none transition focus:border-[#2F80ED]/60 focus:ring-2 focus:ring-[#2F80ED]/25"
                              />
                            </div>
                            <p className="text-right text-[10px] uppercase tracking-wide text-[#8694AC] sm:pt-6">
                              {p.in}
                            </p>
                          </div>
                        ))
                      )}
                    </div>
                  );
                })()}
              </section>

              <section>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
                    curl
                  </h2>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        curlEditedRef.current = false;
                        setCurlDraft(generatedCurl);
                      }}
                      className="rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-1.5 text-xs text-[#8694AC] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]"
                    >
                      Reset to generated
                    </button>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(curlDraft, "curl")}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-[#DCE6F2] bg-[#F7FAFE] px-3 py-1.5 text-xs text-[#566784] transition hover:border-[#2F80ED]/50 hover:text-[#2F80ED]"
                    >
                      {copied === "curl" ? (
                        <Check size={14} className="text-[#2FA24A]" />
                      ) : (
                        <Copy size={14} />
                      )}
                      Copy
                    </button>
                  </div>
                </div>
                <textarea
                  value={curlDraft}
                  onChange={(e) => {
                    curlEditedRef.current = true;
                    setCurlDraft(e.target.value);
                  }}
                  spellCheck={false}
                  rows={8}
                  className="w-full resize-y rounded-2xl border border-[#DCE6F2] bg-[#F7FAFE] p-4 font-mono text-xs leading-relaxed text-[#0F2C5C] outline-none transition focus:border-[#2F80ED]/60 focus:ring-2 focus:ring-[#2F80ED]/25"
                />
                <p className="mt-2 text-xs text-[#8694AC]">
                  Edit freely for your terminal. Live test still uses the parameters above.
                </p>
              </section>

              <section>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-[#8694AC]">
                  Live test
                </h2>
                <button
                  type="button"
                  onClick={sendLive}
                  disabled={loading}
                  className="rounded-xl bg-[#2F80ED] px-5 py-2.5 text-sm font-bold text-white transition hover:brightness-110 disabled:opacity-50"
                >
                  {loading ? "Sending…" : "Send"}
                </button>
                {error ? (
                  <p className="mt-2 text-sm text-[#E23B4E]">{error}</p>
                ) : null}
                <pre className="mt-4 min-h-[8rem] overflow-x-auto rounded-2xl border border-[#DCE6F2] bg-[#F7FAFE] p-4 text-xs text-[#0F2C5C]">
                  {responseText || (
                    <span className="text-[#8694AC]">
                      Response will appear here after you send a request.
                    </span>
                  )}
                </pre>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
