const params = new URLSearchParams(location.search);
const id = Number(params.get("id"));

// Connecting immediately is what keeps the service worker alive while this
// window is open. The held suggest() callback lives in that worker, so if it
// were torn down the download would hang with no way to answer it.
const port = chrome.runtime.connect({ name: `prompt-${id}` });

// The download ran out of time while this was on screen. Nothing here is worth
// answering any more, so the popup becomes the settings view, which is what it
// would have been had the prompt never appeared.
port.onMessage.addListener((msg) => {
  if (msg?.type === "tempdl-timeout") location.replace("options.html");
  // More downloads started while this was on screen. They are covered by
  // whatever is answered here, so the wording has to say so.
  if (msg?.type === "tempdl-count") showWaiting(msg.count);
  if (msg?.type === "tempdl-remaining") startCountdown(msg.ms, msg.total);
});

// Handed the time left rather than the full timeout, because the clock started
// with the download and this page may have opened well after that. The bar is
// animated in one go instead of ticked, so it stays smooth without a timer of
// its own, and the background remains the only thing that decides when the
// download actually expires.
const countdown = document.getElementById("countdown");
const countdownBar = countdown.firstElementChild;

function startCountdown(ms, total) {
  if (!(ms > 0) || !(total > 0)) return;

  countdown.hidden = false;
  countdownBar.style.transition = "none";
  countdownBar.style.width = `${Math.min(100, (ms / total) * 100)}%`;
  // Read a layout value so the width above is applied before the transition is
  // attached, otherwise both changes collapse into one frame and nothing moves.
  void countdownBar.offsetWidth;
  countdownBar.style.transition = `width ${ms}ms linear`;
  countdownBar.style.width = "0%";
}

document.getElementById("name").textContent = params.get("name") || "download";

const bytes = Number(params.get("size")) || 0;
const host = params.get("host") || "";
document.getElementById("meta").textContent =
  [format(bytes), host && `from ${host}`].filter(Boolean).join(", ");

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

// The Save as dialog only exists on a second fetch of the URL, which a blob or
// data URL does not survive: it belongs to the page that built it. The choice
// still stands, it just cannot ask where, so the button says what it will
// actually do instead of promising a dialog.
if (params.get("reissue") !== "1") {
  document.getElementById("save").textContent = "Save (Download Folder)";
  document.getElementById("noSaveAs").hidden = false;
}

// Downloads that arrive together are answered together. Asking about each one
// in turn cannot work: they all started at the same moment, and the browser
// stops waiting on each of them 15 seconds after that, whether or not its
// prompt has been seen yet. This file is simply the one being named.
const batch = document.getElementById("batch");

function showWaiting(count) {
  batch.hidden = !(count > 1);
  if (count > 1) {
    batch.textContent = `${count} files are waiting. Your choice applies to all of them.`;
  }
}

showWaiting(Number(params.get("count")) || 1);

// An answer worth keeping, so the same question is not put again. Each box
// needs something to key on: a blob URL has no host, and a name with no
// extension has no type, so an offer that could not be honoured is not made.
const remember = document.getElementById("remember");
const rememberSite = document.getElementById("rememberSite");
const rememberType = document.getElementById("rememberType");

// Named rather than described. "This site" is ambiguous on a page that
// redirected, and the extension keys on the host it actually saw, so the label
// says which one that is, set as a text node because a host is whatever a page
// called itself. The name is the part being agreed to, so it is marked up as
// the literal it is rather than left to blend into the sentence.
const ext = params.get("ext") || "";

function label(node, value) {
  const literal = document.createElement("code");
  literal.textContent = value;
  node.textContent = "Remember my choice for ";
  node.appendChild(literal);
}

label(document.getElementById("typeLabel"), `.${ext}`);
label(document.getElementById("siteLabel"), host);

document.getElementById("siteRow").hidden = !host;
document.getElementById("typeRow").hidden = !ext;
remember.hidden = !host && !ext;

let sent = false;
function choose(choice) {
  // The background closes this window on receipt. Guard against a double
  // click landing two choices on the same download.
  if (sent) return;
  sent = true;
  chrome.runtime.sendMessage({
    type: "tempdl-choice",
    id,
    choice,
    remember: { host: rememberSite.checked, ext: rememberType.checked },
  });
  // As a popup this closes itself; as a fallback window the background closes
  // it too, and whichever happens first is harmless.
  window.close();
}

document.getElementById("temp").addEventListener("click", () => choose("temp"));
document.getElementById("save").addEventListener("click", () => choose("save"));
document.getElementById("cancel").addEventListener("click", () => choose("cancel"));

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") choose("cancel");
  if (e.key === "Enter") choose("temp");
});

document.getElementById("temp").focus();
