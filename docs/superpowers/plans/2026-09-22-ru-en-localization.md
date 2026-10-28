# RU/EN localisation — future implementation plan

Date: 2026-09-22
Status: proposed; not scheduled or implemented. Rechecked 2026-10-28: the UI remains Russian; this document does not authorize implementation.

## Goal

Make the complete Galley Desk interface available in Russian and English
without changing book files, review data, or the local-first storage model.

## Proposed product choices

- Support exactly `ru` and `en` initially.
- On first launch, use Russian when the system locale begins with `ru` and
  English otherwise.
- Persist an explicit user choice in appData and apply it immediately without
  restarting or closing a book.
- Put the language selector in the existing Appearance/settings surface so it
  does not add permanent title-bar chrome.
- Translate application-authored UI, errors, menus, tooltips, dialogs,
  diagnostics labels, and accessibility names.
- Never translate book titles, chapter titles, Markdown, YAML/frontmatter,
  paths, signal comments, or other user-authored content.
- Keep layout resilient to longer labels at 900, 1280, and 1920 px and at the
  supported UI font-size range.

## Recommended architecture

Use a renderer-local, type-safe RU/EN dictionary and translation context; do
not add an i18n dependency for two bundled locales. Define keys by meaning,
not placement. Validate that both dictionaries have identical keys at compile
time and in tests.

Extend appearance/settings persistence with `locale: 'ru' | 'en' | null`,
where `null` means that no manual choice has yet been saved. During migration,
an absent `locale` must become `null`. Update `validateAppearance` to include
the validated locale in its returned settings object (it currently drops
unlisted fields), accepting only `null`, `ru`, or `en` and rejecting other
values. Add migration coverage for profiles without the field and persistence
round-trip tests for all three accepted values. These are planned changes,
not implemented localization behavior. Native application menus
and main-process errors must use the same resolved locale passed through a
narrow settings boundary; they must not guess independently after the user
has selected a language.

## Work packages

1. Inventory every application-authored string in renderer, main menus,
   preload-facing errors, tests, and packaged metadata. Classify user content
   and technical literals that must stay untouched.
2. Add locale types, system-locale resolution, settings migration, and
   serialized persistence tests.
3. Add the typed dictionaries and translation provider. Convert shared shell,
   welcome/recents, title bar, tooltips, diagnostics, and Appearance first.
4. Convert book workspace, chapter management, search, review records,
   metadata, conflict/recovery, and destructive confirmation flows.
5. Localise main-process menus and stable error messages without exposing raw
   internals or weakening existing error codes.
6. Update unit and Playwright selectors to prefer roles and stable accessible
   structure rather than one-language text where the exact translation is not
   the subject of the test.
7. Run typecheck/unit/package/security checks and the desktop suite serially
   in Xvfb. Capture RU/EN × light/dark screenshots at 900/1280/1920 and the
   supported font scales; inspect truncation, popover placement, focus, and
   horizontal overflow.

## Acceptance criteria

- No untranslated application-authored string appears in either locale.
- Switching language is live and survives restart.
- Existing settings migrate without data loss.
- Book files and sidecars are byte-for-byte unchanged by language switching.
- Both dictionaries have identical keys and interpolation requirements.
- The full automated suite remains green and the screenshot matrix shows no
  clipped controls or unintended horizontal scrolling.
