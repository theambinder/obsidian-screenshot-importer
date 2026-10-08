# Obsidian Screenshot Importer

## Portable Desktop Build (2026-09-18)

Current release: **1.3.1**. `package.json` is authoritative; the build propagates it to Settings, About, bundle metadata, and the ZIP filename. See [CHANGELOG.md](CHANGELOG.md) for release history and [PERFORMANCE.md](PERFORMANCE.md) for size and conversion measurements. Bounded parallel encoding preserves sequential note/attachment/journal commits and all existing conflict policies.

Changelog policy: record every release in `CHANGELOG.md`. If this checkout has `AGENTS.local.md`, also follow its local Obsidian changelog policy while preserving existing note text and frontmatter. Never publish the local instructions or the private task note.

### GitHub Repository (1.3.1)

- Canonical repository: https://github.com/theambinder/obsidian-screenshot-importer. The English README introduces the app; README.ru.md preserves the Russian guide and this document retains the detailed original requirements.
- Inputs can be screenshots or other images from any source. IINA filename examples below describe the original setup, not a required integration.
- Keep all user state in ignored `data` or the selected external data folder. Generated apps, build caches, fixtures, ZIPs, logs, and local documentation preferences are excluded from Git. Release ZIPs are attached to GitHub Releases rather than committed.
- Browser/source mode accepts `OBSIDIAN_SCREENSHOTS_ROOT`, `OBSIDIAN_VAULT_ROOT`, `OBSIDIAN_MEDIA_ROOT`, `OBSIDIAN_SCREENSHOTS_DATA_DIR`, and `OBSIDIAN_SCREENSHOTS_PORT`. Existing defaults and `IINA_IMPORTER_PORT` remain compatible. The packaged app still uses its local locations profile.
- The legacy launcher is generated from `macos/launcher.zsh`, `macos/LegacyInfo.plist`, and `macos/launcher-wrapper.c`. It resolves the checkout from its bundle location instead of embedding one developer's absolute path. Source archives include these inputs, not a precompiled legacy app. FFmpeg build configuration comes from `-buildconf`; never distribute `ffbuild/config.log`, which dumps the developer's environment.
- Do not relocate the original user's checkout/data while migrating to Git: old journals contain absolute paths and the desktop app discovers the legacy data folder. Fresh clones may use any folder name.
- No project-wide license has been selected. Preserve third-party license notices and companion codec sources in app distributions.

### Section Navigation (1.3.0)

- `public/tabScroll.js` owns independent vertical scroll positions for Screenshots, History, and Settings. Capture the outgoing position before hiding its panel can clamp document height, then synchronously restore the incoming position after visibility/sticky offsets update. Unvisited sections start at zero. Negative macOS elastic overscroll is not saved.
- Single-click on the active section is a no-op. Native double-click generates two normal clicks followed by `dblclick`: the normal clicks switch at most once, then `toTop` resets only the target section. Do not delay ordinary navigation to disambiguate double-clicks or issue repeated History loads for an already active tab.
- Wrap active Screenshots/History rendering with `refresh`, reading the viewport at response/render time, not when a request starts. A late response must not undo subsequent scrolling, a double-click to top, or a switch to another tab. Positions clamp naturally when content shrinks.
- This is in-memory window-session state only, not app settings, localStorage, URL history, or a cross-Mac preference. A fresh app window has no saved positions.
- `tests/tabScroll.test.mjs` covers navigation ordering, separate positions, active-tab clicks, double-click sequences, late refreshes, short panels, elastic overscroll, and fresh sessions. `node tests/create-desktop-fixture.mjs --navigation` creates 60 screenshot folders and 40 simulated, non-actionable History runs for native/browser UI verification without using the user's data.

### Note Creation Dates (1.2.4)

- Note writes during import and both rollback modes call `atomicWriteFile` with `preserveCreationTime: true`. On macOS it requires an existing regular file, snapshots nanosecond metadata, writes a sibling temporary file, copies the original birthtime with the native helper, preserves ordinary permission bits, verifies the resulting birthtime and checks for concurrent changes before atomic rename. Modified time stays that of the new content; no in-place truncation fallback is allowed.
- The filesystem-only C helper uses Apple's [fsetattrlist/ATTR_CMN_CRTIME API](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/setattrlist.2.html), rejects symbolic links and identical/nonregular files, and touches only the replacement's birthtime. macOS `cp -p`/`ditto` alone were tested and did not retain the true birthtime when it differed from mtime, so do not substitute them. `fs.utimes` is not a birthtime setter.
- Portable builds compile and sign the helper into `Contents/Resources/bin`. Source workflows compile it into `build/bin` through `npm run build:native`, automatically invoked by `npm start`, `npm test`, and the legacy setup script. No development tools are needed on the destination Mac. Missing/failed helpers and verification failures must abort the note replacement and clean the temporary file, never silently reset the date.
- Generic JSON writes and attachment restoration retain their existing path; the creation-date preservation option applies only to macOS note writes. Backups from earlier versions do not contain historical birthtimes, so do not guess or backdate existing user notes. Independent changes by iCloud or another editor are outside this writer's control.
- Regression coverage in `tests/fileMetadata.test.mjs`, `tests/audit.test.mjs`, and `tests/desktop.test.mjs` checks exact timestamps, advancing mtime, permissions, failures, concurrent edits, symlinks, import, individual/run rollback, and the packaged backend without development tools on PATH.

### Screenshots Selection and Appearance (1.2.x)

- Double-click the Use cell or checkbox to select or clear all folders with the exact same nonempty note path. Decide the target state from the clicked row before the first click: unchecked selects, checked clears, including partially selected groups. Never group by title alone or group unmatched rows. Other notes retain their selections.
- Checkbox updates do not rebuild rows, so native double-click delivery remains reliable. Shift ranges follow visible sorted rows. Rerendering or changing sort resets the range anchor.
- Source and Note use natural text sorting; S and E use numeric sorting, including padded numbers. Work and missing values stay last for S/E in either direction. Missing Note stays last for Note sorting. Ties retain scan order.
- Click a header to cycle ascending, descending, no sort. Reset sorting restores scan order (latest modified first); mobile uses the equivalent select. `state.folders` is never reordered; a separate view keeps import payload and numeric Markdown insertion unchanged. Sort lasts for the current session and survives Refresh; it does not persist across launches.
- Theme is a validated `system | light | dark` preference stored in shared settings. System follows `prefers-color-scheme` changes live. A main-frame, same-origin native message updates AppKit appearance; System clears the manual appearance override.
- `window.flushAppSettings()` is the explicit ES-module-to-native shutdown bridge, so pending debounced writes are awaited before backend shutdown.
- Header labels and sort buttons use equal-height flex containers so their text shares the same vertical center. Reset sort uses Lucide undo-2; Refresh uses refresh-cw. Folder buttons use Lucide folder and note buttons use the official Obsidian mark. Assets and notices are bundled under public/icons; SVGs are served with image/svg+xml for WKWebView and browser compatibility.

### Zero Episodes and Duplicate Targets (1.2.2)

- `public/episodeSelection.js` provides shared browser/backend parsing. Season must be an integer >= 1; Episode must be an integer >= 0. Empty strings, whitespace-only strings, missing values, negatives, fractions, and unsafe integers are rejected, not coerced to zero.
- Keep E0 through editing, rerenders, payload generation, numeric sorting, import logs, History summaries, target labels, and Obsidian links. Use null checks rather than truthiness for episode numbers.
- Before submitting Run, group selected Episode rows by exact note path and numeric season/episode. Padded values like E00 match E0. Unselected rows, Work rows, other notes/seasons, and invalid numbers do not form duplicates.
- For duplicate groups, show a modal with each Note, episode, folder count, and all folder names. Cancel or Escape aborts before any import request; Continue Run imports the captured selection. Native dialog focus management keeps background controls inert.
- Since 1.2.3 the duplicate dialog uses a content-height flex layout instead of the shared modal grid, which stretched to 720px in native WebKit even for one group. Only the group list scrolls at the height limit; the heading, description, and action buttons remain visible. Validate in the native app, not only Chromium. `node tests/create-desktop-fixture.mjs --duplicates` creates an isolated 12-group fixture: select the first pair for the compact case or all folders for the scrolling case, using its generated locations.json as the native test profile.
- Import folders serially using the existing Markdown heading matcher, so duplicates share one heading, including existing padded/commented headings. E0 is inserted before E1. Each source retains its own marked block, archive entry, History item, and rollback journal; merging the destination does not merge or discard originals.

The standalone Apple Silicon app is built into `dist`, with bundled runtimes, a native macOS window, random local port, folder selection, and graceful shutdown. User data stays outside the bundle; existing project data is discovered without relocation. See [PORTABLE-APP.md](PORTABLE-APP.md) for current launch/transfer instructions, architecture, reproducible build, and multi-Mac limitations. Older launcher instructions below describe the legacy source-based workflow only.

## Цель

Автоматизировать перенос скриншотов и изображений в заметки Obsidian с фильмами, сериалами, аниме, играми, мангой и комиксами. IINA был исходным источником, но подойдет любая папка с изображениями в подпапках по произведениям.

Исходная ручная процедура:

1. IINA сохраняет скриншоты в папки по контенту.
2. Пользователь вручную переносит картинки в Obsidian.
3. Obsidian Image Converter конвертирует изображения, кладет их в attachment-папку и вставляет wiki-link.
4. Для сериалов/аниме пользователь вручную раскладывает скриншоты по разделам серий.

Этот проект заменяет ручную часть standalone-приложением:

1. Сканирует папки со скриншотами.
2. Сканирует только разрешенные папки с media-заметками Obsidian.
3. Автоматически предлагает заметку и `S#E#`.
4. Дает поправить сопоставление перед запуском.
5. Конвертирует изображения самостоятельно.
6. Кладет результат в attachment-папку по правилам, аналогичным текущим настройкам Image Converter.
7. Вставляет `![[...]]` в нужный раздел Markdown.
8. Переносит исходники в архив, не удаляя их окончательно.
9. Позволяет откатить изменения по run-log.

## Настройка путей

В приложении пути выбираются через Settings > Choose Folders...; ниже приведена примерная структура. При запуске из исходников можно задать свои абсолютные пути переменными окружения из README.md. Исторические дефолты оставлены для совместимости с существующими настройками.

Скриншоты:

```text
~/Pictures/Screenshots
```

Vault:

```text
~/Documents/My Vault
```

Media root:

```text
~/Documents/My Vault/Bases/Databases/Media
```

Искать и редактировать заметки можно только внутри:

```text
Anime
Movies
Series
Cartoons
Games
Manga
Comics
```

Attachment template:

```text
All Notes/Attachments/{notename}/
```

`{notename}` - имя `.md` файла без расширения.

## Формат скриншотов IINA

В IINA используется формат:

```text
%f/%f.%wH-%wM-%wS.%#n
```

Поэтому скрипт сохраняет оригинальное имя файла, меняя только расширение при конвертации. Например:

```text
Dungeon Meshi - 22 [BDRip 1080p AVC FLAC].mkv.00-12-20.0001.png
```

становится:

```text
Dungeon Meshi - 22 [BDRip 1080p AVC FLAC].mkv.00-12-20.0001.webp
```

Если файл с таким именем уже существует в destination-папке, дефолтная политика `increment` добавляет суффикс:

```text
...0001-1.webp
```

Это единственный случай, когда имя меняется не только расширением.

## Конвертация

Дефолтные настройки повторяют текущую идею Image Converter:

```text
format: webp
quality: 90
resize: none
filename: keep original name
destination: All Notes/Attachments/{notename}/
```

Основной encoder: `cwebp`.

Команда для WebP:

```bash
cwebp -q 90 -m 6 -mt -quiet input.png -o output.webp
```

Глобальные `quality` и `format` меняются в `Settings`. Поддерживаемые режимы:

```text
webp
jpg
png
original
```

`webp` использует `cwebp`.

`jpg` и `png` используют `ffmpeg`.

`original` просто копирует файл без конвертации.

Для WebP есть настройка `effort` от `0` до `6`. Она соответствует `cwebp -m`: это не качество картинки, а усилие encoder-а. Чем выше значение, тем дольше кодирование и обычно тем меньше итоговый файл при том же `quality`. Для цели "минимальный размер с минимальными видимыми потерями" дефолт `quality=90`, `effort=6`. Если пачка большая и хочется быстрее, можно временно поставить `effort=4`.

В `Screenshots` у каждой строки есть поле `Quality`. По умолчанию оно зависит от типа выбранной заметки и берется из блока `Settings -> Default Quality`. Значения сохраняются в `data/settings.json`; начальные defaults: `Anime=50`, остальные media-категории `90`. Значение может быть переопределено на уровне выбранной заметки. Если поменять `Quality` у одной строки, значение применится ко всем строкам с тем же `notePath`. При запуске Run каждая папка использует собственное видимое значение `Quality`; `format`, `effort` и conflict policy остаются глобальными из `Settings`.

В строке `Screenshots` есть кнопка `◐` для preview. Она открывает окно со списком исходных файлов выбранной папки, thumbnails, общим количеством файлов и суммарным размером. Для выбранного кадра показываются оригинал и результат временной конвертации вертикально друг под другом, потому что большинство кадров горизонтальные. Рядом с каждым вариантом есть квадратный center-crop/zoom, чтобы быстро сравнить детали без открытия картинки отдельно. Клик по preview-картинке открывает ее в новой вкладке.

В preview можно менять `format`, `quality` и `effort`, чтобы оценить размер и визуальные потери на конкретном кадре. Эти настройки тестовые и не меняют глобальные `Settings`. Кнопка `Apply Quality` переносит только выбранное значение `Quality` в основную таблицу, применяет его ко всем строкам с той же заметкой и закрывает preview.

Рядом с preview-полем `Quality` есть кнопка `Auto N`, если выбранный формат поддерживает quality-based compression (`webp` или `jpg`). Она считается по реальным временным конвертациям выбранного кадра на нескольких значениях quality. Алгоритм выбирает точку, где файл уже сильно сжат, а следующий шаг вниз дает сравнительно небольшой дополнительный выигрыш по размеру. Это стартовая рекомендация, а не визуальная гарантия качества.

## Сопоставление заметок

Сканируются `.md` файлы внутри разрешенных media-папок.

Для поиска используются:

1. Имя файла заметки без `.md`.
2. `aliases` из YAML frontmatter.
3. `alias` и `title`, если они есть в frontmatter.

В интерфейсе каждая заметка показывается с первой буквой папки:

```text
[A] Delicious in Dungeon (2024)
[S] The Last of Us (2023)
[G] The Last of Us (2013)
```

Это помогает отличать одноименные игры/сериалы/фильмы.

Если автоматическое сопоставление ошиблось, пользователь выбирает правильную заметку вручную. После успешного запуска приложение сохраняет правило в:

```text
data/rules.json
```

Правило привязано к нормализованному названию источника, поэтому пример:

```text
Dungeon Meshi - 23 [BDRip 1080p AVC FLAC].mkv
```

после ручного выбора может в будущем автоматически вести к:

```text
Anime/Delicious in Dungeon (2024).md
```

В интерфейсе такое сопоставление показывается как `Saved rule`. Это означает, что заметка выбрана из сохраненного правила, а не из текущей fuzzy-вероятности.

## Определение сезона и серии

Автоматически распознаются частые форматы:

```text
Spider.Noir.2026.S01E03.Double.Cross._BW_ → S1E3
[ReinForce] Dan Da Dan (S02) (2025) - 08 → S2E8
GTO - 05 [DVDRip 960x720 x264 AC3] → S1E5
Serial_Experiments_Lain_02_BDRip_hi10p_1080p → S1E2
One Punch Man S2 - 10 → S2E10
[DeadLine] One-Punch Man TV3 - 09 → S3E9
Kaijuu 8 Gou TV-2 - 11 → S2E11
```

Определение может ошибаться, поэтому `Season` и `Episode` всегда редактируются в интерфейсе перед запуском.

## Вставка в Markdown

### Фильм или одиночная заметка

Ищется heading `Скриншоты` с любым количеством `#`:

```md
### Скриншоты
```

Если раздел найден, ссылки вставляются в конец этого раздела, перед следующим heading того же или более высокого уровня.

Если раздела нет, он создается в конце заметки:

```md
### Скриншоты
```

### Сериал, аниме или эпизодическая заметка

Ищется heading серии:

```md
#### S2E6
```

Пробел после `#` не обязателен, то есть `####S2E6` тоже считается.

Если heading найден, ссылки вставляются в конец раздела серии, перед следующим heading того же или более высокого уровня. Уже существующий текст пользователя не стирается.

Если heading серии не найден:

1. Ищется heading сезона `Season 2`.
2. Если сезон найден, внутри него создается `S2E6` в номерном порядке среди уже существующих эпизодов.
3. Если сезон не найден, создается heading сезона и первый episode heading:

```md
### Season 2
#### S2E6
```

Уровень heading сезона подбирается по предыдущему сезону, например если есть `## Season 1`, то будет создан `## Season 2`. Если предыдущего сезона нет, используется `### Season N`.

Episode headings ищутся по началу заголовка, поэтому оба варианта считаются правильными и новый heading не создается:

```md
#### S2E9
#### S2E09 Герой пошел гулять
```

Перед обработкой выбранные папки сортируются по заметке, сезону и номеру эпизода. Это нужно, чтобы новые headings добавлялись в номерном порядке, а не в порядке текущей сортировки таблицы.

### Маркеры вставки

Каждая вставка оборачивается markers:

```md
<!-- iina-screenshot-importer:start run=RUN_ID source="SOURCE_FOLDER" -->
![[All Notes/Attachments/Note Name/file.webp]]
<!-- iina-screenshot-importer:end run=RUN_ID -->
```

Маркеры нужны для понятного diff и надежного rollback.

## Архив исходников

После успешной обработки исходная папка со скриншотами переносится сюда:

```text
Screenshots/_archive/<run-id>/<original-folder-name>
```

Архивная папка игнорируется при следующем сканировании.

Исходники не удаляются. Если результат не понравился, можно откатить run или вручную вернуть папку из `_archive`.

## Rollback

Каждый запуск пишет run-log:

```text
data/runs/<run-id>.json
```

Также перед изменением каждой заметки сохраняется backup:

```text
data/backups/<run-id>/<vault-relative-note-path>.md
```

Run-level rollback делает несколько вещей:

1. Проходит папки в обратном порядке и удаляет только их marker blocks. Полная заметка из старого backup автоматически не восстанавливается: поздние записи и другие импорты сохраняются.
2. Удаляет созданные attachment-файлы. Файлы, на которые остались ссылки в разрешенных Media-категориях, сохраняются. Для новых runs проверяется SHA-256: измененный после импорта файл остается на месте, откат получает статус `Partial`.
3. Для новых runs с `overwrite` восстанавливает прежние attachments из `data/backups/<run-id>/attachments/`. Конвертация сначала пишет временный файл, поэтому сбой encoder-а не обрезает существующий attachment.
4. Возвращает исходные папки из `_archive`. Отсутствующий архив или уже занятая исходная папка проверяются до изменения заметки; конфликт требует разрешения и повторного отката.
5. Пропускает уже откатанные или отправленные в Trash папки; удаляет пустую папку архива. Правила ручного сопоставления сохраняются.

Журнал сохраняется атомарно по ходу импорта и отката. Ошибка или незавершенное действие остаются в истории; повторный откат пропускает уже завершенные операции. Старые журналы не содержат hashes и копий перезаписанных attachments, поэтому новые гарантии нельзя применить к ним задним числом.

Folder-level rollback доступен из `History` для отдельной обработанной папки. Он:

1. Удаляет marker block именно этой папки из Markdown.
2. Удаляет созданные attachment-файлы этой папки.
3. Возвращает исходную папку из `_archive`.

Оба уровня rollback используют одну логику. Пустые headings, созданные импортом, могут оставаться. Полные backups заметок сохранены для ручного восстановления.

## Interface

The UI is intentionally in English. It has three sections:

```text
Screenshots
History
Settings
```

### Screenshots

1. Список папок из `Screenshots`.
2. В header раздела показывается общий размер текущих входящих папок со скриншотами, без `_archive`.
3. Количество файлов, общий размер и date modified в 24-hour формате в каждой строке. Parsed title не показывается в строке, потому что он бывает неточным.
4. Автоматически найденная заметка.
5. Custom searchable dropdown для ручного выбора заметки. В поле показывается только короткий label, например `[A] Great Teacher Onizuka (1999)`, без длинного пути.
6. Compact icon button с логотипом Obsidian для открытия заметки.
7. Compact icon button с иконкой папки для открытия исходной папки со скриншотами в Finder.
8. Режим вставки: `Episode` или `Work`. `Episode` вставляет в heading `S#E#`, `Work` вставляет в раздел `Скриншоты`.
9. Поля `Season` и `Episode`.
10. Чекбокс включения папки в обработку.

После сканирования строки выключены по умолчанию. Это сделано намеренно, чтобы случайный клик по запуску не обработал десятки или сотни папок. Можно включить отдельные строки вручную или нажать `Select matched`.

Для массового выбора поддерживается Shift-click: выбрать первую строку, затем зажать Shift и выбрать последнюю строку диапазона. Также есть `Select all`, `Select matched` и `Clear`.

Кнопка `Refresh` с двухстрелочной иконкой находится в `Screenshots`, потому что она пересканирует именно текущие входящие папки со скриншотами.

Ручной выбор заметки сразу включает строку, помечает ее как `Manual`, сохраняет mapping rule и применяет его ко всем строкам с таким же распознанным source title. Например, если выбрать заметку для одной папки `GTO - 34 ...`, выбор применится к остальным `GTO - NN ...`, но каждая строка сохранит свой episode number.

Auto-match score показывается как `Auto 92%` только для текущего автоматически выбранного варианта. Проценты альтернатив всегда показываются прямо в suggestion buttons.

Header сервиса, tabs, progress bar, button `Run`, section header активного раздела и table header закреплены при прокрутке, чтобы прогресс и запуск были доступны из любой точки страницы. Tabs находятся в верхней части header, а `Run` расположен в progress band, потому что это действие текущего процесса, а не navigation. В idle-состоянии возле progress bar не показывается `Ready`; подсказка под ним говорит выбрать папки и нажать `Run`.

На широких экранах основной интерфейс ограничен максимальной шириной и центрируется, чтобы строки не растягивались до краев окна. На узких экранах таблица `Screenshots` переключается в компактные card-like rows: table header скрывается, поля note/mode/S/E перестраиваются внутри каждой строки, а горизонтальный scroll у страницы не появляется. Поля `Season` и `Episode` сделаны текстовыми numeric-полями, чтобы macOS/browser не показывали native stepper arrows поверх значения.

### History

`History` объединяет старые `Results` и `Runs`. Все обработанные папки сгруппированы по run.

Header раздела показывает:

1. количество run-log записей;
2. общий размер `_archive`;
3. количество файлов в `_archive`;
4. кнопки `Open Archive` с иконкой папки, `Trash Archive`, `Refresh` с двухстрелочной иконкой.

`Trash Archive` переносит содержимое `_archive` в стандартную корзину macOS через прямой move в `~/.Trash`, без Finder/AppleScript automation. Это не permanent delete: файлы можно восстановить из Trash, пока корзина не очищена.

Run-level card показывает:

1. дату обработки в 24-hour формате;
2. количество папок;
3. статус (`Done`, `Rollbacked`, `Trashed`);
4. количество файлов;
5. общий размер до и после с процентом сокращения в скобках;
6. количество отсутствующих source folders, если папки из `_archive` были удалены;
7. кнопку открытия run archive в Finder, если archive folder еще существует;
8. кнопки `Trash` и `Rollback Run`, если статус `Done` и действие возможно.

Если все folder rows внутри run имеют один общий статус (`Rollbacked` или `Trashed`), run-level status автоматически принимает тот же статус. Например, если все папки были rollbacked по отдельности, run card показывает `Rollbacked` и серую status button `Rollbacked`, даже если run-level rollback целиком не запускался.

Run ID не показывается отдельной строкой, чтобы не шуметь в интерфейсе. Он спрятан в tooltip run card.

Дата rollback/trash не выводится отдельной строкой. Если rollback уже был, вместо action-кнопок показывается серая `Rollbacked` с датой в tooltip. Если source archive был отправлен в Trash, вместо action-кнопок показывается серая `Trashed` с датой в tooltip, когда действие было выполнено через интерфейс.

Runs свернуты по умолчанию. Их можно раскрывать/сворачивать кнопкой рядом с заголовком. Вложенные folder rows имеют левый отступ и border, чтобы визуально было понятно, что они принадлежат конкретному run.

Folder row внутри run показывает:

1. target, например `Great Teacher Onizuka (1999) · S1E34`;
2. source folder;
3. количество файлов;
4. размер до и после с процентом сокращения в скобках;
5. кнопку открытия заметки в Obsidian;
6. кнопку открытия archived source folder в Finder, если она еще существует;
7. кнопку `Trash`, чтобы точечно отправить исходную archived folder этой папки в macOS Trash;
8. кнопку rollback только этой папки.

Folder title не показывает `Work`: для работ без эпизодов формат `Note Name · Status`, для эпизодов `Note Name · S#E# · Status`.

Если исходная папка была удалена из `_archive` и ее уже нет в исходной `Screenshots`, UI трактует это как `Trashed`: rollback для этой папки недоступен. Остальные доступные папки можно откатывать через `Rollback Run`.

После `Trash` или `Trash Archive` интерфейс показывает, сколько файлов и какой объем были отправлены в Trash.

После завершения обработки показывается modal `Done` с total summary и разбивкой по папкам. Эти же данные сохраняются в History.

После `Rollback Run` показывается modal `Rollback Done` или `Rollback Partial`: возвращенные исходные папки, обновленные заметки, удаленные, восстановленные и сохраненные attachments, пропущенные папки и ошибки. Верхний progress bar показывает начало и завершение операции, а не точный прогресс каждого файла. `Partial` не подменяется успешным `Rollbacked`; повторный откат остается доступен.

### Settings

`Settings` имеет такую же section header, как `Screenshots` и `History`, и содержит:

1. `Appearance`: Theme (System, Light, Dark), сохраняется в settings.json.
2. `Output`: format, WebP effort, filename conflict policy, Parallel Images.
3. `Quality Defaults`: fallback и качества по media-категориям Anime, Movies, Series, Cartoons, Games, Manga, Comics.
4. `Locations`: screenshots root, vault root, media root, attachments template.

`Settings -> Quality Defaults` задает дефолт для новых строк с выбранной заметкой. Переопределения для конкретных заметок сохраняют приоритет. `Fallback` используется без выбранной категории. На диске сохраняются качества категорий; Output, Fallback и переопределения отдельных заметок пока относятся к текущей сессии браузера.

Список Runs в интерфейсе показывает последние 50 запусков, чтобы через год страница не превращалась в бесконечный список. Полные run-log файлы остаются в `data/runs/`.

## Запуск

### Первичная настройка Mac

На каждом новом Mac один раз выполнить:

```bash
/bin/zsh scripts/setup-macos.zsh
```

Скрипт проверяет и устанавливает недостающее:

1. Homebrew;
2. Node.js `>=20`;
3. `npm`;
4. `cwebp` из Homebrew formula `webp`;
5. `ffmpeg`;
6. macOS C compiler / Command Line Tools;
7. пересобирает `.app` launcher wrapper под текущую архитектуру Mac;
8. запускает smoke-test: старт сервиса, `/api/health`, остановка сервиса.

Если какая-то зависимость уже установлена, она помечается `OK` и не переустанавливается. Если Homebrew отсутствует, будет запущен официальный installer Homebrew; он может попросить пароль или предложить поставить Apple Command Line Tools.

### macOS app launcher

Основной удобный способ без Terminal:

```text
macos/Obsidian Screenshot Automation.app
```

Двойной клик по app:

1. проверяет, не запущен ли уже сервис на `127.0.0.1:3787`;
2. если сервис не запущен, находит `node` и запускает `src/server.mjs`;
3. открывает `http://127.0.0.1:3787` в браузере;
4. показывает маленький macOS dialog с кнопками `Open App` и `Stop Service`;
5. по `Stop Service` останавливает сервис и закрывается.

Внутри `.app` используется нативный Mach-O wrapper `Contents/MacOS/ObsidianScreenshotAutomation`, который запускает shell-логику из `Contents/Resources/launcher.zsh`. Это сделано потому, что LaunchServices/Finder надежнее запускает compiled executable, чем shell script как прямой `CFBundleExecutable`.

Логи launcher-а и сервера пишутся сюда:

```text
data/launcher.log
```

Для диагностики launcher поддерживает два служебных режима:

```bash
macos/Obsidian\ Screenshot\ Automation.app/Contents/MacOS/ObsidianScreenshotAutomation --doctor
macos/Obsidian\ Screenshot\ Automation.app/Contents/MacOS/ObsidianScreenshotAutomation --smoke
```

`--doctor` проверяет, что найден `node`. `--smoke` стартует сервис тем же способом, проверяет `/api/health` и сразу останавливает его без открытия browser/dialog.

PID сервиса, запущенного launcher-ом, хранится здесь:

```text
data/launcher.pid
```

Если хочется держать app под рукой, можно перетащить `Obsidian Screenshot Automation.app` в Dock или сделать alias в Finder.

### Terminal fallback

Простой запуск из Terminal:

```bash
cd obsidian-screenshot-importer
npm start
```

Открыть:

```text
http://localhost:3787
```

Остановка, если сервис запущен в текущем Terminal:

```text
Ctrl+C
```

Если Terminal уже закрыт или процесс остался висеть на порту:

```bash
lsof -ti tcp:3787 | xargs kill
```

## Проверка

```bash
npm test
```

Тесты используют временные фикстуры и не трогают настоящие скриншоты или Obsidian vault.

## Важные ограничения

1. Приложение редактирует Markdown напрямую, без Obsidian API.
2. Obsidian может быть открыт или закрыт, но после обработки ему может понадобиться немного времени на индексирование новых attachment-файлов.
3. Качество WebP через `cwebp -q 90` визуально близко к настройке Image Converter `quality=90`, но итоговый файл не обязан быть бит-в-бит таким же.
4. На другом Mac должны быть доступны `node`, `cwebp` и `ffmpeg`.
5. Если `cwebp` не найден, режим `webp` не сможет запускаться.
6. Preview-конвертация и Auto Quality используют те же encoder-ы, что и реальный Run, но обрабатывают только выбранный файл и хранят результаты временно.

## Почему не использовать Image Converter напрямую

Image Converter в Obsidian в основном срабатывает на paste/drop внутри редактора. Если внешний скрипт просто дописывает wiki-links в `.md`, он обходит конвертацию. Можно было бы писать отдельный Obsidian-плагин и дергать внутренности Image Converter, но это делает проект зависимым от приватной реализации другого плагина.

Standalone-конвертация через `cwebp` проще:

1. Obsidian не должен быть открыт.
2. Прогресс и ETA считаются честно.
3. Не нужно ждать конвертации тяжелых картинок внутри редактора.
4. Rollback надежнее, потому что приложение само знает, какие файлы создало.
5. Меньше риска сломаться после обновления Image Converter.
