# QWEN.md

## Project Overview

**Fiverr Conversation Extractor** is a Chrome Extension (Manifest V3) that extracts and exports conversations from the Fiverr inbox. It allows users to extract individual conversations, fetch all contacts, and bulk-export multiple conversations in Markdown, JSON, and HTML formats — including attachments.

The extension communicates with Fiverr's internal inbox API endpoints (authenticated via session cookies) to paginate through contacts and conversation messages, then converts the data into user-friendly formats for download.

## Tech Stack

- **Platform:** Chrome Extension (Manifest V3)
- **Languages:** Vanilla JavaScript, HTML, CSS
- **Dependencies:** JSZip (`jszip.min.js`) — referenced in `manifest.json` and `popup.html` but not committed to the repo; must be provided separately
- **No build system** — no bundler, no transpiler, no `package.json`. Files are loaded directly by the browser.
- **No test framework** — no tests exist in the repository.

## File Structure

| File | Role |
|------|------|
| `manifest.json` | Extension manifest (MV3). Declares permissions, content scripts, service worker, and web-accessible resources. |
| `background.js` | Service worker. Handles background processing: contact fetching (`fetchAllContactsBg`), conversation fetching (`fetchConversationBg`), bulk export orchestration, format conversion (Markdown/HTML), and large file chunked downloads. ~1850 lines. |
| `content.js` | Content script injected into Fiverr pages. Handles in-page conversation fetching (`fetchConversation`), contact fetching (`fetchAllContacts`), markdown conversion, and large export download reconstruction. ~460 lines. |
| `popup.html` | Extension popup UI. Contains all HTML structure and inline CSS (styling, layout, modals, side panels, progress bars, notifications). |
| `popup.js` | Popup logic. UI event handlers, notification system, progress bar management, contacts/attachments display, settings modal, bulk export modal, and message listeners. ~1690 lines. |

## Architecture

### Messaging Flow

```
Popup (popup.js)
  ↕ chrome.runtime.sendMessage
Background (background.js) — service worker
  ↕ chrome.scripting.executeScript / chrome.runtime.sendMessage
Content Script (content.js) — injected into fiverr.com tabs
  ↕ fetch() with credentials: 'include'
Fiverr API (https://www.fiverr.com/inbox/...)
```

The background script is the primary orchestrator. It uses `chrome.scripting.executeScript` to run fetch functions in the tab's context (so requests carry the user's Fiverr session cookies). The content script also has standalone fetch logic for direct in-page operations.

### Key Message Types

| Type | Direction | Purpose |
|------|-----------|---------|
| `EXTRACT_CONVERSATION` | Popup → Background | Start single conversation extraction |
| `FETCH_ALL_CONTACTS` | Popup → Background | Fetch all contacts with pagination |
| `CONTACTS_PROGRESS` / `CONTACTS_FETCHED` | Background → Popup | Contact fetching progress/completion |
| `EXTRACTION_PROGRESS` / `CONVERSATION_EXTRACTED` / `EXTRACTION_ERROR` | Background → Popup | Conversation extraction status |
| `START_BULK_EXPORT` | Popup → Background | Start bulk export of selected contacts |
| `GET_BULK_EXPORT_STATUS` | Popup → Background | Poll bulk export progress |
| `BULK_EXPORT_PROGRESS` / `BULK_EXPORT_STATUS` | Background → Popup | Bulk export progress updates |
| `CONVERT_FORMATS` | Popup → Background | Convert conversation data to Markdown + HTML |
| `FETCH_CONVERSATION_FOR_EXPORT` | Popup → Background/Content | Fetch a conversation for export (used in bulk flow) |
| `HANDLE_LARGE_EXPORT_DOWNLOAD` | Background → Content | Reconstruct and download chunked large exports |

### Fiverr API Endpoints

- **Contacts list:** `GET https://www.fiverr.com/inbox/contacts` (paginated via `?older_than={timestamp}`)
- **Conversation messages:** `GET https://www.fiverr.com/inbox/contacts/{username}/conversation` (paginated via `?timestamp={timestamp}`, response includes `lastPage` boolean)

### Data Flow

1. User navigates to `https://www.fiverr.com/inbox/{username}` and clicks "Extract Conversation", or uses the contacts/bulk export features.
2. Background script fetches paginated data from Fiverr's API using `chrome.scripting.executeScript` to execute `fetch()` in the tab context (carrying session cookies).
3. Messages are collected across all pages, sorted chronologically (`createdAt` ascending).
4. Data is converted to Markdown (`convertToMarkdownBg`), HTML (`convertToHtmlBg`), or JSON.
5. Results stored in `chrome.storage.local` and/or downloaded via `chrome.downloads.download()`.
6. For bulk exports, each conversation is processed sequentially with progress tracking. Files are organized in `fiverr-conversations/{username}/` folder structure.

### Storage Keys (chrome.storage.local)

- `currentUsername` — currently selected Fiverr username
- `allContacts` — cached contacts list
- `conversationData` / `jsonContent` — last extracted conversation data
- `markdownContent` / `htmlContent` — converted format outputs
- `dateFormat` — user's date format preference (default: `DD/MM/YYYY`)
- `attachmentSort` — attachment sort order (default: `newest`)
- `lastContactsFetch` / `lastContactCount` — contacts fetch metadata
- `export_chunk_{id}_{n}` / `export_meta_{id}` — chunked large export data

## Building and Running

### Loading the Extension

1. **Obtain JSZip:** Download `jszip.min.js` (v3.x) from the [JSZip releases](https://github.com/Stuk/jszip/releases) and place it in the project root. This file is required but not committed.
2. **Load in Chrome:**
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select this project directory
3. **Usage:**
   - Navigate to `https://www.fiverr.com/inbox/{username}` for single conversation extraction
   - Click the extension icon to open the popup
   - Use "Extract Conversation" for the current inbox, or "Fetch All Contacts" to list all contacts
   - Use "Bulk Export Conversations" to export multiple conversations at once

### No Build Step

There is no build, compile, or bundle step. Edit JavaScript files directly and reload the extension in `chrome://extensions/`.

### No Tests

No test files or test framework exist. To verify changes, manually test the extension against a Fiverr inbox page.

## Development Conventions

- **Vanilla JS only:** No TypeScript, no transpilation, no frameworks. All code is plain ES6+ JavaScript.
- **Inline CSS:** All styles are defined in `<style>` tags within `popup.html`. No external CSS files.
- **Code duplication:** `formatDate`, `formatFileSize`, `convertToMarkdown`, and fetch logic are duplicated between `content.js` and `background.js` because content scripts and service workers run in isolated contexts and cannot share modules in MV3 without dynamic imports.
- **Message-passing pattern:** All cross-context communication uses `chrome.runtime.sendMessage` / `chrome.runtime.onMessage.addListener`. Async responses use `return true` to keep the message channel open.
- **Async/await:** All Fiverr API calls and processing logic use async/await with try/catch error handling. Progress updates are sent via `chrome.runtime.sendMessage` during long operations.
- **Rate limiting:** A `setTimeout` delay (500ms for contacts, 1000ms for conversations) is added between paginated API requests to avoid rate limiting.
- **Error propagation:** Errors are caught and forwarded to the popup via `EXTRACTION_ERROR` or `CONTACTS_PROGRESS` (with `isError: true`) messages, then displayed as toast notifications.

## Permissions

| Permission | Reason |
|-----------|--------|
| `activeTab` | Access the current tab to check if it's a Fiverr page |
| `storage` | Store conversation data, contacts, and user preferences |
| `scripting` | Inject content scripts and execute fetch functions in tab context |
| `downloads` | Download extracted conversations and attachments |
| `tabs` | Query active tabs and open new tabs for viewing extracted data |
| `host_permissions: fiverr.com` | Access Fiverr's API endpoints with session credentials |
