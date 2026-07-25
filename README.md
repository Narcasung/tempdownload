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

## Known limits

- The temp folder cannot be outside of the browser's download directory.
- Only files still present in the browser's download history can be swept.
  Anything you clear from history survives in the temp folder.
- The extension will not open files for you.
