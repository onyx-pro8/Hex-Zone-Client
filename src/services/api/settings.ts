import { request } from "./client";
import type { AppSettings } from "../../lib/appSettings";

/**
 * Remote persistence for the owner's application settings (broadcast identity,
 * structured home address, smart-home integration, quick-alert
 * messages). The backend returns the same camelCase shape as {@link AppSettings},
 * with `quickMessages` possibly partial — callers should merge with local
 * defaults via `mergeSettings`/`updateAppSettings`.
 */

export type RemoteAppSettings = {
  broadcastName?: string;
  address?: Partial<AppSettings["address"]>;
  sharedNotification?: Partial<AppSettings["sharedNotification"]>;
  quickMessages?: Partial<AppSettings["quickMessages"]>;
};

export async function getRemoteAppSettings() {
  return request<RemoteAppSettings>({ method: "GET", url: "/me/settings" });
}

export async function updateRemoteAppSettings(payload: AppSettings) {
  return request<RemoteAppSettings>({
    method: "PUT",
    url: "/me/settings",
    data: payload,
  });
}
