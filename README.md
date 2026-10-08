# Obsidian Screenshot Importer

Import screenshots and images into Obsidian media notes with automatic matching,
episode organization, image compression, and rollback support.

A standalone macOS app for reviewing batches before adding them to your vault.
Images can come from any player, game, or other source.

[Download](https://github.com/theambinder/obsidian-screenshot-importer/releases/latest)
· [Changelog](CHANGELOG.md) · [Русский](README.ru.md)

[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-support-FFDD00?logo=buymeacoffee&logoColor=000000)](https://buymeacoffee.com/ambinder)
· [Sponsor](https://buymeacoffee.com/ambinder)

## Get Started

Requires **Apple Silicon (M1 or later)** and **macOS 13.5 or later**.

1. Download the Apple Silicon ZIP from [Releases](https://github.com/theambinder/obsidian-screenshot-importer/releases).
2. Extract it in Downloads and move **Obsidian Screenshot Importer.app** to Applications.
3. Open the app and select your folders in **Settings > Choose Folders...**:
   screenshots, Obsidian vault, Media, and history/settings.
4. Review the suggested notes and episodes, select folders, and press **Run**.
5. Close the main window or press **Cmd+Q** to stop the app and its local service.
   An active operation finishes before shutdown.

The release includes Node.js, cwebp, and FFmpeg; no separate installation is needed.
The app works offline. It is ad-hoc signed, not notarized; macOS may require
approval in System Settings > Privacy & Security when opening a downloaded copy.
See [PORTABLE-APP.md](PORTABLE-APP.md) for installation and transfer details.

## Features

- Scan source subfolders and suggest matching notes. Search by category and title,
  correct matches, and reuse saved mappings across similar folders.
- Detect seasons and episodes, including episode zero. Change Work/Episode for all
  folders sharing a Note, with remembered per-note mode and individual number detection. Keep episodes in numeric
  order, reuse padded/commented headings, and preserve existing note text.
- Convert to WebP, JPEG, PNG, or keep originals. Preserve filenames and dimensions;
  preview original/converted images and detail crops before applying quality.
- Set category defaults and per-note quality; convert batches in parallel.
- Insert Obsidian embeds into the correct work or episode section and place images
  in the configurable **Settings > Image Folder** (default `All Notes/Attachments/{notename}/`).
- Review run summaries, compression savings, and archived sources. Roll back a
  whole run or one folder with live progress, or send checked archives to the macOS Trash.
  A second mutation cannot start while rollback is running; progress survives tab changes and page reloads.
- Select matching notes in bulk, sort by Folder, Size, Note, Season, or Episode, and use system/light/dark themes.
  Each section remembers its own scroll position during the session.
- Preserve note creation dates on macOS while updating modification dates.

## Folder Layout

Source images must be inside subfolders of the selected screenshots root. Folder
names identify a work or episode, for example:

```text
Screenshots/
  Example Movie (2025)/
    screenshot-01.png
  Example.Show.S02E03/
    screenshot-02.png
```

The selected Media folder must be inside the vault and contain the supported note
categories: **Anime, Movies, Series, Cartoons, Games, Manga, Comics**. Notes outside
these categories are not edited. Missing notes are created manually in Obsidian.

Processed originals move to `Screenshots/_archive/<run>/`. Keep them until you have
checked the result. History, rollback backups, mappings, and preferences are stored
in the separate data folder, which is excluded from Git and release archives.
Sharing that folder between Macs requires the same paths for old rollback history;
use one Mac at a time and let synchronization finish before switching.

## Develop From Source

Clone the repository, then install development tools on macOS:

```sh
git clone https://github.com/theambinder/obsidian-screenshot-importer.git
cd obsidian-screenshot-importer
/bin/zsh scripts/setup-macos.zsh
```

The setup checks existing tools and installs missing Homebrew, Node.js 20+, cwebp,
and FFmpeg. Apple's Command Line Tools are needed to compile native helpers.
The JavaScript application has no npm dependencies.

For browser-based development, provide your own absolute paths:

```sh
export OBSIDIAN_SCREENSHOTS_ROOT="$HOME/Pictures/Screenshots"
export OBSIDIAN_VAULT_ROOT="$HOME/Documents/My Vault"
export OBSIDIAN_MEDIA_ROOT="$OBSIDIAN_VAULT_ROOT/Bases/Databases/Media"
npm start
```

Open **http://127.0.0.1:3787** and stop with **Ctrl+C**. Optional environment variables:
`OBSIDIAN_SCREENSHOTS_PORT` and `OBSIDIAN_SCREENSHOTS_DATA_DIR`.
The existing defaults and `IINA_IMPORTER_PORT` remain for older local setups.
Environment variables configure source/browser mode; packaged apps use their
local folder-selection profile. `.env` files are not loaded automatically.

```sh
npm test
/bin/bash scripts/build-macos-app.sh
```

Tests use disposable fixtures. Building on Apple Silicon creates the app and a
versioned ZIP in `dist/`, with pinned runtimes and companion third-party sources.
Build the bundle before running its integration test; otherwise that test skips.
User data, dependencies, temporary builds, generated apps, and releases are ignored.

## Documentation

- [PROJECT.md](PROJECT.md): detailed requirements, architecture, matching rules,
  Markdown insertion, archive/rollback behavior, and implementation decisions.
- [PORTABLE-APP.md](PORTABLE-APP.md): macOS build, lifecycle, locations, and transfer.
- [PERFORMANCE.md](PERFORMANCE.md): size and conversion measurements.
- [AUDIT.md](AUDIT.md): prior code audit and fixes.
- [CHANGELOG.md](CHANGELOG.md): complete release history.

The project currently has no project-wide license. Bundled dependencies and icons
retain their own license notices. This is an independent tool, not an official
Obsidian product.
