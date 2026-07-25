const DEFAULT_FOLDER = "_Temp";

const input = document.getElementById("folder");
const intro = document.getElementById("intro");
const label = document.getElementById("label");
const current = document.getElementById("current");
const currentName = document.getElementById("currentName");
const preview = document.getElementById("preview");
const status = document.getElementById("status");
const setupAlert = document.getElementById("setupAlert");
const askWarning = document.getElementById("askWarning");
const clearButton = document.getElementById("clear");
const changeButton = document.getElementById("change");
const saveButton = document.getElementById("save");

// Must match sanitize() in bg.js: a single path segment, safe on Windows.
// Anything that could escape the download directory is stripped.
function sanitize(name) {
  return String(name ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 64);
}

// The folder as last saved, kept so an abandoned edit can be rolled back.
let saved = DEFAULT_FOLDER;
let editing = false;

// Until a folder is saved the extension does nothing at all, so this page has
// to keep asking. Setup is driven by that flag rather than by how the page was
// opened: clicking the toolbar icon before setup is done shows setup too.
let needsSetup = true;

// During setup the field is open and focused. Afterwards the name is settled,
// so it is shown read-only behind an explicit "Change temp folder" step.
function setEditing(on) {
  editing = on;
  input.hidden = !on;
  saveButton.hidden = !on;
  current.hidden = on;
  changeButton.hidden = on;
  intro.hidden = !needsSetup;
  // The instruction is worth stating up front during setup. Afterwards it is
  // only shown if a download actually proved the setting is on.
  setupAlert.hidden = !needsSetup;
  // Nothing has been downloaded to a temp folder yet, so there is nothing the
  // button could clear.
  clearButton.hidden = needsSetup;
  label.textContent = on ? "Choose a directory name" : "Temp folder";
  render();
  if (on) {
    input.focus();
    input.select();
  }
}

function render() {
  const clean = sanitize(editing ? input.value : saved);
  currentName.textContent = saved;

  if (!clean) {
    preview.textContent = "Enter a folder name.";
    return;
  }
  const path = `<your browser's download folder>\\${clean}\\`;
  preview.textContent = editing
    ? `Files will go to ${path}. The folder will be created on your first temp download.`
    : `Files go to ${path}`;
}

chrome.storage.local.get(
  { folder: DEFAULT_FOLDER, configured: false, askWhereWarning: false },
  (stored) => {
    saved = sanitize(stored.folder) || DEFAULT_FOLDER;
    needsSetup = !stored.configured;
    input.value = saved;
    // Redundant next to the setup instruction, which says the same thing.
    askWarning.hidden = !stored.askWhereWarning || needsSetup;
    setEditing(needsSetup);
  }
);

// The detection happens in the background as downloads complete, so the page
// has to react while it is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.askWhereWarning) return;
  askWarning.hidden = !changes.askWhereWarning.newValue || needsSetup;
});

input.addEventListener("input", () => {
  status.textContent = "";
  render();
});

function save() {
  const clean = sanitize(input.value);
  if (!clean) {
    status.textContent = "Name cannot be empty.";
    return;
  }
  // Write the sanitized value back so what is stored is what was shown.
  input.value = clean;
  // Saving is the only thing that arms the extension.
  chrome.storage.local.set({ folder: clean, configured: true }, () => {
    saved = clean;
    needsSetup = false;
    status.textContent = "Saved.";
    // Setup and settings are the same popup, so finishing setup just drops
    // into the settled view rather than closing anything.
    setEditing(false);
  });
}

changeButton.addEventListener("click", () => {
  status.textContent = "";
  setEditing(true);
});

saveButton.addEventListener("click", save);

clearButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "tempdl-sweep" });
  status.textContent = "Cleared.";
});

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") save();
  // Abandon the edit rather than the window. Setup has nothing to go back to,
  // so it keeps the field open.
  if (e.key === "Escape" && !needsSetup) {
    input.value = saved;
    status.textContent = "";
    setEditing(false);
  }
});
