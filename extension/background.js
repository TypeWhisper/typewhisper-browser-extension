import {
  APIError,
  getDictationStatus,
  putBrowserContext,
  startDictation,
  stopDictation,
} from "./api.js";
import { buildReport, shouldSend } from "./context.js";
import { getClientId, getSettings, setConnectionStatus } from "./settings.js";

const REFRESH_ALARM = "refresh-context";
const MENU_ID = "toggle-dictation";
const MIC_SCRIPT_ID = "mic-button";
const RECORDING_POLL_MS = 1000;
const RECORDING_POLL_LIMIT = 30 * 60;

// MARK: - Setup

// Content scripts read the recording state to draw the microphone button.
void chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_AND_UNTRUSTED_CONTEXTS" });

chrome.runtime.onInstalled.addListener(() => {
  void setUp();
});

chrome.runtime.onStartup.addListener(() => {
  void setUp();
});

async function setUp() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: chrome.i18n.getMessage("menuStartDictation"),
      contexts: ["editable"],
    });
  });
  await chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: 1 });
  await syncMicButton();
  queueContextReport();
}

// MARK: - Active tab reporting

let reportQueue = Promise.resolve();

/** Reports run one after another so TypeWhisper receives them in order. */
function queueContextReport() {
  reportQueue = reportQueue.then(reportContext, reportContext);
  return reportQueue;
}

async function reportContext() {
  const settings = await getSettings();
  const clientId = await getClientId();
  let report;
  if (settings.reportContext) {
    const window = await chrome.windows.getLastFocused().catch(() => null);
    let tab = null;
    if (window?.focused) {
      [tab] = await chrome.tabs.query({ active: true, windowId: window.id });
    }
    report = buildReport(clientId, window, tab);
  } else {
    // Clears what this browser reported before the setting was turned off.
    report = buildReport(clientId, null, null);
  }

  const { lastReport } = await chrome.storage.session.get("lastReport");
  const now = Date.now();
  if (!shouldSend(lastReport, report, now)) return;

  try {
    await putBrowserContext(settings, report);
    await chrome.storage.session.set({ lastReport: { report, sentAt: now } });
    await setConnectionStatus({ state: "connected" });
  } catch (error) {
    await recordError(error);
  }
}

chrome.windows.onFocusChanged.addListener(() => {
  queueContextReport();
});

chrome.tabs.onActivated.addListener(() => {
  queueContextReport();
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || changeInfo.title || changeInfo.status === "complete")) {
    queueContextReport();
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) queueContextReport();
});

// MARK: - Dictation

chrome.commands.onCommand.addListener((command) => {
  if (command === "toggle-dictation") void toggleDictation();
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === MENU_ID) void toggleDictation();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "toggle-dictation") {
    toggleDictation().then(sendResponse);
    return true;
  }
  if (message?.type === "report-context") {
    queueContextReport().then(() => sendResponse({ ok: true }));
    return true;
  }
  return false;
});

let toggleInFlight = null;

/**
 * Starts a dictation, or stops the running one. TypeWhisper inserts the text
 * into the focused field, as it does for its own hotkey.
 */
function toggleDictation() {
  toggleInFlight ??= performToggle().finally(() => {
    toggleInFlight = null;
  });
  return toggleInFlight;
}

async function performToggle() {
  const settings = await getSettings();
  // TypeWhisper picks the workflow for the website when the dictation starts.
  await queueContextReport();
  try {
    const status = await getDictationStatus(settings);
    if (status?.is_recording) {
      await stopDictation(settings);
      await setRecording(false);
      return { ok: true, recording: false };
    }
    await startDictation(settings);
    await setConnectionStatus({ state: "connected" });
    await setRecording(true);
    void watchRecording(settings);
    return { ok: true, recording: true };
  } catch (error) {
    await recordError(error);
    return { ok: false, error: errorMessage(error) };
  }
}

/** Follows a dictation that may also be stopped by TypeWhisper's own hotkey or overlay. */
async function watchRecording(settings) {
  for (let attempt = 0; attempt < RECORDING_POLL_LIMIT; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, RECORDING_POLL_MS));
    try {
      const status = await getDictationStatus(settings);
      if (!status?.is_recording) break;
    } catch {
      break;
    }
  }
  await setRecording(false);
}

async function setRecording(recording) {
  await chrome.storage.session.set({ recording });
  await chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  await chrome.action.setBadgeText({ text: recording ? "REC" : "" });
  chrome.contextMenus.update(MENU_ID, {
    title: chrome.i18n.getMessage(recording ? "menuStopDictation" : "menuStartDictation"),
  });
}

// MARK: - Errors

async function recordError(error) {
  const state = error instanceof APIError
    ? { offline: "offline", unauthorized: "unauthorized", unsupported: "unsupported" }[error.kind] ?? "error"
    : "error";
  await setConnectionStatus({ state, message: errorMessage(error) });
}

function errorMessage(error) {
  if (error instanceof APIError) {
    switch (error.kind) {
      case "offline":
        return chrome.i18n.getMessage("errorOffline");
      case "unauthorized":
        return chrome.i18n.getMessage("errorUnauthorized");
      case "unsupported":
        return chrome.i18n.getMessage("errorUnsupported");
      default:
        return error.message;
    }
  }
  return String(error?.message ?? error);
}

// MARK: - Microphone button

async function syncMicButton() {
  const { showMicButton } = await getSettings();
  const granted = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [MIC_SCRIPT_ID] });
  if (showMicButton && granted) {
    if (registered.length === 0) {
      await chrome.scripting.registerContentScripts([
        {
          id: MIC_SCRIPT_ID,
          matches: ["<all_urls>"],
          js: ["content/mic-button.js"],
          allFrames: true,
          runAt: "document_idle",
        },
      ]);
      await injectIntoOpenTabs();
    }
  } else if (registered.length > 0) {
    await chrome.scripting.unregisterContentScripts({ ids: [MIC_SCRIPT_ID] });
  }
}

/** Registered scripts only reach pages loaded afterwards. */
async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs.map((tab) =>
      chrome.scripting
        .executeScript({ target: { tabId: tab.id, allFrames: true }, files: ["content/mic-button.js"] })
        .catch(() => {}),
    ),
  );
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.showMicButton) void syncMicButton();
  if (changes.reportContext || changes.port || changes.token) {
    // Settings changes must reach TypeWhisper right away, not after the next refresh.
    chrome.storage.session.remove("lastReport").then(queueContextReport);
  }
});

chrome.permissions.onAdded.addListener(() => void syncMicButton());
chrome.permissions.onRemoved.addListener(() => void syncMicButton());

// The end-to-end test drives the worker through these functions.
globalThis.typewhisper = { toggleDictation, queueContextReport };
