<!-- TabNest English documentation: features, installation, data behavior and verification. -->
# TabNest · Tab Organizer

English · [简体中文](README.md)

A modern, account-free Edge Manifest V3 extension that stores everything locally and requires no build step.

![TabNest manager](docs/images/manager.png)

## Highlights

- Save one tab, a native tab group, the current window, or all normal windows.
- Preserve tab order, pinned state, and Edge group names, colors, and collapsed state.
- Restore one tab, a group, or an entire collection into the current window or a new window.
- Deduplicate by complete URL and support per-item deletion, undo, search, and collapse all.
- Import and export JSON, with OneTab text compatibility.
- Keep all data on the device with no account, analytics, remote scripts, or remote icon service.

![TabNest quick capture](docs/images/quick-capture.png)

## Install

1. Download or clone the repository and keep the `TabNest` directory in a permanent location.
2. Open `edge://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose the directory containing `manifest.json`.
4. Pin TabNest from the Edge extensions menu.

This is an unpacked development build, not a store-signed package. It requires no `npm install` or compilation.
After updating the files, select **Reload** on the Edge extensions page and refresh any open manager page.

## Use

- **Save one tab:** open the toolbar popup, choose a tab, then select **Save one tab**.
- **Save a group:** choose a native Edge group in the popup, then select **Save this group**.
- **Save all:** save every supported tab in the current window. Optionally close tabs after a successful save.
- **Manage collections:** open the manager from the bottom of the popup to browse groups, search, rename, delete,
  undo a deletion, collapse all groups, import, or export.
- **Restore:** select **Current window** or **New window**, then restore a tab, a group, or a full collection.
  Restoring does not remove the saved collection.

## Groups and deduplication

TabNest preserves native Edge group metadata and pinned state. The manager sidebar aggregates named groups and shows
ungrouped tabs separately. Repeated captures and imports are deduplicated using the normalized complete URL. Query
parameters and URL fragments remain significant.

When same-name merging is enabled, groups with matching trimmed, case-sensitive names are collected into the newest
matching record. Disable the option when exact window snapshots matter more than combining groups.

## Import and export

JSON is the recommended backup format because it preserves collection dates, groups, colors, collapsed state, order,
and pinned state. OneTab text is supported in `URL | title` form, with blank lines separating imported groups:

```text
https://example.com | Example page
https://example.org | Another page

https://example.net | Next group
```

OneTab text does not contain original group names, colors, or pinned state. TabNest creates sequentially named import
groups for its blank-line blocks. Browser-internal pages are skipped; malformed or unsafe input fails atomically.

## Privacy and limitations

- Data is stored in `chrome.storage.local` and never uploaded by TabNest.
- Uninstalling the extension or clearing its extension data removes saved collections. Export JSON backups regularly.
- HTTP, HTTPS, file, and FTP URLs can be stored. Browser-internal, extension, blob, data, and private-window pages are
  excluded.
- Page forms, scroll position, login state, navigation history, and page contents are not archived.
- File and FTP URLs remain subject to Edge and operating-system support.

## Development and verification

The extension uses plain HTML, CSS, and JavaScript without third-party runtime dependencies or a build step.

Run the data-model regression checks with Node.js:

```powershell
node --test tests/model.test.mjs
```

The release has also been exercised in an isolated real Edge profile for capture, deduplication, native groups,
restore destinations, import/export, deletion and undo, keyboard interaction, dark mode, and responsive layouts.

See [CHANGELOG.md](CHANGELOG.md) for public releases.

## License

TabNest is released under the [MIT License](LICENSE).
