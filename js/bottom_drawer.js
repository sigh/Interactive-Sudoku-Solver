/**
 * A tabbed bottom drawer component.
 *
 * Panels are placed directly in .bottom-drawer-panels with data-tab-id attributes.
 * The drawer is visible when any tab is open.
 *
 * Usage:
 *   const drawer = new BottomDrawer('bottom-drawer');
 *   drawer.openTab('debug');  // Opens tab, shows drawer
 *   drawer.closeTab('debug'); // Closes tab, hides drawer if no tabs remain
 */
class BottomDrawer {
  constructor(containerId) {
    this._container = document.getElementById(containerId);
    this._tabBar = this._container.querySelector('.bottom-drawer-tabs');
    this._panelContainer = this._container.querySelector('.bottom-drawer-panels');
    this._tabs = new Map(); // id -> { button, panel, onClose }
    this._activeTabId = null;

    // Enable drag-to-resize on the tab bar.
    this._initResize();

    // Add collapse toggle button.
    this._collapseBtn = document.createElement('button');
    this._collapseBtn.className = 'bottom-drawer-collapse';
    this._collapseBtn.title = 'Toggle panel';
    this._collapseBtn.onclick = () => this.toggleCollapsed();
    this._tabBar.appendChild(this._collapseBtn);

    // Auto-register panels already in the DOM.
    for (const panel of this._panelContainer.querySelectorAll('[data-tab-id]')) {
      this._createTab(panel);
    }
  }

  _createTab(panel) {
    const id = panel.dataset.tabId;
    const label = panel.dataset.tabLabel || id;

    const labelSpan = document.createElement('span');
    labelSpan.className = 'bottom-drawer-tab-label';
    labelSpan.textContent = label;

    const closeBtn = document.createElement('span');
    closeBtn.className = 'bottom-drawer-tab-close';
    closeBtn.title = `Close ${label}`;
    closeBtn.textContent = '×';
    closeBtn.onclick = (e) => {
      e.stopPropagation();
      this.closeTab(id);
    };

    const button = document.createElement('button');
    button.className = 'bottom-drawer-tab';
    button.append(labelSpan, closeBtn);
    button.onclick = () => this.switchTab(id);

    panel.classList.add('bottom-drawer-panel');
    panel.style.display = 'none';
    this._tabs.set(id, { button, panel, onClose: null });
  }

  /** Set a callback for when a tab is closed. */
  onTabClose(id, callback) {
    const tab = this._tabs.get(id);
    if (tab) tab.onClose = callback;
  }

  /** Open a tab (shows drawer, adds tab button, activates panel). */
  openTab(id) {
    const tab = this._tabs.get(id);
    if (!tab) return;

    if (!this._tabBar.contains(tab.button)) {
      this._tabBar.appendChild(tab.button);
    }
    this._updateVisibility();
    this.switchTab(id);
  }

  /** Close a tab (removes tab button, hides drawer if empty). */
  closeTab(id) {
    const tab = this._tabs.get(id);
    if (!tab || !this._tabBar.contains(tab.button)) return;

    tab.button.remove();
    tab.panel.style.display = 'none';
    tab.onClose?.();

    if (this._activeTabId === id) {
      this._activeTabId = null;
      // Switch to first remaining tab.
      for (const [nextId, t] of this._tabs) {
        if (this._tabBar.contains(t.button)) {
          this.switchTab(nextId);
          break;
        }
      }
    }
    this._updateVisibility();
  }

  /** Switch to a tab. */
  switchTab(id) {
    const tab = this._tabs.get(id);
    if (!tab) return;

    // Only toggle panels for tabs that are currently open.
    for (const [tabId, t] of this._tabs) {
      if (!this._tabBar.contains(t.button)) continue;
      const isActive = tabId === id;
      t.button.classList.toggle('active', isActive);
      t.panel.style.display = isActive ? '' : 'none';
    }
    this._activeTabId = id;
  }

  isTabOpen(id) {
    const tab = this._tabs.get(id);
    return tab && this._tabBar.contains(tab.button);
  }

  toggleTab(id) {
    return this.isTabOpen(id) ? (this.closeTab(id), false) : (this.openTab(id), true);
  }

  /** Toggle drawer collapsed state. */
  toggleCollapsed() {
    const minHeight = this._tabBar.offsetHeight;
    const currentHeight = this._container.offsetHeight;
    if (currentHeight > minHeight) {
      this._expandedHeight = currentHeight;
      this._setHeight(minHeight);
    } else {
      this._setHeight(this._expandedHeight || 200);
    }
    this._updateCollapsedState();
  }

  _setHeight(h) {
    this._container.style.setProperty('--drawer-height', `${h}px`);
  }

  _isCollapsed() {
    return this._container.offsetHeight <= this._tabBar.offsetHeight;
  }

  _updateCollapsedState() {
    this._container.classList.toggle('collapsed', this._isCollapsed());
  }

  _updateVisibility() {
    // Check if any tabs are open (exclude the collapse button).
    const hasOpenTabs = Array.from(this._tabs.values()).some(
      t => this._tabBar.contains(t.button)
    );
    this._container.style.display = hasOpenTabs ? 'flex' : 'none';
  }

  _initResize() {
    let startY, startHeight;

    const onStart = (e) => {
      // Don't capture if clicking on a button.
      if (e.target.closest('button, .bottom-drawer-tab-close')) return;
      e.preventDefault();
      startY = e.clientY;
      startHeight = this._container.offsetHeight;
      this._tabBar.setPointerCapture(e.pointerId);
      document.body.style.cursor = 'ns-resize';
      document.body.style.userSelect = 'none';
    };

    const onMove = (e) => {
      if (!this._tabBar.hasPointerCapture(e.pointerId)) return;
      e.preventDefault();
      const delta = startY - e.clientY;
      const minHeight = this._tabBar.offsetHeight;
      this._setHeight(Math.max(minHeight, startHeight + delta));
    };

    const onEnd = (e) => {
      this._tabBar.releasePointerCapture(e.pointerId);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this._updateCollapsedState();
    };

    this._tabBar.addEventListener('pointerdown', onStart);
    this._tabBar.addEventListener('pointermove', onMove);
    this._tabBar.addEventListener('pointerup', onEnd);
  }
}

export { BottomDrawer };
