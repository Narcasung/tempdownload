// The popup's front page. It is where a download is dealt with, so it says
// nothing at all when there is nothing to report: settings and remembered
// choices are one step away behind the cog, and a page that showed them by
// default would put the least urgent thing in the most prominent place.
//
// What it does report is the temp folder's contents, since nothing else can:
// the folder is wiped on a schedule the user did not choose, so what is sitting
// in it is worth knowing before the next browser start takes it.
//
// The folder field lives on that other page, so a profile with no folder saved
// is sent there rather than being asked here.

const DEFAULT_FOLDER = "_Temp";

const status = document.getElementById("status");
const sweptStatus = document.getElementById("sweptStatus");
const askWarning = document.getElementById("askWarning");
const orphanWarning = document.getElementById("orphanWarning");
const orphanText = document.getElementById("orphanText");
const orphanOpen = document.getElementById("orphanOpen");
const orphanDismiss = document.getElementById("orphanDismiss");
const advancedButton = document.getElementById("advanced");
const current = document.getElementById("current");
const openButton = document.getElementById("open");
const list = document.getElementById("list");
const sweepRow = document.getElementById("sweepRow");
const clearButton = document.getElementById("clear");

// Must match sanitize() in bg.js: a single path segment, safe on Windows.
function sanitize(name) {
  return String(name ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 64);
}

// Names the folder the orphan warning points at, and picks the downloads the
// list below is made of.
let saved = DEFAULT_FOLDER;

// Folders the temp folder used to be called. The sweep still collects from
// them, so the list has to show them too or Clear all would take away files
// that were never on screen.
let folders = [DEFAULT_FOLDER];

// The browser's download directory, learned in bg.js from the first download
// seen. Empty until then, which is the case on a fresh install.
let downloadDir = "";

// Must match tempPath() in settings.js. The full path, since it is the thing
// the user goes looking for, with a trailing separator so it reads as a folder
// rather than a file. Until a temp download has taught the directory there is
// nothing to show but a description of it.
function tempPath(folder) {
  if (!downloadDir) return `<download folder>\\${folder}\\`;
  const sep = downloadDir.includes("\\") ? "\\" : "/";
  return `${downloadDir}${sep}${folder}${sep}`;
}

// Marked up as the literal it is, and built as a node so nothing interprets a
// path the user typed part of.
function renderPath() {
  const path = document.createElement("code");
  path.textContent = tempPath(saved);
  current.textContent = "";
  current.appendChild(path);
}

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

// A leaf, for a folder that has just been emptied. Drawn rather than shipped as
// an asset so it follows a colour in both themes and stays sharp at any scale.
//
// Not an outline to be stroked: the shape is its own outline, one path holding
// the leaf's edge, the vein and the stem as a set of closed contours with the
// interior wound the other way, so the nonzero rule leaves it hollow. It is
// drawn upright in a 90 unit square, which is why it arrives under a transform
// rather than in the coordinates it is used in.
//
// The transform rotates it a third of a turn clockwise, to lean the way the
// other marks on these pages do, then fits the result to the 24 unit box the
// rest of the icons are drawn in. Rotating first and measuring after is what
// makes it fit: a leaf on the diagonal is wider than the one that was upright,
// so scaling to the upright bounds would push the tip out of the box.
//
// It carries a stroke as well as a fill, which is the part that is not simply
// the artwork. Its walls are about two units of ninety, a fifth of a pixel once
// this is 18px on a line of text, and they come out grey and broken. The stroke
// follows the same contours and thickens them from both sides, so the walls are
// the artwork's own shape at a weight that survives being this small.
const SVG_NS = "http://www.w3.org/2000/svg";
const LEAF =
  "M 30.648 90 h -4.666 c -0.276 0 -0.54 -0.114 -0.729 -0.315 c -0.189 -0.202 -0.287 -0.473 -0.269 -0.748 " +
  "c 1.473 -23.129 7.78 -37.706 23.516 -52.984 c -11.987 6.803 -23.657 18.781 -25.661 35.247 " +
  "c -0.051 0.42 -0.361 0.763 -0.774 0.854 c -0.414 0.094 -0.84 -0.086 -1.065 -0.443 " +
  "c -8.808 -14.02 -8.505 -26.712 0.952 -39.944 c 5.454 -7.272 13.28 -11.279 20.185 -14.815 " +
  "c 8.346 -4.273 15.554 -7.964 17.098 -16.04 c 0.078 -0.407 0.398 -0.723 0.807 -0.796 " +
  "c 0.407 -0.073 0.818 0.113 1.032 0.467 c 10.854 17.977 19.798 35.828 10.159 56.542 " +
  "c -7.694 13.752 -20.459 20.112 -37.994 18.96 c -1.01 4.324 -1.531 8.595 -1.59 13.028 " +
  "C 31.641 89.561 31.195 90 30.648 90 z " +
  "M 27.052 88 h 2.617 c 0.129 -4.515 0.728 -8.881 1.825 -13.313 c 0.118 -0.475 0.554 -0.793 1.049 -0.757 " +
  "c 17.367 1.366 29.437 -4.464 36.911 -17.814 c 8.859 -19.047 1.472 -35.189 -8.879 -52.575 " +
  "c -2.563 7.429 -9.851 11.161 -17.526 15.091 c -7.04 3.604 -14.319 7.332 -19.483 14.216 " +
  "c -8.376 11.72 -9.128 23.011 -2.278 35.324 c 3.534 -18.634 18.924 -31.329 32.625 -37.12 " +
  "c 0.452 -0.192 0.977 -0.027 1.237 0.39 c 0.261 0.416 0.181 0.959 -0.188 1.283 " +
  "C 36.16 49.192 28.777 63.753 27.052 88 z";

// Read right to left, as transforms are applied: bring the artwork's centre to
// the origin, turn it, shrink it, then put the centre back in the middle of the
// box. The numbers are measured from the rotated shape rather than guessed.
const LEAF_TRANSFORM = "translate(12.413 11.928) scale(.26826) rotate(35) translate(-44.98 -45)";

function leafIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "leaf");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");

  const group = document.createElementNS(SVG_NS, "g");
  group.setAttribute("transform", LEAF_TRANSFORM);

  const path = document.createElementNS(SVG_NS, "path");
  path.setAttribute("d", LEAF);
  path.setAttribute("fill", "currentColor");
  path.setAttribute("fill-rule", "nonzero");
  path.setAttribute("stroke", "currentColor");
  // In the artwork's own units, so the group's scale takes it down with
  // everything else and it ends up about two thirds of a unit in the box.
  path.setAttribute("stroke-width", "2.5");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");

  group.appendChild(path);
  svg.appendChild(group);
  return svg;
}

// Emptied rather than hidden, because .status:empty is what takes the line out
// of the page, and a leaf left behind on its own would keep it there with
// nothing to say. Setting the text is also what clears the last leaf.
function showSwept(text) {
  sweptStatus.textContent = text || "";
  if (text) sweptStatus.appendChild(leafIcon());
}

chrome.storage.local.get(
  {
    folder: DEFAULT_FOLDER,
    configured: false,
    askWhereWarning: false,
    orphans: [],
    retired: [],
    downloadDir: "",
    swept: "",
    toast: null,
  },
  (stored) => {
    // Setup is the one thing that cannot wait behind a cog.
    if (!stored.configured) {
      location.replace("settings.html");
      return;
    }

    saved = sanitize(stored.folder) || DEFAULT_FOLDER;
    // Same set the sweep works from, in the same order, so the list and the
    // button that empties it never disagree about what counts.
    folders = [saved, ...stored.retired.map(sanitize)].filter(Boolean);
    downloadDir = stored.downloadDir;
    renderPath();
    askWarning.hidden = !stored.askWhereWarning;
    renderOrphans(stored.orphans);
    // Read rather than consumed, unlike the toast: the background is what
    // decides when it has been answered, and until then every opening of the
    // popup says the same thing.
    showSwept(stored.swept);
    showToast(stored.toast);
    if (stored.toast) chrome.storage.local.remove("toast");
    refresh();
  }
);

// The detection happens in the background as downloads complete, so the page
// has to react while it is open.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes.askWhereWarning) askWarning.hidden = !changes.askWhereWarning.newValue;
  // Clear all runs a sweep, which is also what finds untracked files, so the
  // warning can appear while the page is open, put there by the button beneath
  // it.
  if (changes.orphans) renderOrphans(changes.orphans.newValue);
  // Pressing Clear all is the common case: the sweep runs in the background and
  // the count only exists once every file has come back, so the line is filled
  // in from here rather than by the click.
  if (changes.swept) showSwept(changes.swept.newValue);
  // A download starting while this page is open is what teaches the path on a
  // fresh install, so the placeholder can be replaced live.
  if (changes.downloadDir) {
    downloadDir = changes.downloadDir.newValue || "";
    renderPath();
  }
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

// The orphan warning points at the same folder, and the files it is about are
// the ones the list below cannot show: their history entries are gone, so the
// only way to reach them is the folder they are sitting in.
orphanOpen.addEventListener("click", openTempFolder);

// WHAT IS IN THE FOLDER
//
// The download history filtered to the folders the sweep collects from, which
// is as close to reading the directory as an extension gets. Files put there by
// hand are invisible to this, the same way they are invisible to the sweep.
//
// Newest first, because the temp folder is where a file lands when the answer
// was "I only need this now", and the one just downloaded is the one being
// looked for.

const baseName = (path) => (path ?? "").split(/[\\/]/).pop();

// Same as the prompt's, so a size reads the same wherever it is shown.
function format(n) {
  if (!n) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

// A name and a size, and nothing to press. The list answers what is in the
// folder and how much of it there is; opening a file, showing it and deleting
// it are all a click away in the file manager the Open button above reaches,
// and every one of them was a second way to do something already provided.
// What is left is a list rather than a set of controls, and reads as one.
//
// Built as nodes rather than markup: a file name is whatever a server called
// it, so nothing here interprets it.
function fileRow(item) {
  const row = document.createElement("div");
  row.className = "dl";

  const name = document.createElement("div");
  name.className = "dl-name";
  name.textContent = baseName(item.filename);
  // The only place a file in a folder the temp folder used to be called can be
  // told apart from one in the current folder.
  name.title = item.filename;

  // What is on disk once it has landed, and what is expected while it is still
  // arriving. Either way it is the number the folder's size is made of.
  const size = document.createElement("span");
  size.className = "dl-size";
  size.textContent = format(item.fileSize || item.totalBytes || 0);

  row.append(name, size);
  return row;
}

// In one of the folders the sweep collects from, and with something at the end
// of it: an interrupted download never produced a file, and exists: false is
// the browser saying the file has gone from disk since.
function keep(item) {
  return (
    item.state !== "interrupted" &&
    item.exists !== false &&
    folders.some((f) => inFolder(item.filename, f))
  );
}

function render(items) {
  list.textContent = "";
  for (const item of items) list.appendChild(fileRow(item));

  // An empty folder is nothing to report, and the front page reports nothing
  // when it has nothing to say. An empty panel is worse than none, and the
  // button goes with it rather than sitting alone offering to empty what is
  // already empty.
  list.hidden = !items.length;
  sweepRow.hidden = !items.length;
}

function load() {
  chrome.downloads.search({ orderBy: ["-startTime"] }, (items) => {
    if (chrome.runtime.lastError) {
      console.warn("[tempdl] listing failed", chrome.runtime.lastError.message);
      return;
    }
    render((items || []).filter(keep));
  });
}

// A sweep erases every entry it took and fires an event for each one, and a
// single download reports its path more than once as it settles. The list only
// has to be right once the last of them has landed.
let queued = null;

function refresh() {
  clearTimeout(queued);
  queued = setTimeout(load, 60);
}

chrome.downloads.onCreated.addListener(refresh);
chrome.downloads.onChanged.addListener(refresh);
chrome.downloads.onErased.addListener(refresh);

// The sweep is the background's to run: it knows the retired folder names, it is
// what reconciles the ledger afterwards, and it is the only thing that can count
// what was actually taken off disk. Nothing is said here, because saying it now
// would mean guessing that number before any file had been touched.
clearButton.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "tempdl-sweep" });
});
