// The popup's front page. It is where a download is dealt with, so it says
// nothing at all when there is nothing to report: settings and remembered
// choices are one step away behind the cog, and a page that showed them by
// default would put the least urgent thing in the most prominent place.
//
// The folder field lives on that other page, so a profile with no folder saved
// is sent there rather than being asked here.

const DEFAULT_FOLDER = "_Temp";

const status = document.getElementById("status");
const askWarning = document.getElementById("askWarning");
const orphanWarning = document.getElementById("orphanWarning");
const orphanText = document.getElementById("orphanText");
const orphanOpen = document.getElementById("orphanOpen");
const orphanDismiss = document.getElementById("orphanDismiss");
const advancedButton = document.getElementById("advanced");

// Must match sanitize() in bg.js: a single path segment, safe on Windows.
function sanitize(name) {
  return String(name ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 64);
}

// Only needed here to name the folder the orphan warning points at.
let saved = DEFAULT_FOLDER;

// Files the extension put in a temp folder and can no longer delete, because
// the browser dropped their download history entry. Only the count is shown:
// nothing here can read the folder, so naming files that the user may well
// have deleted by hand would claim more than is known.
function renderOrphans(orphans) {
  const files = Array.isArray(orphans) ? orphans : [];
  orphanWarning.hidden = !files.length;
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
    toast: null,
  },
  (stored) => {
    // Setup is the one thing that cannot wait behind a cog.
    if (!stored.configured) {
      location.replace("settings.html");
      return;
    }

    saved = sanitize(stored.folder) || DEFAULT_FOLDER;
    askWarning.hidden = !stored.askWhereWarning;
    renderOrphans(stored.orphans);
    showToast(stored.toast);
    if (stored.toast) chrome.storage.local.remove("toast");
  }
);

// The detection happens in the background as downloads complete, so the page
// has to react while it is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.askWhereWarning) askWarning.hidden = !changes.askWhereWarning.newValue;
  // "Clear now" runs a sweep, which is also what finds untracked files, so the
  // warning can appear while the page is open.
  if (changes.orphans) renderOrphans(changes.orphans.newValue);
});

advancedButton.addEventListener("click", () => {
  location.replace("settings.html");
});

// The files are beyond reach, so acknowledging them is the only thing left to
// do. Final for those files: they left the ledger when they were detected, so
// no later sweep can find them again. The next sweep clears the report anyway,
// this only skips the wait.
orphanDismiss.addEventListener("click", () => {
  chrome.storage.local.set({ orphans: [] });
  orphanWarning.hidden = true;
});

// Must match inFolder() in bg.js. Windows paths are case-insensitive.
function inFolder(path, folder) {
  return String(path ?? "")
    .split(/[\\/]/)
    .some((seg) => seg.toLowerCase() === folder.toLowerCase());
}

// No API takes a path, so the folder can only be reached through a download
// that is still in the history: show() opens the folder that file sits in.
// Once a sweep has erased those entries there is nothing left to point at, and
// the download directory one level up is the closest the browser will go.
orphanOpen.addEventListener("click", () => {
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
});
