import { APIError, getDictationStatus, getStatus } from "../api.js";
import { getSettings, saveSettings, setConnectionStatus } from "../settings.js";

const message = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

for (const element of document.querySelectorAll("[data-i18n]")) {
  element.textContent = message(element.dataset.i18n);
}

const statusElement = document.getElementById("status");
const tokenInput = document.getElementById("token");
const portInput = document.getElementById("port");
const reportContextInput = document.getElementById("reportContext");
const showMicButtonInput = document.getElementById("showMicButton");

function showStatus(state, text) {
  statusElement.dataset.state = state;
  statusElement.textContent = text;
}

async function checkConnection() {
  showStatus("checking", message("statusChecking"));
  const settings = await getSettings();
  let status;
  try {
    status = await getStatus(settings, { timeoutMs: 2000 });
    await getDictationStatus(settings, { timeoutMs: 2000 });
  } catch (error) {
    const kind = error instanceof APIError ? error.kind : "error";
    if (kind === "offline") {
      showStatus("offline", message("statusOffline"));
    } else if (kind === "unauthorized") {
      showStatus("unauthorized", message("statusUnauthorized"));
    } else {
      showStatus("error", error.message);
    }
    await setConnectionStatus({ state: kind === "offline" || kind === "unauthorized" ? kind : "error" });
    return;
  }

  if (status?.supports_browser_context !== true) {
    showStatus("unsupported", message("statusUnsupported"));
    await setConnectionStatus({ state: "unsupported" });
    return;
  }
  const model = status?.model ? message("statusModel", [status.model]) : "";
  showStatus("connected", `${message("statusConnected")}${model}`);
  await setConnectionStatus({ state: "connected" });
}

async function load() {
  const settings = await getSettings();
  tokenInput.value = settings.token;
  portInput.value = String(settings.port);
  reportContextInput.checked = settings.reportContext;
  const granted = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  showMicButtonInput.checked = settings.showMicButton && granted;

  const commands = await chrome.commands.getAll();
  const shortcut = commands.find((command) => command.name === "toggle-dictation")?.shortcut;
  document.getElementById("shortcut").textContent = shortcut
    ? message("labelShortcut", [shortcut])
    : message("labelNoShortcut");

  await checkConnection();
}

document.getElementById("connection").addEventListener("submit", async (event) => {
  event.preventDefault();
  const port = Number.parseInt(portInput.value, 10);
  await saveSettings({
    token: tokenInput.value.trim(),
    port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 8978,
  });
  await checkConnection();
});

reportContextInput.addEventListener("change", () => {
  void saveSettings({ reportContext: reportContextInput.checked });
});

showMicButtonInput.addEventListener("change", async () => {
  if (!showMicButtonInput.checked) {
    await saveSettings({ showMicButton: false });
    return;
  }
  // The button needs access to every page; Chrome asks for it only on request.
  const granted = await chrome.permissions.request({ origins: ["<all_urls>"] });
  showMicButtonInput.checked = granted;
  await saveSettings({ showMicButton: granted });
});

document.getElementById("editShortcut").addEventListener("click", (event) => {
  event.preventDefault();
  void chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

void load();
