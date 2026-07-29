// Everything the prompt was told to remember, and the only way to unsay it.
// A rule answers downloads without showing anything, so a forgotten one has no
// other place it could be found.

const sites = document.getElementById("sites");
const types = document.getElementById("types");
const siteBlock = document.getElementById("siteBlock");
const typeBlock = document.getElementById("typeBlock");
const emptyNote = document.getElementById("empty");
const precedence = document.getElementById("precedence");
const status = document.getElementById("status");

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

function render(rules) {
  const hosts = Object.keys(rules.hosts).sort();
  const exts = Object.keys(rules.exts).sort();

  sites.textContent = "";
  types.textContent = "";
  for (const host of hosts) sites.appendChild(row("hosts", host, rules.hosts[host]));
  for (const ext of exts) types.appendChild(row("exts", ext, rules.exts[ext]));

  siteBlock.hidden = !hosts.length;
  typeBlock.hidden = !exts.length;
  emptyNote.hidden = hosts.length || exts.length;
  // Only worth explaining when both kinds exist, since that is the only time
  // one can lose to the other.
  precedence.hidden = !(hosts.length && exts.length);
}

function load() {
  chrome.storage.local.get({ rules: null }, ({ rules }) => {
    render({ hosts: rules?.hosts ?? {}, exts: rules?.exts ?? {} });
  });
}

function forget(kind, key) {
  chrome.storage.local.get({ rules: null }, ({ rules }) => {
    const next = { hosts: { ...(rules?.hosts ?? {}) }, exts: { ...(rules?.exts ?? {}) } };
    delete next[kind][key];
    chrome.storage.local.set({ rules: next }, () => {
      status.textContent = `Forgot ${kind === "exts" ? `.${key}` : key}.`;
      render(next);
    });
  });
}

// Settings and this page are the same popup, so going back is a navigation
// rather than anything closing.
document.getElementById("back").addEventListener("click", () => {
  location.replace("options.html");
});

load();
