// Settings and connection state shared by the service worker and the popup.

import { DEFAULT_PORT } from "./api.js";

export const DEFAULT_SETTINGS = {
  port: DEFAULT_PORT,
  token: "",
  reportContext: true,
  showMicButton: false,
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
  return { ...DEFAULT_SETTINGS, ...stored };
}

export function saveSettings(changes) {
  return chrome.storage.local.set(changes);
}

/** A random id that lets TypeWhisper tell this browser's reports apart from others. */
export async function getClientId() {
  const { clientId } = await chrome.storage.local.get("clientId");
  if (clientId) return clientId;
  const created = crypto.randomUUID();
  await chrome.storage.local.set({ clientId: created });
  return created;
}

/**
 * The outcome of the last API call, shown in the popup.
 * @param {{ state: "connected" | "offline" | "unauthorized" | "unsupported" | "error", message?: string }} status
 */
export function setConnectionStatus(status) {
  return chrome.storage.session.set({ connectionStatus: { ...status, at: Date.now() } });
}

export async function getConnectionStatus() {
  const { connectionStatus } = await chrome.storage.session.get("connectionStatus");
  return connectionStatus ?? null;
}
