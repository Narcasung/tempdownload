# TempDownload

A Manifest V3 extension for Chromium based browsers that brings a choice when downloading a file between saving it to disk or saving it to a temp folder that gets wiped on every restart, like firefox's "Open" choice.

## Install

1. Clone or download this repository.
2. Open your browser's extensions page and turn on developer mode.
3. Choose "Load unpacked" and select the folder.

## Setup

**1. Turn off "Ask where to save each file before downloading"** in your
browser's download settings.

**2. Pick a temp folder name.** The folder will be in your browser's download directory.

## Permissions

- `downloads` to intercept downloads, redirect them, and delete temp files.
- `storage` to remember the folder name and the setup state.

Nothing is sent anywhere. There is no network access, no analytics, no remote
code.

## Browser limits

Nothing an extension can work around. Each of these is the browser refusing,
not the extension declining.

- The temp folder cannot be outside of the browser's download directory.
  A suggested path is always relative to that directory, and an absolute one is
  ignored, so the folder is configured as a name rather than picked as a path.
- Only files still present in the browser's download history can be swept.
  Anything you clear from history survives in the temp folder.
  Anything you put there manually will never be detected nor deleted.
  The File System Access API can read a folder and would lift this, but the
  permission does not survive a browser restart and cannot be renewed without a
  click, so the wipe at startup can never use it.
- The browser waits 15 seconds for an answer, then places the file in the
  download directory itself and ignores whatever is chosen afterwards. To stay
  ahead of it, the extension cancels a download that has gone 14 seconds without
  a choice.

## What this extension does not do

- Blob downloads cannot be offered a folder. They are built by the page itself
  and cannot be fetched a second time from here, so the only route would be to
  read the file inside the page and pass every byte through the extension. That
  means holding the whole download in memory and transferring it twice, which is
  not worth it for a folder choice. Those downloads keep their original transfer
  and land in the download folder under their proper name.
