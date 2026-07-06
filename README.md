# Claude Chat Organizer

A Chrome extension that lets you bulk-assign claude.ai chats to projects, rename them with project prefixes, and delete them — all from a single interface without touching the claude.ai UI.

## How it works

The extension opens a full-page organizer tab. It calls the claude.ai API directly from within an authenticated claude.ai tab (via a background service worker), so it uses your existing session and requires no API keys or credentials.

On load, it fetches all your projects and chats, auto-suggests project assignments based on chat title keywords, and presents everything grouped by project. You review, adjust, and hit Execute. Moves, renames, and deletions all run in one pass.

## Features

- Loads all chats across all pages (up to 3,000)
- Groups chats by current or proposed project assignment
- Auto-suggests project assignments by matching chat titles against project names
- Create new projects on the fly during assignment
- Optional prefix mode: prepend `[Project Name]` to chat titles for each group
- Mark individual chats for deletion
- Filter view by all chats, unassigned only, or changed from original
- Execution log with per-operation status

## Installation

This extension is not published to the Chrome Web Store. Install it unpacked.

**Step 1 — Get the files**

Download the latest release zip from the [Releases](../../releases) page and extract it. You should have a folder containing:

```
manifest.json
organizer.html
content-organizer.js
background.js
```

**Step 2 — Load in Chrome**

1. Go to `chrome://extensions`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select the extracted folder

The **Claude Chat Organizer** icon appears in your Chrome toolbar.

**Step 3 — Use it**

1. Make sure you are logged into [claude.ai](https://claude.ai) in at least one tab
2. Click the extension icon — it opens a new tab with the organizer
3. Click **Load projects and chats**
4. Review assignments, make changes, then click **Execute**

## Permissions

The extension requests the following permissions:

- `tabs` — to find or open a claude.ai tab to execute API calls
- `scripting` — to run fetch calls inside the claude.ai tab (same-origin, credentials included)
- `host_permissions: https://claude.ai/*` — scoped to claude.ai only

No data leaves your browser. All API calls go directly from your browser to claude.ai using your existing session cookies.

## Usage notes

- **Auth errors on load** — if you see "Not logged in," open claude.ai in a tab, log in, and try again
- **Projects dropdown is empty** — wait for the page to fully load, then reload the organizer
- **Execution stops mid-run** — reload the organizer, re-apply your changes, and run again; already-completed operations are not re-run (moves are idempotent)
- **Prefix mode** — enabling a prefix on a group prepends `[Project Name]` to every chat title in that group; it skips chats that already have the prefix
- **New projects** — selecting "+ new project…" from a chat's dropdown prompts for a name; the project is created during Execute before chats are moved into it
- **Deletions are permanent** — use the ✕ button per chat to mark for deletion, then confirm by clicking Execute; you can undo a mark before executing by clicking the button again

## Compatibility

Chrome (and Chromium-based browsers). Manifest V3. Requires an active claude.ai session.

## License

MIT
