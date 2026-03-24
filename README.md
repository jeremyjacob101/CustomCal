# CustomCal

Turn a noisy `.ics` feed into a clean Apple Calendar you actually control.

## Copy The Calendar, Keep The Control

Most shared calendars ask you to subscribe to everything exactly as published: every event, every wording choice, every color, every bit of clutter.

CustomCal takes a softer approach. Paste an `ics` or `webcal` link, preview what is inside, group repeated events by title, keep the parts you want, and write the result into your own Apple Calendar as a new calendar copy.

It is not a live sync tool. It is an import-and-curate tool for when the source calendar is useful, but not quite yours.

## Overview

CustomCal is a lightweight Electron tray app built with React and TypeScript. It fetches remote iCalendar feeds, parses events with `node-ical`, lets you review grouped results, and then creates events in Apple Calendar using:

- EventKit via Swift when importing to `iCloud`
- JavaScript for Automation when importing to `On My Mac`

That split matters because Apple Calendar behaves differently depending on where the destination calendar lives. CustomCal handles that difference for you.

## Why It Exists

- Public or shared calendars are often all-or-nothing.
- Subscriptions usually keep the publisher's naming, color, and category structure.
- Sometimes you only want selected event groups, not the whole feed.
- Sometimes you want the events copied into your own iCloud or local calendar instead of staying as a subscription.

CustomCal makes that workflow fast:

1. Paste a feed URL.
2. Preview the events.
3. Select the groups you want.
4. Import them into a new calendar with your own name and color.

## What It Does

- Accepts both `https://...calendar.ics` and `webcal://...` links
- Downloads and parses remote iCalendar feeds
- Detects timed events and all-day events
- Groups repeated events by normalized event title
- Lets you select or clear whole groups before import
- Creates a destination calendar if it does not already exist
- Supports importing to either `iCloud` or `On My Mac`
- Applies a chosen calendar color when possible
- Runs as a compact tray-style desktop utility

## What It Does Not Do

- It does not maintain a two-way sync with the source feed
- It does not currently update or delete previously imported events
- It does not expose per-occurrence selection inside a grouped series
- It is not a general Google Calendar or Outlook integration layer

Those limits are worth calling out up front because the app is strongest as a deliberate one-way importer.

## Requirements

- macOS for the full import workflow into Apple Calendar
- Apple Calendar permission granted to the app when prompted
- Node.js and npm for local development

The repository includes build targets for Windows and Linux because the Electron tooling supports them, but the calendar import implementation is currently Apple Calendar based and therefore macOS-first in practice.

## Getting Started

### Install

```bash
npm install
```

### Run In Development

```bash
npm run dev
```

This launches the Electron app with the Vite-powered renderer in development mode.

### Typecheck

```bash
npm run typecheck
```

### Lint

```bash
npm run lint
```

### Format

```bash
npm run format
```

## Packaging

### Build The App

```bash
npm run build
```

### Platform Builds

```bash
# macOS
npm run build:mac

# Windows
npm run build:win

# Linux
npm run build:linux
```

There are also unpacked output and preview scripts available in `package.json` if you want to inspect the bundled app without creating an installer.

## How To Use It

### 1. Launch CustomCal

On macOS, the app behaves like a tray utility. Click the menu bar icon to open the interface.

### 2. Paste A Feed URL

Enter a direct `ics` link or a `webcal://` URL. The app normalizes `webcal://` to `https://` before fetching.

### 3. Choose The Destination

Pick:

- `iCloud` to create or reuse a calendar backed by your iCloud account
- `On My Mac` to create or reuse a local calendar on the device

### 4. Name And Color The New Calendar

Choose the calendar name that should appear in Apple Calendar and optionally set a color.

### 5. Preview The Feed

Click `Import And Review` to fetch the remote calendar and build the review list.

### 6. Curate The Results

Events are grouped by summary title so repeated items can be selected as a set. Use:

- `Select all`
- `Clear all`
- individual group checkboxes

### 7. Import Into Apple Calendar

Click `Add Selected to iCalendar` to create the events in the chosen destination calendar.

## How It Works

### Renderer

The React UI collects the feed URL, calendar metadata, and review selections. It also groups fetched events by normalized summary text so recurring or repeated events can be toggled together.

### Preload

The preload layer exposes a small, focused API to the renderer:

- `previewCalendar`
- `importCalendar`

This keeps the renderer isolated from direct Electron or Node access.

### Main Process

The Electron main process:

- creates the tray icon and tray window
- positions the popover-style window near the tray
- wires up IPC handlers for preview and import operations

### Import Pipeline

1. `node-ical` fetches and parses the remote feed
2. Event data is normalized into a renderer-safe structure
3. Import payloads are sent to the native-side calendar bridge
4. Swift + EventKit handles `iCloud`
5. JXA handles `On My Mac`

This approach avoids trying to force one Apple automation path to cover both storage backends.

## Project Structure

```text
src/
  main/       Electron main process and calendar import bridge
  preload/    Safe renderer API exposed through contextBridge
  renderer/   React UI
resources/    App imagery and tray template assets
build/        Packaged-app icons and macOS entitlements
```

## Permissions And Notes

- The app will need Calendar access on macOS.
- If permission is denied, imports will fail until access is granted in system settings.
- All-day events are handled carefully so end dates remain exclusive, which is what Apple Calendar expects.
- Calendar colors are normalized to a hex value and default to `#0A84FF` if an invalid value is supplied.

## Troubleshooting

### Nothing happens after clicking import

- Make sure the preload bridge is available and the app is running normally through Electron
- Confirm the URL is a valid reachable `ics` or `webcal` feed

### The app says no events were found

- The feed may be empty
- The URL may redirect somewhere unexpected
- The source may not actually be serving iCalendar data

### Import to iCloud fails

- Make sure Calendar access was granted
- Confirm the Mac is signed into iCloud with Calendar enabled

### Import to On My Mac fails

- Make sure Apple Calendar has a local calendar source available
- Retry after granting permission to the app if macOS prompts for automation or calendar access

## Future Directions

- per-occurrence selection within a repeated series
- smarter duplicate detection across repeated imports
- update and removal flows for previously imported calendars
- richer status and error feedback in the UI
- polished onboarding and first-run guidance

## License

CustomCal is released under the [MIT License](LICENSE.md).
