export function createUpdates({ api, isBusy, setUpdateBusy, flushSettings, formatDate, formatBytes }) {
  const get = (id) => document.getElementById(id);
  const dialog = get('updateDialog'), list = get('updateReleases'), status = get('updateStatus');
  const install = get('installUpdateButton'), check = get('checkUpdateButton'), progress = get('updateProgress');
  let latest = null, downloaded = false, downloading = false, installing = false, starting = false, checking = false, timer = null;
  const native = Boolean(window.webkit?.messageHandlers?.updates);

  function refresh() {
    install.textContent = downloaded ? 'Install and Restart' : 'Download Update';
    install.disabled = !native || (!downloaded && !latest?.asset) || isBusy() || checking || downloading || installing || starting;
    check.disabled = checking || downloading || installing || starting;
    get('closeUpdateButton').disabled = installing;
  }

  async function checkReleases() {
    checking = true;
    status.textContent = 'Checking GitHub Releases…';
    refresh();
    try {
      const data = await api('/api/updates/check', { method: 'POST', body: '{}' });
      get('updateVersion').textContent = `Installed v${data.currentVersion}`;
      latest = data.releases.find((release) => release.newer) || null;
      list.replaceChildren();
      for (const [index, release] of data.releases.entries()) {
        const item = document.createElement('details');
        item.open = index === 0;
        const summary = document.createElement('summary');
        const title = document.createElement('strong');
        title.textContent = `v${release.version}`;
        const meta = document.createElement('span');
        meta.className = 'result-meta';
        meta.textContent = `${formatDate(release.publishedAt)}${release.version === data.currentVersion ? ' · Installed' : release.newer ? ' · New' : ''}`;
        summary.append(title, meta);
        const notes = document.createElement('div');
        notes.className = 'release-notes';
        notes.textContent = release.notes;
        const link = document.createElement('a');
        link.textContent = 'View on GitHub';
        link.href = release.url;
        link.target = '_blank';
        link.rel = 'noopener';
        item.append(summary, notes, link);
        list.append(item);
      }
      status.textContent = downloaded ? 'Update downloaded and verified' : latest
        ? latest.asset ? `v${latest.version} available · ${formatBytes(latest.asset.bytes)}` : `v${latest.version}: compatible download is not available yet`
        : 'The latest version is installed';
    } catch (error) { status.textContent = `Update check failed: ${error.message}`; }
    finally { checking = false; refresh(); }
  }

  async function poll() {
    clearTimeout(timer);
    try {
      const state = await api('/api/updates/state');
      if (state.status === 'downloading') {
        downloading = true;
        setUpdateBusy(true);
        progress.hidden = false;
        progress.value = state.percent;
        status.textContent = `Downloading v${state.version}: ${formatBytes(state.bytes)} / ${formatBytes(state.totalBytes)} (${state.percent}%)`;
      } else {
        downloading = false;
        setUpdateBusy(false);
        progress.hidden = true;
        downloaded = state.status === 'downloaded';
        if (downloaded) status.textContent = `v${state.version} downloaded and verified`;
        if (state.status === 'error') status.textContent = `Download failed: ${state.error}`;
      }
      refresh();
      if (!downloading) return;
    } catch (error) {
      // A failed status request is not proof that the server released its operation lock.
      status.textContent = `Waiting for download status: ${error.message}`;
    }
    timer = setTimeout(poll, 500);
  }

  async function open() {
    if (!dialog.open) dialog.showModal();
    if (!native) { status.textContent = 'Updates are available in the macOS application'; refresh(); return; }
    if (downloading || installing) { refresh(); return; }
    await poll();
    if (!downloading) await checkReleases();
  }

  install.addEventListener('click', async () => {
    if (install.disabled) return;
    starting = true;
    refresh();
    try {
      await flushSettings();
      if (downloaded) {
        installing = true;
        setUpdateBusy(true);
        status.textContent = 'Validating the application before restart…';
        refresh();
        window.webkit.messageHandlers.updates.postMessage('install');
      } else {
        downloading = true;
        setUpdateBusy(true);
        status.textContent = 'Starting download…';
        refresh();
        await api('/api/updates/download', { method: 'POST', body: JSON.stringify({ tag: latest.tag }) });
        await poll();
      }
    } catch (error) {
      downloading = false;
      installing = false;
      setUpdateBusy(false);
      status.textContent = error.message;
      refresh();
    } finally { starting = false; refresh(); }
  });
  get('updateButton').addEventListener('click', open);
  check.addEventListener('click', checkReleases);
  get('closeUpdateButton').addEventListener('click', () => { if (!installing) dialog.close(); });
  dialog.addEventListener('cancel', (event) => { if (installing) event.preventDefault(); });
  window.openAppUpdates = open;
  window.appUpdateFailed = () => {
    installing = false;
    setUpdateBusy(false);
    status.textContent = 'Installation did not complete; the current application is unchanged';
    refresh();
  };
  return { refresh, restore: poll };
}
