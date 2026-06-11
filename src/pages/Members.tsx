import { useEffect, useState } from "react";
import { getOwners, type OwnerListItem } from "../services/api/auth";
import { getMembers, type Member } from "../services/api/members";
import { updateOwner } from "../lib/api";
import { useAuth } from "../hooks/useAuth";
import { useAppState } from "../state/app/AppStateContext";

function formatLastSeen(value?: string): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

export default function Members() {
  const { user } = useAuth();
  const isAdministrator =
    String(user?.role ?? "").toLowerCase() === "administrator";
  const { setMembers: setGlobalMembers } = useAppState();
  const [members, setMembers] = useState<Member[]>([]);
  const [owners, setOwners] = useState<OwnerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingOwnerId, setUpdatingOwnerId] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([getMembers(), getOwners({ skip: 0, limit: 500 })])
      .then(([membersResult, ownersResult]) => {
        if (!mounted) return;

        if (membersResult.error || ownersResult.error) {
          setError(
            membersResult.error ?? ownersResult.error ?? "Failed to load data.",
          );
          return;
        }

        const nextMembers = membersResult.data ?? [];
        const nextOwners = ownersResult.data ?? [];
        setMembers(nextMembers);
        setGlobalMembers(nextMembers);
        setOwners(nextOwners);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [setGlobalMembers]);

  const toggleOwnerActive = async (owner: OwnerListItem) => {
    if (!isAdministrator) {
      setError("Only administrators can update active status.");
      return;
    }
    const current = Boolean(owner.active);
    setUpdatingOwnerId(String(owner.id));
    setError(null);
    try {
      await updateOwner(owner.id, { active: !current });
      setOwners((prev) =>
        prev.map((row) =>
          row.id === owner.id ? { ...row, active: !current } : row,
        ),
      );
    } catch {
      setError("Could not update user status. Please try again.");
    } finally {
      setUpdatingOwnerId(null);
    }
  };

  return (
    <section className="space-y-6 p-8">
      <h1 className="text-2xl font-semibold text-[#0F2C5C] sm:text-3xl">
        Members
      </h1>
      {loading && (
        <p className="text-sm text-[#8694AC]">Loading members...</p>
      )}
      {error && (
        <p className="rounded-md border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">
          {error}
        </p>
      )}
      {!isAdministrator && (
        <div className="grid grid-cols-3 gap-3">
          {members.map((member) => (
            <article
              key={member.id}
              className="rounded-xl border border-[#DCE6F2] bg-white p-4 flex-1 shadow-sm"
            >
              <p className="font-medium text-[#0F2C5C]">{member.name}</p>
              <p className="mt-1 text-xs text-[#8694AC]">
                Member ID: <span className="font-mono">{member.id}</span>
              </p>
              {member.address && (
                <p className="text-xs text-[#8694AC]">
                  Address: {member.address}
                </p>
              )}
              <p className="mt-1 text-xs text-[#8694AC]">
                Primary zone: {member.zone_id ?? "Unknown"}
              </p>
            </article>
          ))}
        </div>
      )}

      {isAdministrator && (
        <div className="space-y-3">
          <h2 className="text-xl font-semibold text-[#0F2C5C]">
            Owners (administration)
          </h2>
          <div className="grid grid-cols-4 gap-3">
            {owners.map((owner) => {
              const name =
                `${owner.first_name ?? ""} ${owner.last_name ?? ""}`.trim() ||
                owner.email ||
                "Owner";
              return (
                <article
                  key={owner.id}
                  className="rounded-xl border border-[#DCE6F2] bg-white p-4 flex-1 shadow-sm"
                >
                  <p className="font-medium text-[#0F2C5C]">{name}</p>
                  {owner.address && (
                    <p className="text-xs text-[#8694AC]">
                      Address: {owner.address}
                    </p>
                  )}
                  <p className="mt-1 text-xs text-[#8694AC]">
                    Owner ID: <span className="font-mono">{owner.id}</span>
                  </p>
                  <p className="mt-1 text-xs text-[#8694AC]">
                    Primary zone: {owner.zone_id ?? "Unknown"}
                  </p>
                  <p className="mt-1 text-xs text-[#8694AC]">
                    Status: {owner.active === false ? "inactive" : "active"}
                  </p>
                  <button
                    type="button"
                    onClick={() => void toggleOwnerActive(owner)}
                    disabled={updatingOwnerId === String(owner.id)}
                    className="mt-3 rounded-md border border-[#DCE6F2] px-3 py-1.5 text-xs text-[#566784] transition hover:border-[#2F80ED]/50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {updatingOwnerId === String(owner.id)
                      ? "Updating..."
                      : owner.active === false
                        ? "Set active"
                        : "Set inactive"}
                  </button>
                </article>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
