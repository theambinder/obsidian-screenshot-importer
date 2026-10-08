# Development Notes

Read README.md, PROJECT.md, and PORTABLE-APP.md before changing import, rollback,
archive handling, or the macOS application. PROJECT.md records the product
requirements and implementation decisions; CHANGELOG.md records releases.

- Use temporary fixtures for testing. Never import, roll back, or trash real
  screenshots or notes as a development check.
- Keep note edits inside the configured Media categories. Preserve existing text,
  atomic writes, creation dates, source archives, and per-folder rollback journals.
- Keep image processing offline and the backend bound to loopback. Only explicit
  update checks/downloads may contact GitHub; never transmit vault or source data.
  Use formal, impersonal English for public documentation. User data belongs outside
  the app bundle and outside Git; data, build, dist, and generated apps are ignored.
- package.json is the version source. Update the changelog and relevant docs when
  releasing. Build the portable app before testing a new version against it.
- Run npm test for backend changes. Check frontend interactions in the native
  WKWebView when browser behavior can differ. Use tests/create-desktop-fixture.mjs
  for disposable UI fixtures.
- Source setup and builds must work from an arbitrary clone location. Preserve
  legacy paths and bundle identifiers where existing profiles/history depend on
  them. Do not rename or relocate user data as part of a code change.
- If AGENTS.local.md exists, read it for this checkout's local documentation
  preferences. It is intentionally ignored and must never be distributed.

The project currently has no project-wide license. Preserve all bundled
third-party notices inside the app and publish matching FFmpeg/WebP sources as a
separate asset alongside each application ZIP. The main ZIP contains only the app.
