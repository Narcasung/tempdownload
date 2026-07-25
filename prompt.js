const params = new URLSearchParams(location.search);
const id = Number(params.get("id"));

// Connecting immediately is what keeps the service worker alive while this
// window is open. The held suggest() callback lives in that worker, so if it
// were torn down the download would hang with no way to answer it.
chrome.runtime.connect({ name: `prompt-${id}` });

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

let sent = false;
function choose(choice) {
  // The background closes this window on receipt. Guard against a double
  // click landing two choices on the same download.
  if (sent) return;
  sent = true;
  chrome.runtime.sendMessage({ type: "tempdl-choice", id, choice });
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
