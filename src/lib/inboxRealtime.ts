import type { MessageFeaturePropagationResponse } from "../services/api/messageFeature";

/** Dispatched when `POST /message-feature/messages/propagate` succeeds (e.g. API Docs). */
export const GEO_PROPAGATION_INBOX_EVENT = "hexzone-geo-propagation-inbox";

export type GeoPropagationInboxDetail = {
  propagation: MessageFeaturePropagationResponse;
};

export function dispatchGeoPropagationInbox(
  propagation: MessageFeaturePropagationResponse,
): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<GeoPropagationInboxDetail>(GEO_PROPAGATION_INBOX_EVENT, {
      detail: { propagation },
    }),
  );
}
