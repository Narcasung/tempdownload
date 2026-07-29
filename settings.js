// Everything that is set rather than answered: the folder, and the answers the
// prompt was told to keep. Both live one step off the popup's front page,
// because neither is read often and the front page is where a download is
// dealt with.
//
// Setup happens here too. The folder field exists only on this page, so a
// profile that has never been configured is sent straight to it.

const DEFAULT_FOLDER = "_Temp";

const input = document.getElementById("folder");
const intro = document.getElementById("intro");
const label = document.getElementById("label");
const current = document.getElementById("current");
const preview = document.getElementById("preview");
const status = document.getElementById("status");
const setupAlert = document.getElementById("setupAlert");
const dirWarning = document.getElementById("dirWarning");
const openButton = document.getElementById("open");
const clearButton = document.getElementById("clear");
const changeButton = document.getElementById("change");
const saveButton = document.getElementById("save");

const sites = document.getElementById("sites");
const types = document.getElementById("types");
const siteBlock = document.getElementById("siteBlock");
const typeBlock = document.getElementById("typeBlock");
const emptyNote = document.getElementById("empty");
const precedence = document.getElementById("precedence");
const remembered = document.getElementById("remembered");
const divider = document.getElementById("divider");
const forgetAllButton = document.getElementById("forgetAll");
// Its own line, at the foot of the section it belongs to. The folder has one
// too, above, so neither reports what the other did.
const ruleStatus = document.getElementById("ruleStatus");

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
// to keep asking.
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
  // Worth stating up front during setup. Afterwards it is only worth saying if
  // a download actually proved the setting is on, which the front page reports.
  setupAlert.hidden = !needsSetup;
  // Both act on the folder as it stands, which a name being typed is not yet.
  clearButton.hidden = on;
  openButton.hidden = on;
  // Settled, the path is already shown in place of the field.
  preview.hidden = !on;
  // Only relevant while a folder is being decided on, which is the one moment
  // the consequences of moving the download directory are worth reading about.
  dirWarning.hidden = !on;
  label.textContent = on ? "Choose a directory name:" : "Temporary Folder:";
  // Setup has nowhere to go back to: the front page would only send it here
  // again, so the arrow would look broken.
  document.getElementById("back").hidden = needsSetup;
  // Nothing can have been remembered before the first download, so setup is
  // only the folder, and there is no second section to divide off.
  remembered.hidden = needsSetup;
  divider.hidden = needsSetup;
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

// REMEMBERED CHOICES
//
// A rule answers downloads without showing anything, so this list is the only
// place a forgotten one can be found, and the only way to unsay it.

// Matches the background: nothing else is ever stored, since Cancel is not
// remembered and there is no third branch worth keeping.
const CHOICE_TEXT = { temp: "Temp folder", save: "Save as" };

// The bin is drawn rather than shipped as an asset, so it follows the text
// colour in both themes and stays sharp at any scale.
function binIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", "M4 6h16M9.5 6V4h5v2M6.5 6l1 14h9l1-14");
  svg.appendChild(path);
  return svg;
}

// Built as nodes rather than markup: a host name is whatever a page called
// itself, so nothing here interprets it.
function row(kind, key, choice) {
  const line = document.createElement("div");
  line.className = "rule";

  const name = document.createElement("span");
  name.className = "rule-name";
  name.textContent = kind === "exts" ? `.${key}` : key;

  const value = document.createElement("span");
  value.className = "rule-choice";
  value.textContent = CHOICE_TEXT[choice] ?? choice;

  const remove = document.createElement("button");
  remove.className = "icon";
  remove.title = `Forget ${name.textContent}`;
  remove.appendChild(binIcon());
  remove.addEventListener("click", () => forget(kind, key));

  line.append(name, value, remove);
  return line;
}

function renderRules(rules) {
  const hosts = Object.keys(rules.hosts).sort();
  const exts = Object.keys(rules.exts).sort();

  sites.textContent = "";
  types.textContent = "";
  for (const host of hosts) sites.appendChild(row("hosts", host, rules.hosts[host]));
  for (const ext of exts) types.appendChild(row("exts", ext, rules.exts[ext]));

  siteBlock.hidden = !hosts.length;
  typeBlock.hidden = !exts.length;
  emptyNote.hidden = hosts.length || exts.length;
  // Nothing to empty is not worth a button to empty it with.
  forgetAllButton.hidden = !(hosts.length || exts.length);
  // Only worth explaining when both kinds exist, since that is the only time
  // one can lose to the other.
  precedence.hidden = !(hosts.length && exts.length);
}

function loadRules() {
  chrome.storage.local.get({ rules: null }, ({ rules }) => {
    renderRules({ hosts: rules?.hosts ?? {}, exts: rules?.exts ?? {} });
  });
}

function forget(kind, key) {
  // Removing one is an answer to the question the bin asked, but not the one it
  // was waiting for.
  if (armed) disarm();

  chrome.storage.local.get({ rules: null }, ({ rules }) => {
    const next = { hosts: { ...(rules?.hosts ?? {}) }, exts: { ...(rules?.exts ?? {}) } };
    delete next[kind][key];
    chrome.storage.local.set({ rules: next }, () => {
      ruleStatus.textContent = `Forgot ${kind === "exts" ? `.${key}` : key}.`;
      renderRules(next);
    });
  });
}

// Emptying the whole list is one click away from every rule the user built, so
// it asks first. Not through confirm(): a dialog takes focus, and a popup that
// loses focus closes, taking the question with it. The second click is the
// answer, and forgetting to give it undoes the first.
const ARM_TIMEOUT_MS = 4000;
let armed = null;

function disarm() {
  clearTimeout(armed);
  armed = null;
  forgetAllButton.classList.remove("armed");
}

forgetAllButton.addEventListener("click", () => {
  if (armed) {
    disarm();
    chrome.storage.local.set({ rules: { hosts: {}, exts: {} } }, () => {
      ruleStatus.textContent = "Forgot everything.";
      renderRules({ hosts: {}, exts: {} });
    });
    return;
  }

  ruleStatus.textContent = "Click again to forget all of them.";
  forgetAllButton.classList.add("armed");
  armed = setTimeout(() => {
    disarm();
    ruleStatus.textContent = "";
  }, ARM_TIMEOUT_MS);
});

chrome.storage.local.get(
  { folder: DEFAULT_FOLDER, configured: false, downloadDir: "" },
  (stored) => {
    saved = sanitize(stored.folder) || DEFAULT_FOLDER;
    downloadDir = stored.downloadDir;
    needsSetup = !stored.configured;
    input.value = saved;
    setEditing(needsSetup);
  }
);

loadRules();

// A download starting while this page is open is what teaches the path on a
// fresh install, so the placeholder can be replaced live.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.downloadDir) {
    downloadDir = changes.downloadDir.newValue || "";
    render();
  }
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
    setEditing(false);
  });
}

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
// will go. The fallback is not an error, so it does not read like one.
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

// The front page and this one are the same popup, so going back is a navigation
// rather than anything closing.
document.getElementById("back").addEventListener("click", () => {
  location.replace("options.html");
});
