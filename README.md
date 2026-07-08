# Fiverr Conversation Extractor

A Chrome Extension (Manifest V3) that extracts and exports conversations from the Fiverr inbox. Extract individual conversations, fetch all contacts, and bulk-export multiple conversations in Markdown, JSON, and HTML formats — including attachments.

## Features

- **Single Conversation Extraction** — Pull the full message history (including custom offers) from any Fiverr inbox thread, paginated automatically.
- **All Contacts Fetch** — Retrieve your complete Fiverr contacts list with a single click.
- **Multi-Format Export** — Download or preview conversations as Markdown, JSON, or HTML.
- **Attachment Downloads** — Download individual attachments or bundle everything into a ZIP archive.
- **Bulk Export** — Select multiple contacts and export their conversations sequentially, organized into a `fiverr-conversations/{username}/` folder structure.
- **Settings** — Configure date format (`DD/MM/YYYY` or `MM/DD/YYYY`) and attachment sort order.

## Installation

### 1. Get JSZip

This extension depends on [JSZip](https://github.com/Stuk/jszip) for ZIP archive creation. The library is **not** bundled in the repository.

1. Download `jszip.min.js` (v3.x) from the [JSZip releases page](https://github.com/Stuk/jszip/releases).
2. Place `jszip.min.js` in the project root directory (next to `manifest.json`).

### 2. Load the Extension

1. Open `chrome://extensions/` in Chrome.
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked**.
4. Select this project directory.

### 3. Usage

1. Navigate to `https://www.fiverr.com/inbox/{username}` for a single conversation, or `https://www.fiverr.com/inbox/` for the contacts list.
2. Click the extension icon to open the popup.
3. Use **Extract Conversation** for the current inbox thread.
4. Use **Fetch All Contacts** to list and select contacts for bulk export.

## How It Works

The extension communicates with Fiverr's internal inbox API endpoints, authenticated via your active Fiverr session cookies. The background service worker orchestrates paginated data fetching, format conversion, and downloads.

```
Popup (popup.js)
  ↕ chrome.runtime.sendMessage
Background Service Worker (background.js)
  ↕ chrome.scripting.executeScript
Content Script (content.js) — injected into fiverr.com
  ↕ fetch() with credentials: 'include'
Fiverr Inbox API
```

### Fiverr API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /inbox/contacts` | Paginated contacts list (via `?older_than={timestamp}`) |
| `GET /inbox/contacts/{username}/conversation` | Paginated conversation messages (via `?timestamp={timestamp}`) |

## Project Structure

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (MV3) — permissions, content scripts, service worker |
| `background.js` | Service worker — contact/conversation fetching, bulk export, format conversion, chunked downloads |
| `content.js` | Content script — in-page fetching and large export download reconstruction |
| `popup.html` | Popup UI — HTML structure and inline CSS |
| `popup.js` | Popup logic — UI events, notifications, progress bars, contacts/attachments display |

## Permissions

| Permission | Reason |
|-----------|--------|
| `activeTab` | Access the current tab to check if it's a Fiverr page |
| `storage` | Store conversation data, contacts, and user preferences |
| `scripting` | Inject content scripts and execute fetch functions in tab context |
| `downloads` | Download extracted conversations and attachments |
| `tabs` | Query active tabs and open new tabs for viewing extracted data |
| `host_permissions: fiverr.com` | Access Fiverr's API endpoints with session credentials |

## Tech Stack

- **Platform:** Chrome Extension (Manifest V3)
- **Languages:** Vanilla JavaScript, HTML, CSS
- **Dependencies:** JSZip 3.x (not included — see [Installation](#1-get-jszip))
- **No build system** — files are loaded directly by the browser

## License

This project is currently unlicensed. All rights reserved.
