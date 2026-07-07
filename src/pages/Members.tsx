import { useEffect, useState } from "react";
import { getOwners, type OwnerListItem } from "../services/api/auth";
import { getMembers, type Member } from "../services/api/members";
import { updateOwner } from "../lib/api";
import {
  accountTypeLabel,
  ADMIN_ASSIGNABLE_ACCOUNT_TYPES,
  isSystemAdministrator,
  normalizeAccountType,
} from "../lib/accountLimits";
import { useAuth } from "../hooks/useAuth";
import { useAppState } from "../state/app/AppStateContext";

function ownerAccountTypeLabel(owner: OwnerListItem): string {
  const normalized = normalizeAccountType(owner.account_type);
  const label = accountTypeLabel(normalized);
  if (
    isSystemAdministrator({
      role: owner.role,
      accountType: owner.account_type,
    })
  ) {
    return `${label} (System Admin)`;
  }
  return label;
}

export default function Members() {
  const { user } = useAuth();
  const isAdministrator =
    String(user?.role ?? "").toLowerCase() === "administrator";
  const isSystemAdmin = isSystemAdministrator({
    role: user?.role,
    accountType: user?.accountType ?? user?.account_type,
  });
  const { setMembers: setGlobalMembers } = useAppState();
  const [members, setMembers] = useState<Member[]>([]);
  const [owners, setOwners] = useState<OwnerListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingOwnerId, setUpdatingOwnerId] = useState<string | null>(null);
  const [updatingAccountTypeOwnerId, setUpdatingAccountTypeOwnerId] = useState<
    string | null
  >(null);

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

  const changeOwnerAccountType = async (
    owner: OwnerListItem,
    accountType: string,
  ) => {
    if (!isSystemAdmin) {
      setError("Only system administrators can change account types.");
      return;
    }
    if (String(owner.role ?? "").toLowerCase() !== "administrator") {
      setError("Only administrator accounts can be assigned a new account type.");
      return;
    }
    const current = String(owner.account_type ?? "").toLowerCase();
    if (current === accountType.toLowerCase()) return;

    setUpdatingAccountTypeOwnerId(String(owner.id));
    setError(null);
    try {
      const updated = await updateOwner(owner.id, {
        account_type: accountType as OwnerUpdateAccountType,
      });
      setOwners((prev) =>
        prev.map((row) =>
          row.id === owner.id
            ? {
                ...row,
                account_type:
                  updated.account_type ?? accountType,
              }
            : row,
        ),
      );
    } catch {
      setError("Could not update account type. Please try again.");
    } finally {
      setUpdatingAccountTypeOwnerId(null);
    }
  };

  return (
    <section className="space-y-6">
      {loading && (
        <div className="rounded-2xl border border-[#DCE6F2] bg-white p-6 shadow-sm">
          <p className="text-sm text-[#8694AC]">Loading members...</p>
        </div>
      )}
      {error && (
        <p className="rounded-md border border-[#E23B4E]/30 bg-[#FCE7EA] px-3 py-2 text-sm text-[#E23B4E]">
          {error}
        </p>
      )}
      {!isAdministrator && !loading && (
        <div className="rounded-2xl border border-[#DCE6F2] bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-bold text-[#0F2C5C]">
            Member directory
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {members.map((member) => (
              <article
                key={member.id}
                className="rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] p-4"
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
        </div>
      )}

      {isAdministrator && !loading && (
        <div className="rounded-2xl border border-[#DCE6F2] bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-lg font-bold text-[#0F2C5C]">
            Owners (administration)
          </h2>
          {isSystemAdmin ? (
            <p className="mb-4 text-sm text-[#8694AC]">
              As a system administrator you can set account types. Assigning
              Private makes an administrator a system administrator.
            </p>
          ) : (
            <p className="mb-4 text-sm text-[#8694AC]">
              Manage active status for members in your account.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {owners.map((owner) => {
              const name =
                `${owner.first_name ?? ""} ${owner.last_name ?? ""}`.trim() ||
                owner.email ||
                "Owner";
              const isOwnerAdministrator =
                String(owner.role ?? "").toLowerCase() === "administrator";
              const currentAccountType = String(
                owner.account_type ?? "private",
              ).toLowerCase();
              return (
                <article
                  key={owner.id}
                  className="rounded-xl border border-[#DCE6F2] bg-[#F7FAFE] p-4"
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
                    Role: {owner.role ?? "administrator"}
                  </p>
                  <p className="mt-1 text-xs text-[#8694AC]">
                    Account type: {ownerAccountTypeLabel(owner)}
                  </p>
                  <p className="mt-1 text-xs text-[#8694AC]">
                    Status: {owner.active === false ? "inactive" : "active"}
                  </p>
                  {isSystemAdmin && isOwnerAdministrator ? (
                    <label className="mt-3 block text-xs text-[#566784]">
                      <span className="mb-1 block font-medium">
                        Set account type
                      </span>
                      <select
                        value={currentAccountType}
                        disabled={
                          updatingAccountTypeOwnerId === String(owner.id)
                        }
                        onChange={(event) =>
                          void changeOwnerAccountType(
                            owner,
                            event.target.value,
                          )
                        }
                        className="w-full rounded-md border border-[#DCE6F2] bg-white px-2 py-1.5 text-xs text-[#0F2C5C] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {ADMIN_ASSIGNABLE_ACCOUNT_TYPES.map((option) => (
                          <option
                            key={option.apiValue}
                            value={option.apiValue}
                          >
                            {option.label}
                            {option.value === "PRIVATE"
                              ? " (System Admin)"
                              : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void toggleOwnerActive(owner)}
                    disabled={updatingOwnerId === String(owner.id)}
                    className="mt-3 rounded-md border border-[#DCE6F2] bg-white px-3 py-1.5 text-xs text-[#566784] transition hover:border-[#2F80ED]/50 disabled:cursor-not-allowed disabled:opacity-50"
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

type OwnerUpdateAccountType = NonNullable<
  Parameters<typeof updateOwner>[1]["account_type"]
>;
