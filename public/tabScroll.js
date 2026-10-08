// Keep navigation positions in memory only, independent of saved app settings.
export function createTabScroll({ initialTab, readScroll, writeScroll }) {
  const positions = new Map();
  let activeTab = initialTab;
  const currentPosition = () => Math.max(0, readScroll());

  return {
    activate(tab, showTab, { toTop = false } = {}) {
      const changed = tab !== activeTab;
      if (changed) {
        // Capture before hiding the old panel can clamp the document's scroll.
        positions.set(activeTab, currentPosition());
        activeTab = tab;
        showTab();
      }
      if (toTop) positions.set(tab, 0);
      if (changed || toTop) writeScroll(positions.get(tab) ?? 0);
      return changed;
    },

    refresh(tab, render) {
      // Read at render time, not before an asynchronous request: the user may
      // have scrolled, switched tabs, or double-clicked to the top meanwhile.
      const position = tab === activeTab ? currentPosition() : null;
      render();
      if (position !== null) writeScroll(position);
    },
  };
}
