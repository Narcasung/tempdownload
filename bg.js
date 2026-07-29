// Firefox-style download handling for Chromium browsers.
//
// On every download, hold the filename decision open and ask the user what to
// do. Three branches:
//
//   Download (Temp) -> file goes to <download dir>/<folder>/, wiped at startup
//   Save as         -> original is cancelled and re-issued with saveAs: true
//   Cancel          -> download is cancelled and erased
//
// suggest() takes a path RELATIVE to the browser's download directory. There is
// no way to write to an arbitrary absolute location, which is why the temp
// folder is configured as a NAME rather than picked as a path. See options.html.
//
// Nothing here launches files. The browser's own download button already opens
// them, and doing it again from the popup would only be a second way in.
//
// Cleanup goes through the download history, not the filesystem, so files whose
// history entry is gone stay on disk. The File System Access API can read the
// folder and was tried: a directory handle does survive in IndexedDB and does
// work in this worker, but its permission does not survive a browser restart,
// and renewing it needs a user gesture that a browser start has none of. That
// made the wipe depend on a click every session, so it was dropped.

const DEFAULT_FOLDER = "_Temp";

// If the user never answers, cancel. Nothing is written, which is the only
// outcome that cannot leave a file somewhere it was never meant to be.
//
// This has to beat the browser to it. A held suggest() is not waited on
// forever: measured at 15 seconds, after which the browser places the file in
// the download directory itself and ignores any answer that arrives later. So
// the window to decide is 15 seconds from the moment the download starts, not
// from the moment its prompt is seen. That is why one prompt answers for every
// download waiting rather than each getting a turn.
const CHOICE_TIMEOUT_MS = 14000;

// suggest() is a live callback, so it cannot be serialised to storage and this
// map is unavoidably in-memory. A port held open by the prompt window keeps the
// service worker alive while a decision is outstanding; see onConnect below.
const pending = new Map(); // downloadId -> { suggest, item, windowId, timer }
const byWindow = new Map(); // windowId -> downloadId

// The port each prompt page opened, kept so the page can be told to stand down
// when its download is answered for it rather than by it.
const ports = new Map(); // downloadId -> port

// URLs we are re-issuing for "Save as". The second download must not be
// intercepted again, or it would prompt forever.
const bypass = new Set();

// Downloads sent to the temp folder, mapped to the time the path was suggested.
// See the onChanged listener that checks how they landed.
const expectTemp = new Map();

// With no file picker in the way, the browser settles a download's target path
// almost immediately after suggest() answers. Anything slower means something
// waited for a human.
const PICKER_DELAY_MS = 1200;

const baseName = (path) => (path ?? "").split(/[\\/]/).pop();

// A single path segment, safe on Windows. Anything that could escape the
// download directory or break suggest() is stripped rather than rejected.
function sanitize(name) {
  return String(name ?? "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 64);
}

// `configured` stays false until the user actually saves a folder name. Until
// then the extension keeps out of the way entirely: downloads behave exactly as
// they would without it, and nothing is written to a location the user never
// agreed to.
let configCache = null;

function getConfig() {
  if (configCache) return Promise.resolve(configCache);
  return chrome.storage.local
    .get({ folder: DEFAULT_FOLDER, configured: false })
    .then(({ folder, configured }) => {
      configCache = { folder: sanitize(folder) || DEFAULT_FOLDER, configured };
      return configCache;
    });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  configCache = null;

  if (changes.configured?.newValue) clearSetupBadge();
  if (!changes.folder) return;

  const previous = sanitize(changes.folder.oldValue);
  const next = sanitize(changes.folder.newValue) || DEFAULT_FOLDER;
  console.log("[tempdl] temp folder is now", next);

  // Renaming would otherwise strand whatever is still in the old folder: sweep
  // matches on folder name, so files there would never be collected again.
  // Remember past names and keep sweeping them.
  if (!previous || previous === next) return;
  chrome.storage.local.get({ retired: [] }, ({ retired }) => {
    if (retired.includes(previous)) return;
    chrome.storage.local.set({ retired: [...retired, previous].slice(-10) });
  });
});

// Only an address the extension can fetch on its own can be downloaded a second
// time. blob:, data: and filesystem: URLs are held by the page that made them
// and die with it.
const canReissue = (url) => /^https?:/i.test(url ?? "");

// Windows paths are case-insensitive, so the comparison has to be too.
const inFolder = (path, folder) =>
  (path ?? "")
    .split(/[\\/]/)
    .some((seg) => seg.toLowerCase() === folder.toLowerCase());

// PROMPT

// No API reports the browser's download directory. It is only ever visible as
// the parent of a settled temp file, so it is recorded when one lands. Kept
// only so the options page can name a real folder instead of describing one.
// Goes stale if the directory is moved in browser settings, and the next temp
// download corrects it.
function learnDownloadDir(path, folder) {
  const parts = path.split(/[\\/]/);
  const at = parts.findIndex((seg) => seg.toLowerCase() === folder.toLowerCase());
  // Nothing above the temp folder means nothing to learn.
  if (at <= 0) return;

  const dir = parts.slice(0, at).join(path.includes("\\") ? "\\" : "/");
  chrome.storage.local.get({ downloadDir: "" }, ({ downloadDir }) => {
    if (downloadDir === dir) return;
    console.log("[tempdl] download directory is", dir);
    chrome.storage.local.set({ downloadDir: dir });
  });
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  if (bypass.delete(item.url)) {
    console.log("[tempdl] bypass (save-as re-issue)", item.id);
    suggest();
    return;
  }

  getConfig().then(({ configured }) => {
    if (!configured) {
      // Setup was never completed, so stay out of it and let the download go
      // wherever it normally would.
      console.log("[tempdl] not configured, ignoring", item.id);
      suggest();
      return;
    }

    console.log("[tempdl] asking about", item.id, item.filename);
    const entry = { suggest, item, windowId: null, timer: null, askedAt: Date.now() };
    entry.timer = setTimeout(() => {
      console.warn("[tempdl] no answer for", item.id, "cancelling");
      // Resolve first: the prompt page unloads as it navigates, which would
      // otherwise arrive as a dismissal and answer the download twice.
      // Read before resolving, which clears what is showing.
      const port = showing === null ? null : ports.get(showing);
      resolveAll("cancel");

      chrome.storage.local.set({ toast: { text: "Download timed out", at: Date.now() } });
      port?.postMessage({ type: "tempdl-timeout" });
    }, CHOICE_TIMEOUT_MS);
    pending.set(item.id, entry);

    showPrompt(item);
  });

  return true; // suggest() will be called later
});

// An extension has exactly one popup, so simultaneous downloads cannot each get
// a prompt. They are not queued either: a queue would ask about them one at a
// time while all of them are spending the same 15 seconds, so the later ones
// would expire before their turn came. Worse, showing the next one means
// openPopup(), which fails whenever the fallback window has focus, and every
// prompt after that becomes another window.
//
// So there is one prompt, and it answers for everything waiting.
let showing = null;

function promptUrl(item) {
  const params = new URLSearchParams({
    id: String(item.id),
    name: baseName(item.filename) || "download",
    size: String(item.totalBytes ?? item.fileSize ?? 0),
    host: hostOf(item.url) || hostOf(item.finalUrl) || "",
    // Temp and Cancel work on any download. Save as is the only branch that
    // needs the URL a second time, so the prompt is told whether to offer it.
    reissue: canReissue(item.url) ? "1" : "0",
    // How many downloads this one prompt is answering for.
    count: String(pending.size),
  });
  return `prompt.html?${params}`;
}

function showPrompt(item) {
  // Already asking. The prompt on screen covers this download too, so it is
  // told the new total rather than a second one being opened.
  if (showing !== null) {
    announce();
    return;
  }

  const entry = pending.get(item.id);
  if (!entry) return;

  showing = item.id;
  chrome.action.setPopup({ popup: promptUrl(item) });
  announce();

  const opening = chrome.action.openPopup?.();
  if (!opening?.catch) return;
  opening.catch((e) => {
    // openPopup() rejects when no browser window is focused. Falling back to a
    // real window keeps the download from hanging until the timeout.
    console.log("[tempdl] popup refused for", item.id, e.message, "using a window");
    openPromptWindow(entry);
  });
}

// The badge is what tells the user to click when the popup could not be opened.
// The prompt itself is told too, so its wording keeps up with downloads that
// started after it appeared.
function announce() {
  const count = pending.size;
  chrome.action.setBadgeText({ text: count ? String(count) : "" });
  chrome.action.setBadgeBackgroundColor({ color: "#2a78d6" });
  if (showing !== null) ports.get(showing)?.postMessage({ type: "tempdl-count", count });
}

// How long the prompt has left. The first download to run out cancels the whole
// batch, so the deadline that matters is the earliest one, not this page's own.
// Measured rather than assumed: a prompt can be opened well after the download
// it is asking about started, from the badge.
function remainingMs() {
  let soonest = Infinity;
  for (const entry of pending.values()) {
    soonest = Math.min(soonest, entry.askedAt + CHOICE_TIMEOUT_MS - Date.now());
  }
  return Number.isFinite(soonest) ? Math.max(0, soonest) : 0;
}

// Nothing left to ask about, so the icon goes back to being the settings button.
function stopAsking() {
  showing = null;
  chrome.action.setPopup({ popup: "options.html" });
  chrome.action.setBadgeText({ text: "" });
}

function openPromptWindow(entry) {
  chrome.windows.create(
    {
      url: chrome.runtime.getURL(promptUrl(entry.item)),
      type: "popup",
      width: 460,
      height: 260,
      focused: true,
    },
    (win) => {
      if (!win) return;
      if (!pending.has(entry.item.id)) {
        // Already resolved, so clean up the orphan window rather than leaving
        // it on screen.
        chrome.windows.remove(win.id, ignoreError);
        return;
      }
      entry.windowId = win.id;
      byWindow.set(win.id, entry.item.id);
    }
  );
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function resolve(id, choice) {
  const entry = pending.get(id);
  if (!entry) return;
  pending.delete(id);
  clearTimeout(entry.timer);

  const windowId = entry.windowId;
  entry.windowId = null;
  if (windowId != null) {
    byWindow.delete(windowId);
    chrome.windows.remove(windowId, ignoreError);
  }

  if (pending.size === 0) stopAsking();
  else announce();

  console.log("[tempdl] choice", id, choice);

  // Answering suggest() asynchronously is legal because the listener returned
  // true; the download stays parked until this resolves.
  getConfig().then(({ folder }) => {
    const toTemp = () =>
      entry.suggest({
        filename: `${folder}/${entry.item.filename}`,
        conflictAction: "uniquify",
      });

    if (choice === "save") {
      // suggest() must be answered before the download can be touched at all,
      // but the answer has to be the plain default rather than the temp folder.
      // The browser remembers the last download directory, so a detour through
      // the temp folder would become the Save As dialog's starting location.
      // If the cancel below loses its race, abort() deletes the stray copy.
      entry.suggest();

      // Re-issuing means fetching the URL again from here, which only works for
      // an address this extension can actually reach. A blob URL belongs to the
      // page that created it and is unreachable from another origin, so the
      // second download fails, names itself after the blob's id, and the
      // original is already gone. Letting the original finish puts the file in
      // the download folder under its proper name, which is where "save as" was
      // headed anyway, just without the chance to pick the folder.
      if (!canReissue(entry.item.url)) {
        console.warn("[tempdl] cannot re-issue", id, entry.item.url.slice(0, 32), "keeping the original");
        return;
      }

      bypass.add(entry.item.url);
      abort(id, () => {
        chrome.downloads.download({ url: entry.item.url, saveAs: true }, (newId) => {
          if (chrome.runtime.lastError) {
            // POST-initiated downloads and one-shot blob URLs cannot be
            // replayed. Nothing to fall back to, since the bytes are gone.
            console.error("[tempdl] save-as re-issue failed:", chrome.runtime.lastError.message);
            bypass.delete(entry.item.url);
            return;
          }
          console.log("[tempdl] re-issued as", newId);
        });
      });
      return;
    }

    if (choice === "cancel") {
      // Same reasoning as above: nothing is meant to survive this, so keep the
      // temp folder out of the browser's last-used-directory memory.
      entry.suggest();
      abort(id);
      return;
    }

    // Save as and Cancel still work on a file the browser placed early, since
    // both act on the download rather than on where it was heading. Temp is the
    // one that cannot: there is no API to move a finished download, so the file
    // stays where the browser put it.
    if (entry.lost) {
      console.warn("[tempdl]", id, "already at", entry.lost, "and temp cannot move it");
      return;
    }

    expectTemp.set(id, Date.now());
    toTemp();
  });
}

// The browser setting "Ask where to save each file before downloading" turns
// suggest() into nothing more than the file picker's default, which the user
// can then accept or navigate away from. No API exposes that preference, so it
// has to be inferred from how a temp download behaves. Three tells, any one of
// which is enough:
//
//   1. the file landed outside the temp folder
//   2. the target path took human-scale time to settle
//   3. the download was cancelled before a path was ever assigned
//
// Landing inside the folder proves nothing on its own, because suggest() also
// supplies the picker's default location.
chrome.downloads.onChanged.addListener((delta) => {
  const suggestedAt = expectTemp.get(delta.id);
  if (suggestedAt === undefined) return;

  // Dismissing the picker interrupts the download before it starts.
  if (delta.error?.current === "USER_CANCELED") {
    expectTemp.delete(delta.id);
    flagPicker(true, "temp download cancelled before a path was assigned");
    return;
  }

  const path = delta.filename?.current;
  if (!path) return;
  expectTemp.delete(delta.id);

  const elapsed = Date.now() - suggestedAt;
  getConfig().then(({ folder }) => {
    if (!inFolder(path, folder)) {
      flagPicker(true, `temp download landed outside ${folder} at ${path}`);
      return;
    }
    if (elapsed > PICKER_DELAY_MS) {
      flagPicker(true, `temp download path took ${elapsed}ms to settle`);
      return;
    }
    flagPicker(false, `settled in ${elapsed}ms`);
  });
});

// A download still waiting on an answer should not be moving at all: suggest()
// has not been called for it, so nothing has told the browser where to put it.
// Anything logged here resolved without going through this extension.
chrome.downloads.onChanged.addListener((delta) => {
  const entry = pending.get(delta.id);
  if (!entry || !delta.filename?.current) return;

  // The browser ran out of patience and placed the file itself. Whatever is
  // answered from here on cannot move it, so record that rather than let the
  // answer look as though it took effect.
  entry.lost = delta.filename.current;
  console.warn(
    "[tempdl] browser placed", delta.id, "itself after",
    Date.now() - entry.askedAt, "ms at", delta.filename.current
  );
});

// Recorded either way, so turning the setting back off clears the warning on
// the next temp download instead of leaving it stuck on.
function flagPicker(detected, why) {
  console[detected ? "warn" : "log"]("[tempdl] save-location picker:", detected, why);
  chrome.storage.local.set({ askWhereWarning: detected });
}

// LEDGER
//
// The sweep can only reach downloads the browser still lists in its history.
// Clearing browsing data erases those entries while the files themselves stay
// on disk, out of reach of anything this extension can do. The ledger is what
// makes that visible: every file sent to a temp folder is written down, and
// anything still on the books but missing from the history at sweep time is
// reported to the user, who is the only one left who can delete it. Each file
// is detected once, by the first sweep that misses it, and the report lasts
// until the next sweep restates what it found.
//
// This is a record of what was put there, not a reading of the folder. An
// extension cannot enumerate a directory, so files the user deleted by hand are
// indistinguishable from files still sitting there. The wording in options.html
// says "may" for that reason.

const LEDGER_MAX = 500;
const ORPHAN_MAX = 100;

// storage.local offers no atomic read-modify-write and downloads settle in
// parallel, so every change to the ledger goes through one chain.
let ledgerQueue = Promise.resolve();

function withLedger(mutate) {
  ledgerQueue = ledgerQueue
    .then(async () => {
      const stored = await chrome.storage.local.get({ ledger: [], orphans: [] });
      const next = mutate(stored);
      if (next) await chrome.storage.local.set(next);
    })
    .catch((e) => console.warn("[tempdl] ledger update failed:", e.message));
  return ledgerQueue;
}

// Driven by the download itself rather than by what the prompt decided, so a
// service worker that was torn down and restarted in between still records the
// file. Also catches downloads the user steered into the folder by hand.
chrome.downloads.onChanged.addListener((delta) => {
  const path = delta.filename?.current;
  if (!path) return;

  getConfig().then(({ configured, folder }) => {
    if (!configured || !inFolder(path, folder)) return;

    // This is the one place a path inside the temp folder is known in full.
    learnDownloadDir(path, folder);

    withLedger(({ ledger }) => {
      const known = ledger.find((e) => e.id === delta.id);
      // uniquify can rename the file after the fact, so a second event for the
      // same download replaces the path rather than adding a row.
      if (known?.path === path) return null;
      const rest = ledger.filter((e) => e.id !== delta.id);
      const at = known?.at ?? Date.now();
      return { ledger: [...rest, { id: delta.id, path, at }].slice(-LEDGER_MAX) };
    });
  });
});

// Called with the history snapshot the sweep is about to act on, before any of
// it is erased. `since` is when that snapshot was taken: ledger writes are
// serialised, so a download that finished while this one waited its turn would
// otherwise look missing from a history that simply predates it.
function reconcileLedger(items, since) {
  const live = new Map(items.map((i) => [i.id, i.state]));
  const covered = (e) => (e.at ?? 0) <= since;

  return withLedger(({ ledger, orphans }) => {
    // No history entry, and the sweep is not what removed it. The file is
    // unreachable from here for good.
    const lost = ledger.filter((e) => covered(e) && !live.has(e.id)).map((e) => e.path);
    // Everything else is about to be swept, so it leaves the books either way.
    // Exceptions: a download still running, which the sweep skips, and anything
    // the snapshot never saw.
    const kept = ledger.filter((e) => !covered(e) || live.get(e.id) === "in_progress");

    // Each sweep restates what it found rather than adding to a running total,
    // so a report the user has acted on does not outlive the sweep that follows
    // it. Nothing here can see the folder, so this is the only way the warning
    // ever goes away on its own.
    const settled =
      kept.length === ledger.length &&
      lost.length === orphans.length &&
      lost.every((path, i) => path === orphans[i]);
    if (settled) return null;

    if (lost.length) console.warn("[tempdl]", lost.length, "temp file(s) left untracked");
    return { ledger: kept, orphans: lost.slice(-ORPHAN_MAX) };
  });
}

// Cancel, then erase. cancel() fails with "Download must be in progress" if it
// arrives before the download has actually started, which is the common case
// right after answering the prompt, so retry briefly. If it still loses the
// race the download has already completed, and the file has to be deleted
// rather than cancelled.
function abort(id, done = () => {}, tries = 0) {
  chrome.downloads.cancel(id, () => {
    const err = chrome.runtime.lastError;
    if (err) {
      if (tries < 40) {
        setTimeout(() => abort(id, done, tries + 1), 50);
        return;
      }
      console.warn("[tempdl] cancel gave up on", id, err.message, "removing file instead");
      chrome.downloads.removeFile(id, () => {
        ignoreError();
        chrome.downloads.erase({ id }, () => {
          ignoreError();
          done();
        });
      });
      return;
    }
    chrome.downloads.erase({ id }, () => {
      ignoreError();
      done();
    });
  });
}

// Closing the window without choosing is not a decision, so treat it as the
// same safe default as the timeout: nothing is written.
chrome.windows.onRemoved.addListener((windowId) => {
  const id = byWindow.get(windowId);
  if (id == null) return;
  byWindow.delete(windowId);
  const entry = pending.get(id);
  if (entry) entry.windowId = null;
  console.log("[tempdl] prompt window closed without a choice", id);
  resolveAll("cancel");
});

// Snapshotted first: resolve() empties the map as it goes, and a download that
// starts mid-loop was never part of what the user was answering about.
function resolveAll(choice) {
  const ids = [...pending.keys()];
  console.log("[tempdl] choice", choice, "for", ids.length, "download(s)");
  for (const id of ids) resolve(id, choice);
}

chrome.runtime.onMessage.addListener((msg) => {
  // The prompt speaks for everything waiting, whichever download it happens to
  // be showing, so the answer covers all of them.
  if (msg?.type === "tempdl-choice") resolveAll(msg.choice);
  if (msg?.type === "tempdl-sweep") sweep("manual");
});

// An open port keeps the service worker alive, which is what protects the held
// suggest() callback for as long as the prompt is on screen. Losing the port is
// also how a dismissed popup is detected: unlike a window there is no close
// event, and clicking anywhere outside a popup closes it.
chrome.runtime.onConnect.addListener((port) => {
  const id = Number(port.name.slice("prompt-".length));
  if (Number.isFinite(id)) ports.set(id, port);

  // The page cannot work out its own deadline: the clock started when the
  // download did, which is before this page existed.
  if (pending.has(id)) {
    port.postMessage({ type: "tempdl-remaining", ms: remainingMs(), total: CHOICE_TIMEOUT_MS });
  }

  port.onDisconnect.addListener(() => {
    ignoreError();
    ports.delete(id);
    if (!Number.isFinite(id) || !pending.has(id)) return;
    console.log("[tempdl] prompt dismissed without a choice", id);
    resolveAll("cancel");
  });
});

// CLEANUP

// Everything in the temp folder is discarded when the browser starts.
//
// This works through the download history rather than the filesystem, because
// an extension has no way to enumerate or delete arbitrary paths. Only
// removeFile() on downloads the browser still knows about is available.
// Consequence: anything whose history entry is gone (cleared browsing data, a
// different profile) is left behind on disk, as is the folder itself. What is
// left behind cannot be deleted, but the ledger above at least names it.
function sweep(reason) {
  const stored = chrome.storage.local.get({
    folder: DEFAULT_FOLDER,
    retired: [],
    configured: false,
  });
  stored.then(({ folder, retired, configured }) => {
    if (!configured) {
      // Nothing here is ours yet. A folder that happens to match the default
      // name is the user's, not something to delete.
      console.log("[tempdl] sweep", reason, "skipped, not configured");
      return;
    }
    const folders = [sanitize(folder) || DEFAULT_FOLDER, ...retired.map(sanitize)].filter(Boolean);

    chrome.downloads.search({}, (items) => {
      if (chrome.runtime.lastError) {
        console.warn("[tempdl] sweep search failed", chrome.runtime.lastError.message);
        return;
      }

      // Runs on the history as it stands, before the sweep starts erasing it,
      // and whether or not there is anything to sweep.
      reconcileLedger(items, Date.now());

      // A download still running is not litter, so leave it alone. Anything
      // else in a temp folder is expendable by definition.
      const stale = items.filter(
        (i) => i.state !== "in_progress" && folders.some((f) => inFolder(i.filename, f))
      );
      if (!stale.length) {
        console.log("[tempdl] sweep", reason, "found nothing to do");
        return;
      }
      console.log("[tempdl] sweep", reason, stale.length, "item(s) in", folders.join(", "));

      for (const item of stale) {
        chrome.downloads.removeFile(item.id, () => {
          // Already gone from disk (moved, deleted by hand) is the normal
          // case, not a failure. The history entry still needs erasing.
          ignoreError();
          chrome.downloads.erase({ id: item.id }, ignoreError);
        });
      }
    });
  });
}

// Setup lives in the toolbar popup rather than a window of its own. Opening it
// automatically is best effort: openPopup() rejects when no browser window is
// focused, which is common at startup. The badge is the durable signal, so the
// icon still asks for attention when the popup could not be shown.
function promptSetup(reason) {
  chrome.action.setBadgeText({ text: "!" });
  chrome.action.setBadgeBackgroundColor({ color: "#b3261e" });

  const opening = chrome.action.openPopup?.();
  if (!opening?.catch) return;
  opening.catch((e) => {
    console.log("[tempdl] setup popup not opened at", reason, "badge only:", e.message);
  });
}

function clearSetupBadge() {
  chrome.action.setBadgeText({ text: "" });
}

chrome.runtime.onStartup.addListener(() => {
  getConfig().then(({ configured }) => {
    if (!configured) {
      promptSetup("startup");
      return;
    }
    clearSetupBadge();
    sweep("startup");
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  // Also sweeps on every reload of an unpacked extension, which is what makes
  // cleanup testable without restarting the browser.
  sweep("install/reload");

  getConfig().then(({ configured }) => {
    if (!configured) {
      promptSetup(details.reason);
      return;
    }
    clearSetupBadge();
  });
});

function ignoreError() {
  // Reading lastError marks it handled and stops the browser logging it as an
  // unchecked runtime error. Assigned rather than voided so the read cannot be
  // optimised away.
  const err = chrome.runtime.lastError;
  if (err) console.debug("[tempdl]", err.message);
}

// setPopup outlives the service worker, so a prompt left armed when the worker
// was torn down would still be pointing at a download that no longer exists.
// Every worker start resets the icon to settings; a live prompt re-arms it.
chrome.action.setPopup({ popup: "options.html" });
