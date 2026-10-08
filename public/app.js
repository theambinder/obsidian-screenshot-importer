import { nextFolderSort, sortFolders, setNoteFoldersEnabled, selectFolderRange } from './folderTable.js';
import { normalizeTheme, resolveTheme } from './theme.js';
import { parseSeasonNumber, parseEpisodeNumber, hasEpisodeNumbers, findDuplicateEpisodes } from './episodeSelection.js';
import { createTabScroll } from './tabScroll.js';

const state = {
  config: null,
  screenshotsSummary: null,
  settings: {
    mediaDirs: [],
    qualityDefaults: {},
  },
  settingsTimer: null,
  settingsSave: Promise.resolve(),
  notes: [],
  folders: [],
  folderSort: null,
  visibleFolders: [],
  noteValues: new Map(),
  qualityByNotePath: new Map(),
  jobTimer: null,
  lastCheckboxIndex: null,
  openRunIds: new Set(),
  preview: {
    folder: null,
    files: [],
    selectedFile: null,
    requestId: 0,
    suggestionRequestId: 0,
    timer: null,
    suggestionTimer: null,
    suggestedQuality: null,
    sourceRequestId: 0,
    conversionController: null,
    suggestionController: null,
  },
};

const $ = (selector) => document.querySelector(selector);

const els = {
  archiveSummary: $('#archiveSummary'),
  attachmentsTemplate: $('#attachmentsTemplate'),
  clearArchiveButton: $('#clearArchiveButton'),
  clearSelectionButton: $('#clearSelectionButton'),
  closeModalButton: $('#closeModalButton'),
  closePreviewButton: $('#closePreviewButton'),
  currentText: $('#currentText'),
  doneModal: $('#doneModal'),
  doneModalBody: $('#doneModalBody'),
  doneOkButton: $('#doneOkButton'),
  doneTitle: $('#doneTitle'),
  effortSelect: $('#effortSelect'),
  foldersBody: $('#foldersBody'),
  formatSelect: $('#formatSelect'),
  mediaPath: $('#mediaPath'),
  openArchiveButton: $('#openArchiveButton'),
  openHistoryButton: $('#openHistoryButton'),
  progressFill: $('#progressFill'),
  progressText: $('#progressText'),
  previewConvertedImage: $('#previewConvertedImage'),
  previewConvertedCropImage: $('#previewConvertedCropImage'),
  previewConvertedCropLink: $('#previewConvertedCropLink'),
  previewConvertedLink: $('#previewConvertedLink'),
  previewConvertedMeta: $('#previewConvertedMeta'),
  previewEffortSelect: $('#previewEffortSelect'),
  previewFileList: $('#previewFileList'),
  previewFolderTitle: $('#previewFolderTitle'),
  previewFormatSelect: $('#previewFormatSelect'),
  previewModal: $('#previewModal'),
  previewOriginalCropImage: $('#previewOriginalCropImage'),
  previewOriginalCropLink: $('#previewOriginalCropLink'),
  previewOriginalImage: $('#previewOriginalImage'),
  previewOriginalLink: $('#previewOriginalLink'),
  previewOriginalMeta: $('#previewOriginalMeta'),
  previewQualityInput: $('#previewQualityInput'),
  previewSuggestedQualityButton: $('#previewSuggestedQualityButton'),
  previewStatus: $('#previewStatus'),
  qualityInput: $('#qualityInput'),
  qualityDefaultsFields: $('#qualityDefaultsFields'),
  refreshRunsButton: $('#refreshRunsButton'),
  runButton: $('#runButton'),
  runsList: $('#runsList'),
  runsSummary: $('#runsSummary'),
  scanButton: $('#scanButton'),
  screenshotsPath: $('#screenshotsPath'),
  selectAllButton: $('#selectAllButton'),
  selectionSummary: $('#selectionSummary'),
  stickyShell: $('#stickyShell'),
  toggleMatchedButton: $('#toggleMatchedButton'),
  vaultPath: $('#vaultPath'),
  conflictSelect: $('#conflictSelect'),
  applyPreviewQualityButton: $('#applyPreviewQualityButton'),
};

const tabScroll = createTabScroll({
  initialTab: 'screenshots',
  readScroll: () => window.scrollY,
  writeScroll: (top) => window.scrollTo(0, top),
});
document.querySelectorAll('.tab-button').forEach((button) => {
  button.title = 'Double-click to scroll to the top';
  button.addEventListener('click', () => setTab(button.dataset.tab));
  button.addEventListener('dblclick', (event) => {
    event.preventDefault();
    setTab(button.dataset.tab, { toTop: true });
  });
});
if (window.webkit?.messageHandlers?.locations) {
  const button = $('#desktopLocationsButton');
  button.hidden = false;
  button.addEventListener('click', () => window.webkit.messageHandlers.locations.postMessage({}));
}
els.scanButton.addEventListener('click', () => scan().catch(showFatal));
els.runButton.addEventListener('click', () => runSelected().catch(showFatal));
els.selectAllButton.addEventListener('click', () => setAllEnabled(true));
els.toggleMatchedButton.addEventListener('click', () => setMatchedEnabled(true));
els.clearSelectionButton.addEventListener('click', () => setAllEnabled(false));
els.refreshRunsButton.addEventListener('click', () => loadRuns().catch(showFatal));
els.openArchiveButton.addEventListener('click', openArchiveFolder);
els.clearArchiveButton.addEventListener('click', clearArchive);
els.closeModalButton.addEventListener('click', hideDoneModal);
els.doneOkButton.addEventListener('click', hideDoneModal);
els.closePreviewButton.addEventListener('click', hidePreviewModal);
els.applyPreviewQualityButton.addEventListener('click', applyPreviewQuality);
els.previewFormatSelect.addEventListener('change', handlePreviewEncoderChange);
els.previewQualityInput.addEventListener('input', schedulePreviewConversion);
els.previewEffortSelect.addEventListener('change', handlePreviewEncoderChange);
els.previewSuggestedQualityButton.addEventListener('click', useSuggestedPreviewQuality);
els.qualityInput.addEventListener('change', syncDefaultQuality);
els.qualityDefaultsFields.addEventListener('input', handleQualityDefaultInput);
$('#parallelImagesSelect').addEventListener('change', (event) => {
  state.settings.parallelImages = Number(event.target.value);
  scheduleSettingsSave();
});
const systemAppearance = window.matchMedia('(prefers-color-scheme: dark)');
systemAppearance.addEventListener('change', applyTheme);
$('#themeSelect').addEventListener('change', (event) => {
  state.settings.theme = normalizeTheme(event.target.value);
  applyTheme();
  // Save immediately so quitting right after a theme switch retains the choice.
  clearTimeout(state.settingsTimer);
  state.settingsTimer = null;
  saveSettings().catch(showFatal);
});
document.querySelectorAll('[data-sort-key]').forEach((button) => {
  button.addEventListener('click', () => setFolderSort(nextFolderSort(state.folderSort, button.dataset.sortKey)));
});
$('#folderSortSelect').addEventListener('change', (event) => {
  const [key, direction] = event.target.value.split(':');
  setFolderSort(key ? { key, direction } : null);
});
$('#resetSortButton').addEventListener('click', () => setFolderSort(null));
els.openHistoryButton.addEventListener('click', () => {
  hideDoneModal();
  setTab('history');
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.note-picker')) hideNoteMenus();
});

setupStickyOffset();
initialize().catch(showFatal);

// ES module bindings are not visible to the native window's shutdown script.
window.flushAppSettings = async () => {
  if (state.settingsTimer) {
    clearTimeout(state.settingsTimer);
    state.settingsTimer = null;
    await saveSettings();
  } else {
    await state.settingsSave;
  }
};

function applyTheme() {
  const preference = normalizeTheme(state.settings.theme);
  document.documentElement.dataset.theme = resolveTheme(preference, systemAppearance.matches);
  $('#themeSelect').value = preference;
  window.webkit?.messageHandlers?.theme?.postMessage(preference);
}

function setFolderSort(sort) {
  state.folderSort = sort;
  state.lastCheckboxIndex = null;
  renderFolders();
}

function renderFolderSort() {
  const sort = state.folderSort;
  $('#folderSortSelect').value = sort ? `${sort.key}:${sort.direction}` : '';
  $('#resetSortButton').disabled = !sort;
  document.querySelectorAll('[data-sort-key]').forEach((button) => {
    const active = sort?.key === button.dataset.sortKey;
    button.setAttribute('aria-label', `Sort by ${button.dataset.sortLabel}${active ? `, ${sort.direction === 'asc' ? 'ascending' : 'descending'}` : ''}`);
    button.querySelector('.sort-indicator').textContent = active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕';
    button.classList.toggle('active', active);
    const header = button.closest('th');
    if (!header.classList.contains('episode-sort-header')) {
      header.setAttribute('aria-sort', active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none');
    }
  });
}

async function initialize() {
  await loadSettings();
  await Promise.all([
    scan(),
    loadRuns(),
  ]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    const message = response.headers.get('content-type')?.includes('application/json')
      ? (await response.json()).error
      : await response.text();
    throw new Error(message || `${response.status} ${response.statusText}`);
  }
  return response.json();
}

function setTab(tab, options) {
  const changed = tabScroll.activate(tab, () => {
    document.querySelectorAll('.tab-button').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.hidden = panel.id !== `${tab}Panel`;
    });
    setupStickyOffset();
  }, options);
  if (changed && tab === 'history') loadRuns().catch(showFatal);
}

async function scan() {
  setBusy(true, 'Scanning...');
  const data = await api('/api/scan');
  state.config = data.config;
  state.screenshotsSummary = data.screenshotsSummary || null;
  state.notes = data.notes;
  state.folders = data.folders.map((folder) => ({
    ...folder,
    enabled: false,
    ...initialQualityForFolder(folder),
  }));
  state.lastCheckboxIndex = null;
  renderPaths();
  buildNoteIndex();
  renderFolders();
  setProgress({ percent: 0, doneFiles: 0, totalFiles: 0, status: 'ready' });
  setBusy(false);
}

function renderPaths() {
  if (!state.config) return;
  els.screenshotsPath.textContent = state.config.screenshotsRoot;
  els.vaultPath.textContent = state.config.vaultRoot;
  els.mediaPath.textContent = state.config.mediaRoot;
  els.attachmentsTemplate.textContent = state.config.attachmentsTemplate;
}

async function loadSettings() {
  state.settings = await api('/api/settings');
  applyTheme();
  $('#appVersion').textContent = `v${state.settings.appVersion}`;
  $('#parallelImagesSelect').value = String(state.settings.parallelImages || 0);
  $('#parallelImagesSelect').options[0].textContent = `Auto (${state.settings.autoParallelImages})`;
  renderQualityDefaultsFields();
}

function renderQualityDefaultsFields() {
  const mediaDirs = state.settings?.mediaDirs || state.config?.mediaDirs || [];
  const qualityDefaults = state.settings?.qualityDefaults || {};
  els.qualityDefaultsFields.innerHTML = mediaDirs.map((mediaDir) => `
    <label>
      ${escapeHtml(mediaDir)}
      <input class="quality-default-input" type="number" min="1" max="100" value="${escapeAttr(defaultQualityForMediaDir(mediaDir))}" data-media-dir="${escapeAttr(mediaDir)}">
    </label>
  `).join('');
}

function handleQualityDefaultInput(event) {
  const input = event.target.closest('.quality-default-input');
  if (!input) return;
  const mediaDir = input.dataset.mediaDir;
  const quality = clampQuality(input.value, defaultQualityForMediaDir(mediaDir));
  state.settings.qualityDefaults = {
    ...(state.settings.qualityDefaults || {}),
    [mediaDir]: quality,
  };
  syncDefaultQuality();
  scheduleSettingsSave();
}

function scheduleSettingsSave() {
  clearTimeout(state.settingsTimer);
  state.settingsTimer = setTimeout(() => {
    state.settingsTimer = null;
    saveSettings().catch(showFatal);
  }, 450);
}

async function saveSettings() {
  const body = JSON.stringify({ qualityDefaults: state.settings.qualityDefaults || {}, parallelImages: state.settings.parallelImages || 0, theme: normalizeTheme(state.settings.theme) });
  state.settingsSave = state.settingsSave.catch(() => {}).then(() => api('/api/settings', {
    method: 'POST',
    body,
  }));
  await state.settingsSave;
  setStatusText('Settings saved');
}

function initialQualityForFolder(folder) {
  const notePath = folder.selectedNotePath || '';
  if (notePath && state.qualityByNotePath.has(notePath)) {
    return {
      quality: state.qualityByNotePath.get(notePath),
      qualityOverride: true,
    };
  }
  return {
    quality: defaultQualityForFolder(folder),
    qualityOverride: false,
  };
}

function defaultQuality() {
  return clampQuality(els.qualityInput.value, 90);
}

function defaultQualityForFolder(folder) {
  const note = noteForPath(folder.selectedNotePath);
  if (note?.mediaDir) return defaultQualityForMediaDir(note.mediaDir);
  return defaultQuality();
}

function defaultQualityForMediaDir(mediaDir) {
  return clampQuality(state.settings?.qualityDefaults?.[mediaDir], defaultQuality());
}

function clampQuality(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(100, Math.round(number)));
}

function qualityValue(folder) {
  return clampQuality(folder.quality, defaultQualityForFolder(folder));
}

function qualityTitle(folder) {
  if (folder.selectedNotePath) {
    const note = state.notes.find((candidate) => candidate.path === folder.selectedNotePath);
    const name = note?.label || folder.selectedNotePath;
    return `Quality for ${name}`;
  }
  return 'Quality for this folder';
}

function syncDefaultQuality() {
  for (const folder of state.folders) {
    if (!folder.qualityOverride) folder.quality = defaultQualityForFolder(folder);
  }
  renderFolders();
}

function setQualityForFolderGroup(sourceFolder, quality) {
  const normalizedQuality = clampQuality(quality, defaultQualityForFolder(sourceFolder));
  if (sourceFolder.selectedNotePath) {
    state.qualityByNotePath.set(sourceFolder.selectedNotePath, normalizedQuality);
    for (const folder of state.folders) {
      if (folder.selectedNotePath !== sourceFolder.selectedNotePath) continue;
      folder.quality = normalizedQuality;
      folder.qualityOverride = true;
    }
    return;
  }

  sourceFolder.quality = normalizedQuality;
  sourceFolder.qualityOverride = true;
}

function buildNoteIndex() {
  state.noteValues.clear();
  for (const note of state.notes) {
    state.noteValues.set(noteValue(note), note);
  }
}

function noteForPath(notePath) {
  if (!notePath) return null;
  return state.notes.find((candidate) => candidate.path === notePath) || null;
}

function renderFolders() {
  tabScroll.refresh('screenshots', renderFolderRows);
}

function renderFolderRows() {
  hideNoteMenus();
  state.lastCheckboxIndex = null;
  renderFolderSort();
  state.visibleFolders = sortFolders(state.folders, state.folderSort, state.notes);
  renderSelectionSummary();
  if (state.folders.length === 0) {
    els.foldersBody.innerHTML = '<tr><td colspan="6" class="empty">No screenshot folders found</td></tr>';
    return;
  }

  els.foldersBody.innerHTML = '';
  state.visibleFolders.forEach((folder, index) => {
    const isEpisodeMode = folder.mode === 'episode';
    const tr = document.createElement('tr');
    tr.className = 'folder-row';
    tr.dataset.index = String(index);
    tr.innerHTML = `
      <td class="use-cell" title="Double-click to select or clear all folders for this note">
        <input class="enabled-input" type="checkbox" ${folder.enabled ? 'checked' : ''} aria-label="Use ${escapeAttr(folder.name)}">
      </td>
      <td>
        <div class="source-line">
          <div class="source-name">${escapeHtml(folder.name)}</div>
          <button class="icon-button preview-folder" type="button" title="Preview compression" aria-label="Preview compression">◐</button>
          <button class="icon-button open-source" type="button" title="Open source folder" aria-label="Open source folder"><span class="ui-icon icon-folder" aria-hidden="true"></span></button>
        </div>
        <div class="source-meta">${escapeHtml(formatFolderMeta(folder))}</div>
      </td>
      <td>
        <div class="note-picker">
          <div class="note-control">
            <input class="note-input" value="${escapeAttr(valueForPath(folder.selectedNotePath))}" placeholder="Search note" autocomplete="off">
            <button class="icon-button open-note" type="button" title="Open note in Obsidian" aria-label="Open note in Obsidian" ${folder.selectedNotePath ? '' : 'disabled'}><img class="brand-icon" src="/icons/obsidian.svg" alt=""></button>
          </div>
          <div class="note-menu" hidden></div>
        </div>
        <div class="match-line">
          <span class="badge ${matchClass(folder)}">${matchLabel(folder)}</span>
          <div class="suggestions">
            ${folder.suggestions.slice(0, 3).map((suggestion) => `
              <button class="suggestion" type="button" data-note-path="${escapeAttr(suggestion.path)}" title="${escapeAttr(suggestion.label)}">
                ${escapeHtml(suggestion.label)} ${(suggestion.score * 100).toFixed(0)}%
              </button>
            `).join('')}
          </div>
        </div>
      </td>
      <td>
        <input class="row-quality-input" type="number" min="1" max="100" value="${escapeAttr(qualityValue(folder))}" aria-label="Quality for ${escapeAttr(folder.name)}" title="${escapeAttr(qualityTitle(folder))}">
      </td>
      <td>
        <select class="mode-select">
          <option value="episode" ${folder.mode === 'episode' ? 'selected' : ''}>Episode</option>
          <option value="screenshots" ${folder.mode !== 'episode' ? 'selected' : ''}>Work</option>
        </select>
      </td>
      <td>
        <div class="episode-fields">
          <input class="season-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${isEpisodeMode ? folder.parsed.season ?? '' : ''}" aria-label="Season" ${isEpisodeMode ? '' : 'disabled'}>
          <input class="episode-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${isEpisodeMode ? folder.parsed.episode ?? '' : ''}" aria-label="Episode" ${isEpisodeMode ? '' : 'disabled'}>
        </div>
      </td>
    `;

    const checkbox = tr.querySelector('.enabled-input');
    const noteInput = tr.querySelector('.note-input');
    const openNoteButton = tr.querySelector('.open-note');
    const noteMenu = tr.querySelector('.note-menu');
    const rowQualityInput = tr.querySelector('.row-quality-input');

    const useCell = tr.querySelector('.use-cell');
    let groupEnabled = false;
    useCell.addEventListener('click', (event) => {
      // A double-click includes two clicks; remember the state before the first.
      if (event.detail % 2 === 1) groupEnabled = !folder.enabled;
      const enabled = event.target === checkbox ? checkbox.checked : !folder.enabled;
      selectFolderRange(state.visibleFolders, index, event.shiftKey ? state.lastCheckboxIndex : null, enabled);
      state.lastCheckboxIndex = index;
      updateFolderSelection();
    });
    useCell.addEventListener('dblclick', (event) => {
      event.preventDefault();
      setNoteFoldersEnabled(state.folders, folder, groupEnabled);
      updateFolderSelection();
    });
    tr.querySelector('.open-source').addEventListener('click', () => openSourceFolder(folder.name));
    tr.querySelector('.preview-folder').addEventListener('click', () => openPreviewModal(folder).catch(showFatal));
    openNoteButton.addEventListener('click', () => openSelectedNote(folder));
    rowQualityInput.addEventListener('change', () => {
      const quality = clampQuality(rowQualityInput.value, defaultQuality());
      setQualityForFolderGroup(folder, quality);
      renderFolders();
    });
    noteInput.addEventListener('focus', () => renderNoteMenu(noteMenu, noteInput, folder));
    noteInput.addEventListener('input', () => {
      const exact = state.noteValues.get(noteInput.value);
      if (exact) {
        chooseNote(folder, exact.path).then(() => renderFolders()).catch(showFatal);
      } else {
        folder.selectedNotePath = '';
        folder.selectedNoteLabel = '';
        folder.matchReason = 'needs review';
        openNoteButton.disabled = true;
        renderNoteMenu(noteMenu, noteInput, folder);
      }
    });
    noteInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      const firstOption = noteMenu.querySelector('.note-option');
      if (firstOption) {
        event.preventDefault();
        chooseNote(folder, firstOption.dataset.notePath).then(() => renderFolders()).catch(showFatal);
      }
    });
    tr.querySelector('.mode-select').addEventListener('change', (event) => {
      folder.mode = event.target.value;
      if (folder.mode === 'episode' && folder.parsed.season == null) folder.parsed.season = 1;
      renderFolders();
    });
    tr.querySelector('.season-input').addEventListener('input', (event) => {
      const value = numericInputValue(event.target);
      folder.parsed.season = value === '' ? null : Number(value);
    });
    tr.querySelector('.episode-input').addEventListener('input', (event) => {
      const value = numericInputValue(event.target);
      folder.parsed.episode = value === '' ? null : Number(value);
    });
    for (const input of tr.querySelectorAll('.season-input, .episode-input')) {
      input.addEventListener('change', () => {
        if (state.folderSort) setFolderSort(state.folderSort);
      });
    }
    for (const button of tr.querySelectorAll('.suggestion')) {
      button.addEventListener('click', () => {
        chooseNote(folder, button.dataset.notePath).then(() => renderFolders()).catch(showFatal);
      });
    }
    els.foldersBody.append(tr);
  });
}

function updateFolderSelection() {
  // Keep the cell nodes alive between the first and second click of a double-click.
  for (const row of els.foldersBody.querySelectorAll('.folder-row')) {
    row.querySelector('.enabled-input').checked = state.visibleFolders[Number(row.dataset.index)].enabled;
  }
  renderSelectionSummary();
}

function renderSelectionSummary() {
  const selected = state.folders.filter((folder) => folder.enabled).length;
  const files = state.folders.filter((folder) => folder.enabled).reduce((sum, folder) => sum + folder.imageCount, 0);
  const summary = state.screenshotsSummary || summarizeVisibleFolders();
  els.selectionSummary.textContent = `${formatUnit(summary.folderCount, 'folder')} · ${formatUnit(summary.imageCount, 'screenshot')} · ${formatBytes(summary.bytes)} · ${formatCount(selected)} selected · ${formatUnit(files, 'selected screenshot')}`;
}

function formatFolderMeta(folder) {
  const parts = [
    formatUnit(folder.imageCount, 'file'),
    folder.totalSize || formatBytes(folder.totalBytes || 0),
  ];
  if (folder.latestMtimeMs) parts.push(formatDate(folder.latestMtimeMs));
  return parts.join(' · ');
}

function renderNoteMenu(menu, input, folder) {
  const query = input.value.trim();
  const matches = filterNotes(query).slice(0, 10);
  if (matches.length === 0) {
    menu.innerHTML = '<div class="note-empty">No matches</div>';
    menu.hidden = false;
    return;
  }
  menu.innerHTML = matches.map((note) => `
    <button class="note-option" type="button" data-note-path="${escapeAttr(note.path)}">
      ${escapeHtml(noteValue(note))}
    </button>
  `).join('');
  for (const option of menu.querySelectorAll('.note-option')) {
    option.addEventListener('mousedown', (event) => {
      event.preventDefault();
      chooseNote(folder, option.dataset.notePath).then(() => renderFolders()).catch(showFatal);
    });
  }
  menu.hidden = false;
}

function hideNoteMenus() {
  for (const menu of document.querySelectorAll('.note-menu')) {
    menu.hidden = true;
  }
}

function filterNotes(query) {
  const normalizedQuery = normalizeClient(query);
  if (!normalizedQuery) return state.notes.slice(0, 10);
  const tokens = normalizedQuery.split(' ').filter(Boolean);
  return state.notes
    .map((note) => {
      const haystack = normalizeClient([
        note.label,
        note.noteName,
        note.mediaDir,
        ...(note.aliases || []),
      ].join(' '));
      const score = tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      return { note, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.note.label.localeCompare(b.note.label))
    .map((entry) => entry.note);
}

async function chooseNote(folder, notePath, options = {}) {
  const note = state.notes.find((candidate) => candidate.path === notePath);
  if (!note) return;
  const manual = options.manual !== false;
  applyNoteToFolder(folder, note, manual ? 'manual' : folder.matchReason);
  if (manual) {
    applyManualRuleToSimilarFolders(folder, note);
    await rememberManualRule(folder);
  }
}

function applyNoteToFolder(folder, note, reason) {
  folder.selectedNotePath = note.path;
  folder.selectedNoteLabel = note.label;
  folder.enabled = true;
  folder.matchReason = reason || 'manual';
  if (state.qualityByNotePath.has(note.path)) {
    folder.quality = state.qualityByNotePath.get(note.path);
    folder.qualityOverride = true;
  } else if (!folder.qualityOverride) {
    folder.quality = defaultQualityForFolder(folder);
  }
}

function applyManualRuleToSimilarFolders(sourceFolder, note) {
  const key = sourceFolder.parsed?.normalizedTitle || normalizeClient(sourceFolder.parsed?.titleGuess || sourceFolder.name);
  for (const folder of state.folders) {
    const candidateKey = folder.parsed?.normalizedTitle || normalizeClient(folder.parsed?.titleGuess || folder.name);
    if (candidateKey !== key) continue;
    applyNoteToFolder(folder, note, 'manual');
  }
}

async function rememberManualRule(folder) {
  await api('/api/rules/remember', {
    method: 'POST',
    body: JSON.stringify({
      sourceTitle: folder.parsed?.titleGuess || folder.name,
      notePath: folder.selectedNotePath,
      mode: folder.mode,
      season: Number(folder.parsed?.season) || null,
    }),
  });
}

function openSelectedNote(folder) {
  const note = state.notes.find((candidate) => candidate.path === folder.selectedNotePath);
  if (note) window.location.href = note.obsidianUri;
}

async function openSourceFolder(folderName) {
  try {
    await api('/api/open-source-folder', {
      method: 'POST',
      body: JSON.stringify({ folder: folderName }),
    });
  } catch (error) {
    showFatal(error);
  }
}

async function openArchiveFolder() {
  try {
    await api('/api/open-archive', {
      method: 'POST',
      body: JSON.stringify({}),
    });
  } catch (error) {
    showFatal(error);
  }
}

async function openRunArchive(runId) {
  await api('/api/open-run-archive', {
    method: 'POST',
    body: JSON.stringify({ runId }),
  });
}

async function openItemArchive(runId, sourceFolderName) {
  await api('/api/open-item-archive', {
    method: 'POST',
    body: JSON.stringify({ runId, sourceFolderName }),
  });
}

async function openPreviewModal(folder) {
  const sourceRequestId = ++state.preview.sourceRequestId;
  state.preview.conversionController?.abort();
  state.preview.suggestionController?.abort();
  state.preview.folder = folder;
  state.preview.files = [];
  state.preview.selectedFile = null;
  state.preview.suggestedQuality = null;
  state.preview.requestId += 1;
  state.preview.suggestionRequestId += 1;
  clearTimeout(state.preview.timer);
  clearTimeout(state.preview.suggestionTimer);

  els.previewFolderTitle.textContent = folder.name;
  els.previewFileList.innerHTML = '<div class="empty">Loading files...</div>';
  els.previewOriginalImage.removeAttribute('src');
  els.previewOriginalCropImage.removeAttribute('src');
  els.previewConvertedImage.removeAttribute('src');
  els.previewConvertedCropImage.removeAttribute('src');
  setPreviewLink(els.previewOriginalLink, '');
  setPreviewLink(els.previewOriginalCropLink, '');
  setPreviewLink(els.previewConvertedLink, '');
  setPreviewLink(els.previewConvertedCropLink, '');
  els.previewOriginalMeta.textContent = '';
  els.previewConvertedMeta.textContent = '';
  els.previewStatus.textContent = '';
  hideSuggestedQuality();
  els.previewFormatSelect.value = els.formatSelect.value;
  els.previewQualityInput.value = qualityValue(folder);
  els.previewEffortSelect.value = els.effortSelect.value;
  els.previewModal.hidden = false;

  const data = await api('/api/source-files', {
    method: 'POST',
    body: JSON.stringify({ folder: folder.name }),
  });
  if (sourceRequestId !== state.preview.sourceRequestId || els.previewModal.hidden) return;
  state.preview.files = data.files || [];
  els.previewFolderTitle.textContent = `${folder.name} · ${formatUnit(state.preview.files.length, 'file')} · ${formatBytes(sumBytes(state.preview.files))}`;
  if (!state.preview.files.length) {
    els.previewFileList.innerHTML = '<div class="empty">No image files found</div>';
    return;
  }
  selectPreviewFile(state.preview.files[0].name);
}

function hidePreviewModal() {
  state.preview.sourceRequestId += 1;
  state.preview.conversionController?.abort();
  state.preview.suggestionController?.abort();
  state.preview.requestId += 1;
  state.preview.suggestionRequestId += 1;
  clearTimeout(state.preview.timer);
  clearTimeout(state.preview.suggestionTimer);
  els.previewModal.hidden = true;
}

function renderPreviewFileList() {
  const selected = state.preview.selectedFile?.name;
  els.previewFileList.innerHTML = state.preview.files.map((file) => `
    <button class="preview-file ${file.name === selected ? 'active' : ''}" type="button" data-file="${escapeAttr(file.name)}" title="${escapeAttr(file.name)}">
      <img src="${escapeAttr(file.url)}" alt="" loading="lazy">
      <span>${escapeHtml(file.name)}</span>
      <small>${escapeHtml(file.size)}</small>
    </button>
  `).join('');
  els.previewFileList.querySelectorAll('.preview-file').forEach((button) => {
    button.addEventListener('click', () => selectPreviewFile(button.dataset.file));
  });
}

function selectPreviewFile(fileName) {
  const file = state.preview.files.find((candidate) => candidate.name === fileName);
  if (!file) return;
  state.preview.selectedFile = file;
  state.preview.suggestedQuality = null;
  renderPreviewFileList();
  els.previewOriginalImage.src = file.url;
  els.previewOriginalCropImage.src = file.url;
  setPreviewLink(els.previewOriginalLink, file.url);
  setPreviewLink(els.previewOriginalCropLink, file.url);
  els.previewOriginalMeta.textContent = `${file.name} · ${file.size}`;
  els.previewConvertedImage.removeAttribute('src');
  els.previewConvertedCropImage.removeAttribute('src');
  setPreviewLink(els.previewConvertedLink, '');
  setPreviewLink(els.previewConvertedCropLink, '');
  els.previewConvertedMeta.textContent = '';
  hideSuggestedQuality();
  schedulePreviewConversion();
  schedulePreviewSuggestion();
}

function schedulePreviewConversion() {
  state.preview.conversionController?.abort();
  clearTimeout(state.preview.timer);
  const requestId = state.preview.requestId + 1;
  state.preview.requestId = requestId;
  state.preview.timer = setTimeout(() => {
    runPreviewConversion(requestId).catch((error) => {
      if (error.name !== 'AbortError' && requestId === state.preview.requestId) els.previewStatus.textContent = error.message;
    });
  }, 250);
}

function handlePreviewEncoderChange() {
  schedulePreviewConversion();
  schedulePreviewSuggestion();
}

async function runPreviewConversion(requestId) {
  const folder = state.preview.folder;
  const file = state.preview.selectedFile;
  if (!folder || !file || els.previewModal.hidden) return;

  const conversion = previewConversionSettings();
  const controller = new AbortController();
  state.preview.conversionController = controller;
  els.previewStatus.textContent = 'Converting preview...';
  els.previewConvertedMeta.textContent = '';

  const result = await api('/api/preview-conversion', {
    method: 'POST',
    signal: controller.signal,
    body: JSON.stringify({
      folder: folder.name,
      file: file.name,
      conversion,
    }),
  });
  if (requestId !== state.preview.requestId || els.previewModal.hidden) return;

  els.previewConvertedImage.src = result.url;
  els.previewConvertedCropImage.src = result.url;
  setPreviewLink(els.previewConvertedLink, result.url);
  setPreviewLink(els.previewConvertedCropLink, result.url);
  els.previewConvertedMeta.textContent = `${result.conversion.format} · Q${result.conversion.quality} · ${formatSizePair(result.sourceBytes, result.outputBytes)}`;
  els.previewStatus.textContent = 'Preview only. Apply Quality to use this value in the table.';
}

function schedulePreviewSuggestion() {
  state.preview.suggestionController?.abort();
  clearTimeout(state.preview.suggestionTimer);
  hideSuggestedQuality('Finding auto quality...');
  const requestId = state.preview.suggestionRequestId + 1;
  state.preview.suggestionRequestId = requestId;
  state.preview.suggestionTimer = setTimeout(() => {
    runPreviewSuggestion(requestId).catch((error) => {
      if (error.name !== 'AbortError' && requestId === state.preview.suggestionRequestId) hideSuggestedQuality(error.message);
    });
  }, 350);
}

async function runPreviewSuggestion(requestId) {
  const folder = state.preview.folder;
  const file = state.preview.selectedFile;
  if (!folder || !file || els.previewModal.hidden) return;

  const conversion = previewConversionSettings();
  if (!qualitySuggestionSupported(conversion.format)) {
    hideSuggestedQuality();
    return;
  }

  els.previewSuggestedQualityButton.hidden = false;
  els.previewSuggestedQualityButton.disabled = true;
  els.previewSuggestedQualityButton.textContent = 'Auto...';
  els.previewSuggestedQualityButton.title = 'Finding auto quality from real preview conversions';

  const controller = new AbortController();
  state.preview.suggestionController = controller;
  const result = await api('/api/preview-quality-suggestion', {
    method: 'POST',
    signal: controller.signal,
    body: JSON.stringify({
      folder: folder.name,
      file: file.name,
      conversion,
    }),
  });
  if (requestId !== state.preview.suggestionRequestId || els.previewModal.hidden) return;

  if (!result.suggestedQuality) {
    hideSuggestedQuality();
    return;
  }

  state.preview.suggestedQuality = result.suggestedQuality;
  els.previewSuggestedQualityButton.hidden = false;
  els.previewSuggestedQualityButton.disabled = false;
  els.previewSuggestedQualityButton.textContent = `Auto ${result.suggestedQuality}`;
  els.previewSuggestedQualityButton.title = [
    `Suggested quality: ${result.suggestedQuality}`,
    result.outputBytes ? `Estimated size: ${formatBytes(result.outputBytes)}` : '',
    result.reason || '',
  ].filter(Boolean).join(' · ');
}

function qualitySuggestionSupported(format) {
  return format === 'webp' || format === 'jpg';
}

function hideSuggestedQuality(title = '') {
  state.preview.suggestedQuality = null;
  els.previewSuggestedQualityButton.hidden = true;
  els.previewSuggestedQualityButton.disabled = true;
  els.previewSuggestedQualityButton.textContent = title || 'Auto';
  els.previewSuggestedQualityButton.title = title;
}

function useSuggestedPreviewQuality() {
  if (!state.preview.suggestedQuality) return;
  els.previewQualityInput.value = state.preview.suggestedQuality;
  schedulePreviewConversion();
}

function previewConversionSettings() {
  return {
    format: els.previewFormatSelect.value,
    quality: clampQuality(els.previewQualityInput.value, defaultQuality()),
    effort: Number(els.previewEffortSelect.value),
    conflictPolicy: els.conflictSelect.value,
  };
}

function applyPreviewQuality() {
  const folder = state.preview.folder;
  if (!folder) return;
  const quality = clampQuality(els.previewQualityInput.value, qualityValue(folder));
  setQualityForFolderGroup(folder, quality);
  renderFolders();
  setStatusText(`Quality ${quality} applied to matching note rows`);
  hidePreviewModal();
}

function setPreviewLink(link, href) {
  if (!link) return;
  if (href) {
    link.href = href;
    link.removeAttribute('aria-disabled');
  } else {
    link.removeAttribute('href');
    link.setAttribute('aria-disabled', 'true');
  }
}

async function clearArchive() {
  if (!confirm('Move all archived source folders to macOS Trash?')) return;
  setBusy(true, 'Moving archive to Trash...');
  try {
    const result = await api('/api/archive/clear', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setTrashResultStatus(result);
    await loadRuns();
  } catch (error) {
    showFatal(error);
  } finally {
    setBusy(false);
  }
}

function noteValue(note) {
  return note.label;
}

function valueForPath(notePath) {
  if (!notePath) return '';
  const note = state.notes.find((candidate) => candidate.path === notePath);
  return note ? noteValue(note) : '';
}

function matchClass(folder) {
  if (folder.matchReason === 'manual' || folder.matchReason === 'saved rule') return 'ok';
  if (!folder.selectedNotePath) return 'error';
  return confidenceClass(folder.confidence);
}

function confidenceClass(score) {
  if (score >= 0.75) return 'ok';
  if (score >= 0.55) return 'warn';
  return 'error';
}

function matchLabel(folder) {
  if (folder.matchReason === 'saved rule') return 'Saved rule';
  if (folder.matchReason === 'manual') return 'Manual';
  if (!folder.selectedNotePath) return 'Select note';
  return `Auto ${Math.round((folder.confidence || 0) * 100)}%`;
}

function setMatchedEnabled(value) {
  for (const folder of state.folders) {
    folder.enabled = value && Boolean(folder.selectedNotePath);
  }
  state.lastCheckboxIndex = null;
  updateFolderSelection();
}

function setAllEnabled(value) {
  for (const folder of state.folders) folder.enabled = value;
  state.lastCheckboxIndex = null;
  updateFolderSelection();
}

function collectPayload() {
  const items = state.folders
    .filter((folder) => folder.enabled)
    .map((folder) => ({
      enabled: true,
      sourceFolderName: folder.name,
      notePath: folder.selectedNotePath,
      mode: folder.mode,
      season: folder.mode === 'episode' ? parseSeasonNumber(folder.parsed.season) : null,
      episode: folder.mode === 'episode' ? parseEpisodeNumber(folder.parsed.episode) : null,
      quality: qualityValue(folder),
    }));

  return {
    parallelImages: Number($('#parallelImagesSelect').value),
    conversion: {
      format: els.formatSelect.value,
      quality: Number(els.qualityInput.value),
      effort: Number(els.effortSelect.value),
      conflictPolicy: els.conflictSelect.value,
    },
    items,
  };
}

async function runSelected() {
  if ($('#duplicateEpisodeDialog').open) return;
  const payload = collectPayload();
  if (payload.items.length === 0) {
    setStatusText('Nothing selected');
    return;
  }
  const invalid = payload.items.find((item) => !item.notePath || (item.mode === 'episode' && !hasEpisodeNumbers(item)));
  if (invalid) {
    setStatusText(`Check row: ${invalid.sourceFolderName}`);
    return;
  }

  const duplicates = findDuplicateEpisodes(payload.items);
  if (duplicates.length && !await confirmDuplicateEpisodes(duplicates)) {
    setStatusText('Run cancelled');
    return;
  }

  setBusy(true, 'Running...');
  const { jobId } = await api('/api/run', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  pollJob(jobId);
}

function confirmDuplicateEpisodes(groups) {
  const dialog = $('#duplicateEpisodeDialog');
  $('#duplicateEpisodeGroups').innerHTML = groups.map((group) => {
    const label = noteForPath(group.notePath)?.label || group.notePath;
    return `<div class="modal-item">
      <div class="result-title">${escapeHtml(label)} · S${group.season}E${group.episode} · ${formatUnit(group.sourceFolderNames.length, 'folder')}</div>
      <ul class="duplicate-source-list result-meta">${group.sourceFolderNames.map((name) => `<li>${escapeHtml(name)}</li>`).join('')}</ul>
    </div>`;
  }).join('');
  dialog.returnValue = 'cancel';
  return new Promise((resolve) => {
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'continue'), { once: true });
    dialog.showModal();
  });
}

function pollJob(jobId) {
  clearTimeout(state.jobTimer);
  const poll = async () => {
    try {
      const job = await api(`/api/jobs/${encodeURIComponent(jobId)}`);
      setProgress(job);
      if (['done', 'partial', 'error'].includes(job.status)) {
        state.jobTimer = null;
        setBusy(false);
        await loadRuns();
        showDoneModal(job.results || []);
        await scan();
        if (job.error) setStatusText(job.error);
        return;
      }
      state.jobTimer = setTimeout(poll, 900);
    } catch (error) {
      state.jobTimer = null;
      setBusy(false);
      showFatal(error);
    }
  };
  state.jobTimer = setTimeout(poll, 900);
}

function setProgress(job) {
  const percent = job.percent || 0;
  els.progressFill.style.width = `${percent}%`;
  if (job.status === 'ready') {
    els.progressText.textContent = '';
    els.currentText.textContent = 'Select folders and press Run to start';
    return;
  }
  const eta = job.etaSeconds == null ? '' : ` · ETA ${formatDuration(job.etaSeconds)}`;
  els.progressText.textContent = `${formatCount(job.doneFiles || 0)}/${formatCount(job.totalFiles || 0)} · ${percent}%${eta}`;
  els.currentText.textContent = job.error || job.current || '';
}

function showDoneModal(results) {
  els.doneTitle.textContent = 'Done';
  const successful = results.filter((result) => result.status === 'done');
  const failed = results.filter((result) => result.status !== 'done');
  els.doneTitle.textContent = failed.length ? 'Completed with errors' : 'Done';
  const total = summarizeResults(successful);
  els.doneModalBody.innerHTML = `
    <div class="result-summary">
      <div class="result-title">${formatUnit(total.works, 'work')} · ${formatUnit(total.screenshots, 'screenshot')}</div>
      <div class="result-meta">${formatSizePair(total.sourceBytes, total.outputBytes)}</div>
      ${failed.length ? `<div class="result-meta">${formatCount(failed.length)} failed</div>` : ''}
    </div>
    <div class="modal-items">
      ${results.map((result) => `
        <div class="modal-item">
          <div class="result-title">${escapeHtml(result.targetLabel || result.sourceFolderName)}</div>
          <div class="result-meta">${result.status === 'done'
            ? `${escapeHtml(result.sourceFolderName)} · ${formatUnit(result.insertedCount, 'link')} · ${formatSizePair(result.sourceBytes || 0, result.outputBytes || 0)}`
            : escapeHtml(result.error || 'error')}
          </div>
        </div>
      `).join('')}
    </div>
  `;
  els.doneModal.hidden = false;
}

function showRollbackModal(run, result) {
  const errors = result.errors || [];
  els.doneTitle.textContent = result.status === 'done' ? 'Rollback Done' : 'Rollback Partial';
  els.doneModalBody.innerHTML = `
    <div class="result-summary">
      <div class="result-title">${escapeHtml(formatDate(result.finishedAt) || 'Rollback complete')}</div>
      <div class="result-meta">${escapeHtml(formatRunTitle(run))}</div>
      ${errors.length ? `<div class="result-meta">${formatUnit(errors.length, 'error')}</div>` : ''}
    </div>
    <div class="modal-items">
      <div class="modal-item">
        <div class="result-title">Restored</div>
        <div class="result-meta">
          ${formatUnit(result.returnedFolders?.length || 0, 'source folder')} ·
          ${formatUnit(new Set(result.restoredNotes || []).size, 'note updated')} ·
          ${formatUnit(result.deletedFiles?.length || 0, 'generated file')} deleted
          ${result.restoredFiles?.length ? ` · ${formatUnit(result.restoredFiles.length, 'attachment')} restored` : ''}
          ${result.retainedFiles?.length ? ` · ${formatUnit(result.retainedFiles.length, 'referenced attachment')} kept` : ''}
        </div>
      </div>
      ${result.skippedFolders?.length ? `
        <div class="modal-item">
          <div class="result-title">Skipped</div>
          <div class="result-meta">${formatUnit(result.skippedFolders.length, 'folder')} already rollbacked or trashed</div>
        </div>
      ` : ''}
      ${errors.length ? `
        <div class="modal-item">
          <div class="result-title">Errors</div>
          <div class="result-meta">${errors.map((error) => escapeHtml(`${error.type}: ${error.path || ''} ${error.error || ''}`)).join('<br>')}</div>
        </div>
      ` : ''}
    </div>
  `;
  els.doneModal.hidden = false;
}

function hideDoneModal() {
  els.doneModal.hidden = true;
}

async function loadRuns() {
  const data = await api('/api/runs');
  tabScroll.refresh('history', () => renderRuns(data));
}

function renderRuns(data) {
  const runs = data.runs || [];
  const archive = data.archive || { fileCount: 0, bytes: 0, size: '0 B' };
  els.runsSummary.textContent = data.total > data.limit
    ? `Showing latest ${formatCount(data.limit)} of ${formatCount(data.total)}`
    : `${formatCount(data.total || 0)} total`;
  els.archiveSummary.textContent = `Archive: ${formatUnit(archive.fileCount || 0, 'file')} · ${formatBytes(archive.bytes || 0)}`;
  els.clearArchiveButton.disabled = !archive.fileCount && Number(archive.folderCount || 0) <= 1;

  if (!runs.length) {
    els.runsList.innerHTML = '<div class="empty">Run log is empty</div>';
    return;
  }

  els.runsList.innerHTML = '';
  for (const run of runs) {
    const card = document.createElement('div');
    card.className = 'run-card';
    card.title = `Run ID: ${run.runId}`;
    const isOpen = state.openRunIds.has(run.runId);
    card.innerHTML = `
      <div class="run-head">
        <button class="icon-button run-toggle" type="button" aria-expanded="${isOpen ? 'true' : 'false'}" title="${isOpen ? 'Collapse run' : 'Expand run'}">${isOpen ? '▾' : '▸'}</button>
        <div class="run-summary-block">
          <div class="run-title">${escapeHtml(formatRunTitle(run))}</div>
          <div class="run-meta">${escapeHtml(formatRunMeta(run))}</div>
        </div>
        <div class="run-actions">
          ${renderRunActions(run)}
        </div>
      </div>
      <div class="run-items" ${isOpen ? '' : 'hidden'}>
        ${(run.items || []).map((item) => renderHistoryItem(run, item)).join('')}
      </div>
    `;
    card.querySelector('.run-toggle').addEventListener('click', () => {
      if (state.openRunIds.has(run.runId)) {
        state.openRunIds.delete(run.runId);
      } else {
        state.openRunIds.add(run.runId);
      }
      const expanded = state.openRunIds.has(run.runId);
      card.querySelector('.run-items').hidden = !expanded;
      const toggle = card.querySelector('.run-toggle');
      toggle.setAttribute('aria-expanded', String(expanded));
      toggle.textContent = expanded ? '▾' : '▸';
      toggle.title = expanded ? 'Collapse run' : 'Expand run';
    });
    card.querySelector('.rollback-run')?.addEventListener('click', async () => {
      if (!confirm(`Rollback ${run.runId}?`)) return;
      const total = rollbackProgressTotal(run);
      setBusy(true, 'Rolling back...');
      setProgress({
        status: 'running',
        percent: 0,
        doneFiles: 0,
        totalFiles: total,
        current: `Rolling back ${formatRunTitle(run)}...`,
      });
      try {
        const result = await api('/api/rollback', {
          method: 'POST',
          body: JSON.stringify({ runId: run.runId }),
        });
        await loadRuns();
        await scan();
        setProgress({
          status: result.status,
          percent: 100,
          doneFiles: total,
          totalFiles: total,
          current: `Rollback ${result.status}`,
        });
        showRollbackModal(run, result);
      } catch (error) {
        showFatal(error);
      } finally {
        setBusy(false);
      }
    });
    card.querySelector('.trash-run-archive')?.addEventListener('click', async () => {
      if (!confirm(`Move archived source folders for ${formatDate(run.startedAt)} to macOS Trash?`)) return;
      setBusy(true, 'Moving run archive to Trash...');
      try {
        const result = await api('/api/archive/clear-run', {
          method: 'POST',
          body: JSON.stringify({ runId: run.runId }),
        });
        setTrashResultStatus(result);
        await loadRuns();
      } catch (error) {
        showFatal(error);
      } finally {
        setBusy(false);
      }
    });
    card.querySelector('.open-run-archive')?.addEventListener('click', () => {
      openRunArchive(run.runId).catch(showFatal);
    });
    card.querySelectorAll('.rollback-item').forEach((button) => {
      button.addEventListener('click', async () => {
        const sourceFolderName = button.dataset.sourceFolderName;
        if (!confirm(`Rollback ${sourceFolderName}?`)) return;
        setBusy(true, 'Rolling back item...');
        try {
        const result = await api('/api/rollback-item', {
          method: 'POST',
          body: JSON.stringify({ runId: run.runId, sourceFolderName }),
        });
        setBusy(false);
        setStatusText(`Item rollback: ${result.status}`);
        await loadRuns();
        await scan();
        setStatusText(result.errors?.length ? result.errors.map((error) => error.error).join('; ') : `Item rollback: ${result.status}`);
        } catch (error) {
          showFatal(error);
        } finally {
          setBusy(false);
        }
      });
    });
    card.querySelectorAll('.trash-item-archive').forEach((button) => {
      button.addEventListener('click', async () => {
        const sourceFolderName = button.dataset.sourceFolderName;
        if (!confirm(`Move archived source folder "${sourceFolderName}" to macOS Trash?`)) return;
        setBusy(true, 'Moving source folder to Trash...');
        try {
          const result = await api('/api/archive/clear-item', {
            method: 'POST',
            body: JSON.stringify({ runId: run.runId, sourceFolderName }),
          });
          setTrashResultStatus(result);
          await loadRuns();
        } catch (error) {
          showFatal(error);
        } finally {
          setBusy(false);
        }
      });
    });
    card.querySelectorAll('.open-history-note').forEach((button) => {
      button.addEventListener('click', () => {
        const noteUri = button.dataset.noteUri;
        if (noteUri) window.location.href = noteUri;
      });
    });
    card.querySelectorAll('.open-item-archive').forEach((button) => {
      button.addEventListener('click', () => {
        openItemArchive(run.runId, button.dataset.sourceFolderName).catch(showFatal);
      });
    });
    els.runsList.append(card);
  }
}

function renderRunActions(run) {
  const kind = statusKind(run.status);
  const archiveButton = renderOpenRunArchiveButton(run);
  if (kind === 'rollback') {
    return `${archiveButton}${renderStatusButton('Rollbacked', run.rollbackFinishedAt ? `Rollbacked ${formatDate(run.rollbackFinishedAt)}` : 'Rollbacked')}`;
  }
  if (kind === 'trash') {
    return `${archiveButton}${renderStatusButton('Trashed', run.trashFinishedAt ? `Trashed ${formatDate(run.trashFinishedAt)}` : 'Trashed')}`;
  }

  const canRollbackRun = run.canRollback !== false;
  const canTrashRunArchive = Boolean(run.archive?.exists)
    && !String(run.status).startsWith('rollback:')
    && (Number(run.archive?.fileCount || 0) > 0 || Number(run.archive?.folderCount || 0) > 0);
  return `
    ${archiveButton}
    ${canTrashRunArchive ? '<button class="danger trash-run-archive" type="button">Trash</button>' : ''}
    ${canRollbackRun ? '<button class="danger rollback-run" type="button">Rollback Run</button>' : ''}
  `;
}

function renderHistoryItem(run, item) {
  const canTrashArchive = Boolean(item.archive?.exists)
    && (Number(item.archive?.fileCount || 0) > 0 || Number(item.archive?.folderCount || 0) > 0);
  const archiveButton = renderOpenItemArchiveButton(item);
  return `
    <div class="run-item">
      <div class="run-item-summary">
        <div class="result-title">${escapeHtml(formatHistoryItemTitle(run, item))}</div>
        <div class="result-meta">${escapeHtml(item.sourceFolderName)} · ${formatUnit(item.sourceFileCount || 0, 'file')} · ${formatSizePair(item.sourceBytes || 0, item.outputBytes || 0)}</div>
      </div>
      <div class="run-item-actions">
        <button class="icon-button open-history-note" type="button" title="Open note in Obsidian" aria-label="Open note in Obsidian" data-note-uri="${escapeAttr(item.noteUri || '')}" ${item.noteUri ? '' : 'disabled'}><img class="brand-icon" src="/icons/obsidian.svg" alt=""></button>
        ${archiveButton}
        ${renderHistoryItemActions(run, item, canTrashArchive)}
      </div>
    </div>
  `;
}

function renderOpenRunArchiveButton(run) {
  if (['rollback', 'trash'].includes(statusKind(run.status))) return '';
  if (!run.archive?.exists) return '';
  return '<button class="icon-button open-run-archive" type="button" title="Open run archive in Finder" aria-label="Open run archive in Finder"><span class="ui-icon icon-folder" aria-hidden="true"></span></button>';
}

function renderOpenItemArchiveButton(item) {
  if (!item.archive?.exists) return '';
  return `<button class="icon-button open-item-archive" type="button" title="Open source archive in Finder" aria-label="Open source archive in Finder" data-source-folder-name="${escapeAttr(item.sourceFolderName)}"><span class="ui-icon icon-folder" aria-hidden="true"></span></button>`;
}

function renderHistoryItemActions(run, item, canTrashArchive) {
  const kind = effectiveItemStatusKind(run, item);
  if (kind === 'rollback') {
    const date = item.rollbackFinishedAt || run.rollbackFinishedAt;
    return renderStatusButton('Rollbacked', date ? `Rollbacked ${formatDate(date)}` : 'Rollbacked');
  }
  if (kind === 'trash') {
    const date = item.trashFinishedAt || run.trashFinishedAt;
    return renderStatusButton('Trashed', date ? `Trashed ${formatDate(date)}` : 'Trashed');
  }

  const actions = [];
  if (canTrashArchive && !String(item.status).startsWith('rollback:')) {
    actions.push(`<button class="danger trash-item-archive" type="button" data-source-folder-name="${escapeAttr(item.sourceFolderName)}">Trash</button>`);
  }
  if (item.canRollback !== false) {
    actions.push(`<button class="danger rollback-item" type="button" data-source-folder-name="${escapeAttr(item.sourceFolderName)}">Rollback</button>`);
  }
  return actions.join('');
}

function renderStatusButton(label, title) {
  return `<button class="status-button" type="button" title="${escapeAttr(title || label)}" aria-disabled="true" tabindex="-1">${escapeHtml(label)}</button>`;
}

function summarizeResults(results) {
  const targets = new Set();
  let screenshots = 0;
  let sourceBytes = 0;
  let outputBytes = 0;
  for (const result of results) {
    targets.add(result.notePath || result.targetLabel || result.sourceFolderName);
    screenshots += Number(result.outputFileCount ?? result.insertedCount) || 0;
    sourceBytes += Number(result.sourceBytes) || 0;
    outputBytes += Number(result.outputBytes) || 0;
  }
  return {
    works: targets.size,
    screenshots,
    sourceBytes,
    outputBytes,
  };
}

function rollbackProgressTotal(run) {
  return Math.max(1, Number(run.generatedCount || 0) + Number(run.itemCount || 0));
}

function summarizeVisibleFolders() {
  return {
    folderCount: state.folders.length,
    imageCount: state.folders.reduce((sum, folder) => sum + (Number(folder.imageCount) || 0), 0),
    bytes: state.folders.reduce((sum, folder) => sum + (Number(folder.totalBytes) || 0), 0),
  };
}

function sumBytes(items) {
  return (items || []).reduce((sum, item) => sum + (Number(item.bytes) || 0), 0);
}

function formatRunTargets(targets) {
  if (!targets.length) return '';
  const visible = targets.slice(0, 3).map((target) => target.label || target.noteName || target.notePath);
  const suffix = targets.length > visible.length ? ` +${targets.length - visible.length}` : '';
  return `${visible.join('; ')}${suffix}`;
}

function formatRunTitle(run) {
  return `${formatDate(run.startedAt)} · ${formatFolderCount(run.itemCount || 0)} · ${formatRunStatus(run)}`;
}

function formatRunStatus(run) {
  const kind = statusKind(run.status);
  if (kind === 'rollback') return 'Rollbacked';
  if (kind === 'trash') return 'Trashed';
  if (run.status === 'done') return 'Done';
  return run.status || 'Done';
}

function formatFolderCount(count) {
  return formatUnit(count, 'folder');
}

function formatRunMeta(run) {
  const parts = [
    formatUnit(run.generatedCount || 0, 'file'),
    formatSizePair(run.sourceBytes || 0, run.outputBytes || 0),
  ];
  if (run.archive?.fileCount) {
    parts.push(`Archive ${formatUnit(run.archive.fileCount, 'file')} · ${formatBytes(run.archive.bytes || 0)}`);
  }
  return parts.join(' · ');
}

function formatHistoryItemTitle(run, item) {
  const noteName = item.noteName || baseTitleFromLabel(item.label) || item.sourceFolderName;
  const status = statusLabel(effectiveItemStatusKind(run, item));
  if (item.mode === 'episode' && hasEpisodeNumbers(item)) {
    return `${noteName} · S${Number(item.season)}E${Number(item.episode)} · ${status}`;
  }
  return `${noteName} · ${status}`;
}

function baseTitleFromLabel(label) {
  return String(label || '').replace(/\s+·\s+(Work|S\d+E\d+)$/i, '');
}

function effectiveItemStatusKind(run, item) {
  if (statusKind(run.status) === 'rollback') return 'rollback';
  return statusKind(item.status);
}

function statusKind(status) {
  const value = String(status || 'done');
  if (value === 'rollback:partial' || value === 'rollback:running') return 'partial';
  if (value.startsWith('rollback:')) return 'rollback';
  if (value.startsWith('trash:')) return 'trash';
  if (['error', 'partial', 'running'].includes(value)) return value;
  return 'done';
}

function statusLabel(kind) {
  if (kind === 'rollback') return 'Rollbacked';
  if (kind === 'trash') return 'Trashed';
  if (kind === 'error') return 'Failed';
  if (kind === 'partial') return 'Partial';
  if (kind === 'running') return 'Interrupted';
  return 'Done';
}

function setBusy(isBusy, text = '') {
  els.scanButton.disabled = isBusy;
  els.runButton.disabled = isBusy;
  if (text) setStatusText(text);
}

function setStatusText(text) {
  els.currentText.textContent = text;
}

function setTrashResultStatus(result) {
  const fileCount = Number(result?.fileCount) || 0;
  const folderCount = Number(result?.folderCount) || 0;
  const bytes = Number(result?.bytes) || 0;
  if (fileCount === 0 && folderCount === 0 && bytes === 0) {
    setStatusText('Archive is already empty');
    return;
  }
  setStatusText(`Moved ${formatUnit(fileCount, 'file')} (${formatBytes(bytes)}) to macOS Trash`);
}

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    hourCycle: 'h23',
  });
}

function numericInputValue(input) {
  const value = String(input.value || '').replace(/\D+/g, '');
  if (input.value !== value) input.value = value;
  return value;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatCount(value) {
  return new Intl.NumberFormat('en-US').format(Number(value) || 0);
}

function formatUnit(value, singular, plural = `${singular}s`) {
  const count = Number(value) || 0;
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

function formatSizePair(sourceBytes, outputBytes) {
  return `${formatBytes(sourceBytes)} → ${formatBytes(outputBytes)}${formatReduction(sourceBytes, outputBytes)}`;
}

function formatReduction(sourceBytes, outputBytes) {
  const source = Number(sourceBytes) || 0;
  const output = Number(outputBytes) || 0;
  if (!source || !output) return '';
  const diff = source - output;
  const percent = Math.round((Math.abs(diff) / source) * 100);
  if (diff >= 0) return ` (${percent}%)`;
  return ` (+${percent}%)`;
}

function normalizeClient(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function setupStickyOffset() {
  const update = () => {
    const height = Math.ceil(els.stickyShell?.getBoundingClientRect().height || 0);
    const activeToolbar = document.querySelector('.tab-panel:not([hidden]) .section-toolbar');
    const toolbarHeight = Math.ceil(activeToolbar?.getBoundingClientRect().height || 0);
    document.documentElement.style.setProperty('--sticky-offset', `${height}px`);
    document.documentElement.style.setProperty('--section-toolbar-offset', `${toolbarHeight}px`);
  };
  update();
  if (setupStickyOffset.initialized) return;
  setupStickyOffset.initialized = true;
  window.addEventListener('resize', update);
  if ('ResizeObserver' in window && els.stickyShell) {
    const observer = new ResizeObserver(update);
    observer.observe(els.stickyShell);
    document.querySelectorAll('.section-toolbar').forEach((toolbar) => observer.observe(toolbar));
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", '&#039;');
}

function showFatal(error) {
  console.error(error);
  setBusy(false);
  els.currentText.textContent = error.message || String(error);
}
