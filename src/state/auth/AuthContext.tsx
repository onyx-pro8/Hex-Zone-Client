import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getProfile,
  getRememberMe,
  getRemoteAppSettings,
  getStoredToken,
  login as authLogin,
  logout as authLogout,
  register as authRegister,
  type AuthUser,
  type AccountType,
  type RegisterPayload,
} from "../../services/api";
import { updateAppSettings, type AppSettings } from "../../lib/appSettings";
import {
  describeDeviceSyncFailure,
  DEVICE_SIGNED_OUT_ELSEWHERE_MESSAGE,
  isLocalDeviceSessionActive,
  setCurrentDeviceOffline,
  syncCurrentDevice,
} from "../../lib/deviceSync";
import { DeviceSessionConflictError } from "../../lib/deviceSync";

type LegacyRegisterPayload = {
  email: string;
  password: string;
  first_name: string;
  last_name: string;
  account_type: string;
  zone_id?: string;
  role?: "administrator" | "user";
  account_owner_id?: number;
  phone?: string;
  address?: string;
  registration_code?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
  login: (
    email: string,
    password: string,
    options?: { rememberMe?: boolean; forceDeviceTakeover?: boolean },
  ) => Promise<void>;
  register: (payload: RegisterPayload | LegacyRegisterPayload) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

function parseJwtExp(token: string): number | null {
  try {
    const payloadPart = token.split(".")[1];
    if (!payloadPart) return null;
    const payload = JSON.parse(atob(payloadPart)) as { exp?: number };
    return payload.exp ?? null;
  } catch {
    return null;
  }
}

function isExpired(token: string): boolean {
  const exp = parseJwtExp(token);
  if (!exp) return false;
  return Date.now() >= exp * 1000;
}

function mapLegacyRegister(payload: LegacyRegisterPayload): RegisterPayload {
  const normalizedType = String(payload.account_type).toUpperCase();
  const accountType: AccountType =
    normalizedType === "PRIVATE_PLUS" || normalizedType === "PRIVATE+"
      ? "PRIVATE_PLUS"
      : normalizedType === "EXCLUSIVE"
        ? "EXCLUSIVE"
        : normalizedType === "ENHANCED"
          ? "ENHANCED"
          : normalizedType === "ENHANCED_PLUS" || normalizedType === "ENHANCED+"
            ? "ENHANCED_PLUS"
            : "PRIVATE";
  return {
    name: `${payload.first_name} ${payload.last_name}`.trim(),
    email: payload.email,
    password: payload.password,
    accountType,
    registrationType:
      String(payload.role ?? "").toLowerCase() === "user"
        ? "USER"
        : "ADMINISTRATOR",
    accountOwnerId: payload.account_owner_id,
    zoneId: payload.zone_id,
    phone: payload.phone,
    address: payload.address,
    registrationCode: payload.registration_code,
  };
}

function normalizeMapCenter(
  value:
    | { latitude?: unknown; longitude?: unknown }
    | null
    | undefined,
): { latitude: number; longitude: number } | null {
  if (!value || typeof value !== "object") return null;
  const rawLat = Number(value.latitude);
  const rawLng = Number(value.longitude);
  if (!Number.isFinite(rawLat) || !Number.isFinite(rawLng)) return null;

  if (Math.abs(rawLat) <= 90 && Math.abs(rawLng) <= 180) {
    return { latitude: rawLat, longitude: rawLng };
  }
  // Some backends accidentally return [lng, lat] in named keys.
  if (Math.abs(rawLng) <= 90 && Math.abs(rawLat) <= 180) {
    return { latitude: rawLng, longitude: rawLat };
  }
  return null;
}

function normalizeUser(raw: AuthUser | null): AuthUser | null {
  if (!raw) return null;
  const first = raw.first_name ?? "";
  const last = raw.last_name ?? "";
  const fullName = raw.name || `${first} ${last}`.trim() || raw.email || "User";
  const zoneId =
    raw.zoneId ?? (raw.zone_id != null ? String(raw.zone_id) : undefined);
  const mapCenter = normalizeMapCenter(raw.mapCenter ?? raw.map_center ?? null);
  const accountTypeRaw =
    raw.accountType ?? String(raw.account_type ?? "").toUpperCase();
  const normalizedAccountType: AccountType =
    accountTypeRaw === "PRIVATE_PLUS"
      ? "PRIVATE_PLUS"
      : accountTypeRaw === "EXCLUSIVE"
        ? "EXCLUSIVE"
        : accountTypeRaw === "ENHANCED"
          ? "ENHANCED"
          : accountTypeRaw === "ENHANCED_PLUS"
            ? "ENHANCED_PLUS"
            : "PRIVATE";
  const role =
    raw.role ??
    (String(raw.registrationType ?? raw.registration_type ?? "").toUpperCase() ===
    "USER"
      ? "user"
      : "administrator");
  const registrationType =
    String(raw.registrationType ?? raw.registration_type ?? "").toUpperCase() ===
    "USER"
      ? "USER"
      : "ADMINISTRATOR";
  const accountOwnerId =
    raw.accountOwnerId ??
    raw.account_owner_id ??
    (raw.id != null && Number.isFinite(Number(raw.id)) ? Number(raw.id) : undefined);
  return {
    ...raw,
    name: fullName,
    accountType: normalizedAccountType,
    account_type: raw.account_type ?? normalizedAccountType.toLowerCase(),
    registrationType,
    registration_type: raw.registration_type ?? registrationType.toLowerCase(),
    role,
    accountOwnerId,
    account_owner_id: accountOwnerId,
    mapCenter,
    map_center: mapCenter,
    active:
      typeof (raw as AuthUser & { active?: unknown }).active === "boolean"
        ? ((raw as AuthUser & { active?: boolean }).active as boolean)
        : true,
    zoneId,
    zone_id: raw.zone_id ?? zoneId,
  };
}

async function fetchCurrentUser() {
  return getProfile();
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => getStoredToken());
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(false);

  const performLogout = async (markOffline: boolean) => {
    if (markOffline) {
      try {
        await setCurrentDeviceOffline();
      } catch {
        // Logout should still proceed if offline sync fails.
      }
    }
    authLogout();
    setToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    if (!token || isExpired(token)) return;
    setLoading(true);
    const result = await fetchCurrentUser();
    if (result.data) {
      setUser(normalizeUser(result.data));
    }
    setLoading(false);
  };

  useEffect(() => {
    if (!token) return;
    if (isExpired(token)) {
      void performLogout(false);
      return;
    }

    let isMounted = true;
    setLoading(true);
    fetchCurrentUser()
      .then((result) => {
        if (!isMounted) return;
        if (result.data) {
          setUser(normalizeUser(result.data));
          return;
        }
        // Keep token on transient fetch failures to avoid refresh logout loops.
      })
      .finally(() => {
        if (isMounted) {
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !user) return;
    let cancelled = false;
    void getRemoteAppSettings().then((res) => {
      if (cancelled || !res.data) return;
      updateAppSettings(res.data as Partial<AppSettings>);
    });
    return () => {
      cancelled = true;
    };
  }, [token, user]);

  useEffect(() => {
    if (!token || !user) return;
    void syncCurrentDevice(user).then((result) => {
      if (result.status === "account-in-use" || result.status === "error") {
        void performLogout(false);
      }
    });
  }, [token, user]);

  // Sign out this browser when another device takes over the account session.
  useEffect(() => {
    if (!token || !user?.id) return;
    const ownerId = String(user.id);
    let cancelled = false;

    const checkRemoteSignOut = async () => {
      const active = await isLocalDeviceSessionActive(ownerId);
      if (cancelled || active) return;
      window.alert(DEVICE_SIGNED_OUT_ELSEWHERE_MESSAGE);
      await performLogout(false);
    };

    const interval = window.setInterval(() => {
      void checkRemoteSignOut();
    }, 30_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void checkRemoteSignOut();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [token, user]);

  useEffect(() => {
    if (!token) return;
    const exp = parseJwtExp(token);
    if (!exp) return;
    const timeoutMs = exp * 1000 - Date.now();
    if (timeoutMs <= 0) {
      void performLogout(false);
      return;
    }
    const timeout = window.setTimeout(() => {
      void performLogout(false);
    }, timeoutMs);
    return () => window.clearTimeout(timeout);
  }, [token]);

  const login = async (
    email: string,
    password: string,
    options?: { rememberMe?: boolean; forceDeviceTakeover?: boolean },
  ) => {
    const rememberMe = options?.rememberMe ?? getRememberMe();
    const result = await authLogin({ email, password }, rememberMe);
    if (!result.data) {
      throw new Error(result.error ?? "Login failed");
    }
    const syncOptions = { forceTakeover: options?.forceDeviceTakeover };
    if (result.data.user?.id) {
      const normalized = normalizeUser(result.data.user);
      const sync = await syncCurrentDevice(normalized, syncOptions);
      if (sync.status === "account-in-use") {
        throw new DeviceSessionConflictError();
      }
      if (sync.status === "error") {
        throw new Error(describeDeviceSyncFailure(sync));
      }
      setUser(normalized);
    } else {
      const me = await fetchCurrentUser();
      if (!me.data) throw new Error(me.error ?? "Could not load profile");
      const normalized = normalizeUser(me.data);
      const sync = await syncCurrentDevice(normalized, syncOptions);
      if (sync.status === "account-in-use") {
        throw new DeviceSessionConflictError();
      }
      if (sync.status === "error") {
        throw new Error(describeDeviceSyncFailure(sync));
      }
      setUser(normalized);
    }
    setToken(result.data.token);
  };

  const safeLogin = async (
    email: string,
    password: string,
    options?: { rememberMe?: boolean; forceDeviceTakeover?: boolean },
  ) => {
    try {
      await login(email, password, options);
    } catch (err) {
      await performLogout(false);
      throw err;
    }
  };

  const register = async (payload: RegisterPayload | LegacyRegisterPayload) => {
    const normalized =
      "name" in payload ? payload : mapLegacyRegister(payload);
    const result = await authRegister(normalized);
    if (result.error) {
      throw new Error(result.error);
    }
  };

  const logout = async () => {
    await performLogout(true);
  };

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      refreshUser,
      login: safeLogin,
      register,
      logout,
    }),
    [user, token, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
