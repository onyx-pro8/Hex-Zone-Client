import { useEffect, useMemo, useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { isSystemAdministrator } from "../lib/accountLimits";
import { getMembers, type Member } from "../services/api/members";
import {
  approveUniversalAccessRequest,
  createUniversalAccessRequest,
  getUniversalAccessRequest,
  listUniversalAccessRequests,
  rejectUniversalAccessRequest,
  setUniversalAccessEnabled,
  type UniversalAccessRequestRow,
} from "../services/api/universalAccess";

const COUNTRIES = [
  "United States",
  "Canada",
  "United Kingdom",
  "Australia",
  "Germany",
  "France",
  "Indonesia",
  "Finland",
  "Japan",
  "Singapore",
];

type Tab = "compose" | "list";

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Could not read the photo."));
    reader.readAsDataURL(file);
  });
}

export default function AccessCodes() {
  const { user } = useAuth();
  const isSystemAdmin = isSystemAdministrator({
    role: user?.role,
    accountType: user?.accountType,
    legacyAccountType: user?.account_type,
  });
  const [tab, setTab] = useState<Tab>(isSystemAdmin ? "list" : "compose");
  const [rows, setRows] = useState<UniversalAccessRequestRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [detail, setDetail] = useState<UniversalAccessRequestRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const [memberId, setMemberId] = useState("");
  const [address, setAddress] = useState("");
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [region, setRegion] = useState("");
  const [city, setCity] = useState("");
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState("");
  const [photoName, setPhotoName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selected = useMemo(
    () => members.find((member) => member.id === memberId) ?? null,
    [members, memberId],
  );

  async function reload() {
    setLoading(true);
    setError(null);
    const [requestResult, memberResult] = await Promise.all([
      listUniversalAccessRequests(),
      isSystemAdmin ? Promise.resolve({ data: [] as Member[], error: null }) : getMembers(),
    ]);
    if (requestResult.error) setError(requestResult.error);
    setRows(requestResult.data ?? []);
    setMembers(memberResult.data ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void reload();
  }, [isSystemAdmin]);

  function onPickMember(id: string) {
    setMemberId(id);
    const member = members.find((row) => row.id === id);
    setAddress(member?.address ?? "");
  }

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Photo ID must be an image.");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    setPhoto(dataUrl);
    setPhotoName(file.name);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!selected) {
      setError("Pick a member who already has an account.");
      return;
    }
    if (!photo) {
      setError("Photo ID is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await createUniversalAccessRequest({
      member_id: Number(selected.id),
      address: address.trim(),
      photo_id: photo,
      country,
      region: region.trim(),
      city: city.trim(),
      note: note.trim(),
    });
    setSubmitting(false);
    if (result.error || !result.data) {
      setError(result.error || "Could not submit the request.");
      return;
    }
    setMemberId("");
    setAddress("");
    setRegion("");
    setCity("");
    setNote("");
    setPhoto("");
    setPhotoName("");
    setTab("list");
    await reload();
  }

  async function onToggle(row: UniversalAccessRequestRow) {
    if (row.credential_id == null) return;
    setBusyId(row.id);
    const result = await setUniversalAccessEnabled(row.credential_id, !row.enabled);
    setBusyId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    await reload();
  }

  async function onApprove(row: UniversalAccessRequestRow) {
    setBusyId(row.id);
    const result = await approveUniversalAccessRequest(row.id);
    setBusyId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDetail(null);
    await reload();
  }

  async function onReject(row: UniversalAccessRequestRow) {
    if (!rejectReason.trim()) {
      setError("A reject reason is required.");
      return;
    }
    setBusyId(row.id);
    const result = await rejectUniversalAccessRequest(row.id, rejectReason.trim());
    setBusyId(null);
    if (result.error) {
      setError(result.error);
      return;
    }
    setRejectReason("");
    setDetail(null);
    await reload();
  }

  const tabs: { key: Tab; label: string }[] = isSystemAdmin
    ? [
        { key: "list", label: "Incoming" },
        { key: "compose", label: "Issued codes" },
      ]
    : [
        { key: "compose", label: "New request" },
        { key: "list", label: "My requests" },
      ];

  const issued = rows.filter((row) => row.status === "approved");
  const tableRows = isSystemAdmin && tab === "compose" ? issued : rows;

  return (
    <section className="space-y-0">
      <div className="overflow-hidden rounded-lg border border-[#DCE6F2] bg-white shadow-sm">
        <header className="flex items-center gap-2 border-b border-[#DCE6F2] px-4 py-3 sm:px-6">
          <KeyRound className="h-4 w-4 text-[#2F80ED]" />
          <span className="text-xs font-bold uppercase tracking-[0.2em] text-[#0F2C5C]">
            Access codes
          </span>
        </header>
        <div className="flex gap-4 border-b border-[#DCE6F2] px-4 sm:px-6">
          {tabs.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setTab(item.key)}
              className={`py-3 text-xs font-bold uppercase tracking-[0.15em] transition ${
                tab === item.key
                  ? "border-b-2 border-[#2F80ED] text-[#2F80ED]"
                  : "text-[#8694AC] hover:text-[#566784]"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="px-4 py-5 sm:px-6">
          {error ? (
            <p className="mb-4 rounded-md border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">
              {error}
            </p>
          ) : null}

          {!isSystemAdmin && tab === "compose" ? (
            <form className="max-w-xl space-y-4" onSubmit={(event) => void onSubmit(event)}>
              <p className="text-sm text-[#566784]">
                Ask the system administrator to give one member a universal access code for a
                city, region, and country. The member must already be on your network.
              </p>
              <label className="block text-sm text-[#0F2C5C]">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Member
                </span>
                <select
                  value={memberId}
                  onChange={(event) => onPickMember(event.target.value)}
                  className="w-full rounded-lg border border-[#DCE6F2] px-3 py-2 text-sm outline-none"
                  required
                >
                  <option value="">Select a member</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
              {members.length === 0 && !loading ? (
                <p className="text-sm text-[#8694AC]">
                  Invite the person first. A request cannot create an account.
                </p>
              ) : null}
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Name
                </span>
                <input
                  value={selected?.name ?? ""}
                  disabled
                  className="w-full rounded-lg border border-[#E3EAF3] bg-[#EEF2F7] px-3 py-2 text-sm text-[#566784]"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Address
                </span>
                <input
                  value={address}
                  onChange={(event) => setAddress(event.target.value)}
                  required
                  className="w-full rounded-lg border border-[#DCE6F2] px-3 py-2 text-sm outline-none"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Registered email
                </span>
                <input
                  value={selected?.email ?? ""}
                  disabled
                  className="w-full rounded-lg border border-[#E3EAF3] bg-[#EEF2F7] px-3 py-2 text-sm text-[#566784]"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Photo ID
                </span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => void onPhoto(event.target.files?.[0])}
                  className="block w-full text-sm text-[#566784]"
                />
                {photo ? (
                  <span className="mt-2 flex items-center gap-3">
                    <img src={photo} alt="" className="h-16 w-16 rounded object-cover" />
                    <button
                      type="button"
                      className="text-xs font-semibold text-[#E23B4E]"
                      onClick={() => {
                        setPhoto("");
                        setPhotoName("");
                      }}
                    >
                      Remove {photoName}
                    </button>
                  </span>
                ) : null}
              </label>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                    Country
                  </span>
                  <select
                    value={country}
                    onChange={(event) => setCountry(event.target.value)}
                    className="w-full rounded-lg border border-[#DCE6F2] px-3 py-2 text-sm outline-none"
                  >
                    {COUNTRIES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                    Region
                  </span>
                  <input
                    value={region}
                    onChange={(event) => setRegion(event.target.value)}
                    required
                    className="w-full rounded-lg border border-[#DCE6F2] px-3 py-2 text-sm outline-none"
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                    City
                  </span>
                  <input
                    value={city}
                    onChange={(event) => setCity(event.target.value)}
                    required
                    className="w-full rounded-lg border border-[#DCE6F2] px-3 py-2 text-sm outline-none"
                  />
                </label>
              </div>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[#566784]">
                  Note
                </span>
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-[#DCE6F2] px-3 py-2 text-sm outline-none"
                />
              </label>
              <button
                type="submit"
                disabled={submitting || members.length === 0}
                className="rounded-lg bg-[#2F80ED] px-5 py-2 text-sm font-bold text-white disabled:opacity-60"
              >
                {submitting ? "Submitting…" : "Submit request"}
              </button>
            </form>
          ) : null}

          {(isSystemAdmin || tab === "list") && !(isSystemAdmin && tab === "compose" && false) ? (
            loading ? (
              <p className="text-sm text-[#8694AC]">Loading…</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-[#8694AC]">
                      {isSystemAdmin ? <th className="py-2 pr-3">Network</th> : null}
                      <th className="py-2 pr-3">Member</th>
                      <th className="py-2 pr-3">Place</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => (
                      <tr key={row.id} className="border-t border-[#DCE6F2] text-[#0F2C5C]">
                        {isSystemAdmin ? (
                          <td className="py-2 pr-3 font-mono text-xs">{row.network_id}</td>
                        ) : null}
                        <td className="py-2 pr-3">{row.member_name}</td>
                        <td className="py-2 pr-3">{row.place}</td>
                        <td className="py-2 pr-3 capitalize">
                          {row.status}
                          {row.status === "rejected" && row.reject_reason
                            ? ` — ${row.reject_reason}`
                            : ""}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {row.status === "approved"
                            ? row.enabled
                              ? "on"
                              : "off"
                            : "—"}
                        </td>
                        <td className="py-2">
                          {row.status === "approved" && row.credential_id != null ? (
                            <button
                              type="button"
                              disabled={busyId === row.id}
                              onClick={() => void onToggle(row)}
                              className="text-xs font-semibold text-[#2F80ED]"
                            >
                              {row.enabled ? "Turn off" : "Turn on"}
                            </button>
                          ) : null}
                          {isSystemAdmin && row.status === "pending" ? (
                            <button
                              type="button"
                              className="text-xs font-semibold text-[#2F80ED]"
                              onClick={() => {
                                setRejectReason("");
                                void getUniversalAccessRequest(row.id).then((result) => {
                                  setDetail(result.data ?? row);
                                  if (result.error) setError(result.error);
                                });
                              }}
                            >
                              Review
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                    {tableRows.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-4 text-sm text-[#8694AC]">
                          Nothing here yet.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            )
          ) : null}
        </div>
      </div>

      {detail ? (
        <div className="mt-4 rounded-lg border border-[#DCE6F2] bg-white p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[#0F2C5C]">{detail.member_name}</h2>
          <p className="mt-1 text-sm text-[#566784]">{detail.email}</p>
          <p className="text-sm text-[#566784]">{detail.address}</p>
          <p className="text-sm text-[#566784]">{detail.place}</p>
          <p className="text-sm text-[#566784]">
            Sent by {detail.network_admin_name} · {detail.network_id}
          </p>
          {detail.note ? <p className="mt-2 text-sm text-[#0F2C5C]">{detail.note}</p> : null}
          {detail.photo_id ? (
            <img
              src={detail.photo_id}
              alt="Photo ID"
              className="mt-3 h-32 w-32 rounded object-cover"
            />
          ) : null}
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <button
              type="button"
              disabled={busyId === detail.id}
              onClick={() => void onApprove(detail)}
              className="rounded-lg bg-[#2F80ED] px-4 py-2 text-sm font-bold text-white"
            >
              Approve
            </button>
            <input
              value={rejectReason}
              onChange={(event) => setRejectReason(event.target.value)}
              placeholder="Reject reason"
              className="rounded-lg border border-[#DCE6F2] px-3 py-2 text-sm"
            />
            <button
              type="button"
              disabled={busyId === detail.id}
              onClick={() => void onReject(detail)}
              className="rounded-lg border border-[#E23B4E] px-4 py-2 text-sm font-bold text-[#E23B4E]"
            >
              Reject
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
