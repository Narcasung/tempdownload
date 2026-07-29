const DEFAULT_FOLDER = "_Temp";

const input = document.getElementById("folder");
const intro = document.getElementById("intro");
const label = document.getElementById("label");
const current = document.getElementById("current");
const preview = document.getElementById("preview");
const status = document.getElementById("status");
const setupAlert = document.getElementById("setupAlert");
const askWarning = document.getElementById("askWarning");
const dirWarning = document.getElementById("dirWarning");
const orphanWarning = document.getElementById("orphanWarning");
const orphanText = document.getElementById("orphanText");
const orphanOpen = document.getElementById("orphanOpen");
const orphanDismiss = document.getElementById("orphanDismiss");
const advancedButton = document.getElementById("advanced");
const openButton = document.getElementById("open");
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

// The browser's download directory, learned in bg.js from the first download
// seen. Empty until then, which is the case on a fresh install.
let downloadDir = "";

// The full download directory, since the path is the thing the user goes
// looking for. Until a temp download has taught it, there is nothing to show
// but a description of it. Trailing separator included: it reads as a folder
// rather than a file.
function tempPath(folder) {
  if (!downloadDir) return `<download folder>\\${folder}\\`;
  const sep = downloadDir.includes("\\") ? "\\" : "/";
  return `${downloadDir}${sep}${folder}${sep}`;
}

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
  // Both act on the folder as it stands, which a name being typed is not yet.
  clearButton.hidden = on;
  openButton.hidden = on;
  // Nothing can have been remembered before the first download, and setup has
  // no room for a second page anyway.
  advancedButton.hidden = on || needsSetup;
  // Settled, the path is already shown in place of the field.
  preview.hidden = !on;
  // Only relevant while a folder is being decided on, which is the one moment
  // the consequences of moving the download directory are worth reading about.
  dirWarning.hidden = !on;
  label.textContent = on ? "Choose a directory name:" : "Temporary Folder:";
  render();
  if (on) {
    input.focus();
    input.select();
  }
}

function render() {
  const clean = sanitize(editing ? input.value : saved);

  // Built as nodes rather than a string so the path can be marked up. append()
  // takes plain strings as text nodes, so nothing here interprets markup.
  const path = document.createElement("code");
  path.textContent = tempPath(clean || saved);

  // Settled, the path takes the field's place. Nothing there is typed into, so
  // nothing should look like it is, and repeating it underneath says it twice.
  if (!editing) {
    current.textContent = "";
    current.appendChild(path);
    return;
  }

  if (!clean) {
    preview.textContent = "Enter a folder name.";
    return;
  }
  preview.textContent = "";
  preview.append(
    "Files will go to ",
    path,
    ". The folder will be created on your first temp download."
  );
}

// Files the extension put in a temp folder and can no longer delete, because
// the browser dropped their download history entry. Only the count is shown:
// nothing here can read the folder, so naming files that the user may well
// have deleted by hand would claim more than is known.
function renderOrphans(orphans) {
  const files = Array.isArray(orphans) ? orphans : [];
  orphanWarning.hidden = !files.length || needsSetup;
  if (!files.length) return;

  const count = files.length;
  const many = count > 1;
  orphanText.textContent =
    `${count} orphaned file${many ? "s" : ""} ${many ? "have" : "has"} been detected in your temp folder. ` +
    `That happens if you cleared your download history without deleting ${many ? "them" : "it"} first. ` +
    `This extension cannot manage ${many ? "them" : "it"} anymore, and you will have to delete ${many ? "them" : "it"} manually.`;
}

// Left behind by the background when something happened while this page was
// not the one on screen. Read once and dropped: it reports a moment, not a
// state, and a stale one would be worse than none.
const TOAST_MAX_AGE_MS = 60000;

function showToast(toast) {
  if (!toast?.text) return;
  if (Date.now() - (toast.at ?? 0) > TOAST_MAX_AGE_MS) return;
  status.textContent = toast.text;
}

chrome.storage.local.get(
  {
    folder: DEFAULT_FOLDER,
    configured: false,
    askWhereWarning: false,
    orphans: [],
    downloadDir: "",
    toast: null,
  },
  (stored) => {
    saved = sanitize(stored.folder) || DEFAULT_FOLDER;
    downloadDir = stored.downloadDir;
    needsSetup = !stored.configured;
    input.value = saved;
    // Redundant next to the setup instruction, which says the same thing.
    askWarning.hidden = !stored.askWhereWarning || needsSetup;
    renderOrphans(stored.orphans);
    setEditing(needsSetup);
    // After setEditing, which renders and would clear the line again.
    showToast(stored.toast);
    if (stored.toast) chrome.storage.local.remove("toast");
  }
);

// The detection happens in the background as downloads complete, so the page
// has to react while it is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.askWhereWarning) {
    askWarning.hidden = !changes.askWhereWarning.newValue || needsSetup;
  }
  // "Clear now" runs a sweep, which is also what finds untracked files, so the
  // warning can appear while the page is open.
  if (changes.orphans) renderOrphans(changes.orphans.newValue);
  // A download starting while this page is open is what teaches the path on a
  // fresh install, so the placeholder can be replaced live.
  if (changes.downloadDir) {
    downloadDir = changes.downloadDir.newValue || "";
    render();
  }
});

// The files are beyond reach, so acknowledging them is the only thing left to
// do. Final for those files: they left the ledger when they were detected, so
// no later sweep can find them again. The next sweep clears the report anyway,
// this only skips the wait.
orphanDismiss.addEventListener("click", () => {
  chrome.storage.local.set({ orphans: [] });
  orphanWarning.hidden = true;
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

// The rules live on their own page rather than below the folder: they are read
// when something needs undoing, which is rarely, and they would otherwise push
// the settings down the popup every time one is added.
advancedButton.addEventListener("click", () => {
  location.replace("rules.html");
});

changeButton.addEventListener("click", () => {
  status.textContent = "";
  setEditing(true);
});

saveButton.addEventListener("click", save);

// Must match inFolder() in bg.js. Windows paths are case-insensitive.
function inFolder(path, folder) {
  return String(path ?? "")
    .split(/[\\/]/)
    .some((seg) => seg.toLowerCase() === folder.toLowerCase());
}

// No API takes a path, so the folder can only be reached through a download
// that is still in the history: show() opens the folder that file sits in,
// which is the temp folder itself. Once a sweep has erased those entries there
// is nothing left to point at, which is the normal state right after a browser
// start, and the download directory one level up is the closest the browser
// will go. The fallback is not an error, so it does not read like one. It also
// does not claim the folder is empty: untracked files may well be sitting in
// it, which is the whole point of the warning above.
function openTempFolder() {
  chrome.downloads.search({ orderBy: ["-startTime"] }, (items) => {
    const hit = (items || []).find((i) => i.exists !== false && inFolder(i.filename, saved));
    if (hit) {
      chrome.downloads.show(hit.id);
      status.textContent = "";
      return;
    }
    chrome.downloads.showDefaultFolder();
    status.textContent = `Showing your download folder. ${saved} is inside it.`;
  });
}

openButton.addEventListener("click", openTempFolder);
orphanOpen.addEventListener("click", openTempFolder);

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
