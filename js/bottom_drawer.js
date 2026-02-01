const { autoSaveField } = await import('./util.js' + self.VERSION_PARAM);

// A tabbed bottom drawer component.
export class BottomDrawer {
  static STORAGE_KEY = 'bottom-drawer-height';

  constructor(containerId) {
    this._container = document.getElementById(containerId);
    this._tabBar = this._container.querySelector('.bottom-drawer-tabs');
    this._panelContainer = this._container.querySelector('.bottom-drawer-panels');
    this._tabs = new Map(); // id -> { button, panel, onClose }
    this._activeTabId = null;
    this._expandedHeight = null;

    {
      const savedHeight = sessionStorage.getItem(BottomDrawer.STORAGE_KEY);
      if (savedHeight) this._setHeight(parseInt(savedHeight, 10));
    }

    this._initResize();
    this._initCollapseButton();
    this._initPanels();
  }

  _initCollapseButton() {
    const btn = document.createElement('button');
    btn.className = 'bottom-drawer-collapse';
    btn.title = 'Toggle panel';
    btn.onclick = () => this.toggleCollapsed();
    this._tabBar.appendChild(btn);
  }

  _initPanels() {
    for (const panel of this._panelContainer.querySelectorAll('[data-tab-id]')) {
      const id = panel.dataset.tabId;
      const label = panel.dataset.tabLabel || id;

      const labelSpan = document.createElement('span');
      labelSpan.className = 'bottom-drawer-tab-label';
      labelSpan.textContent = label;

      const closeBtn = document.createElement('span');
      closeBtn.className = 'bottom-drawer-tab-close';
      closeBtn.title = `Close ${label}`;
      closeBtn.textContent = '×';

      const button = document.createElement('button');
      button.className = 'bottom-drawer-tab';
      button.append(labelSpan, closeBtn);
      button.onclick = (e) => {
        if (e.target === closeBtn) {
          this.closeTab(id);
        } else {
          this.switchTab(id);
        }
      };

      panel.classList.add('bottom-drawer-panel');
      panel.style.display = 'none';
      this._tabs.set(id, { button, panel, onClose: null });
    }
  }

  onTabClose(id, callback) {
    const tab = this._tabs.get(id);
    if (tab) tab.onClose = callback;
  }

  openTab(id) {
    const tab = this._tabs.get(id);
    if (!tab) return;

    if (!this._tabBar.contains(tab.button)) {
      this._tabBar.appendChild(tab.button);
    }
    this._updateVisibility();
    this.switchTab(id);
  }

  closeTab(id) {
    const tab = this._tabs.get(id);
    if (!tab || !this._tabBar.contains(tab.button)) return;

    tab.button.remove();
    tab.panel.style.display = 'none';
    tab.onClose?.();

    if (this._activeTabId === id) {
      this._activeTabId = null;
      // Switch to first remaining open tab.
      for (const [nextId, t] of this._tabs) {
        if (this._tabBar.contains(t.button)) {
          this.switchTab(nextId);
          break;
        }
      }
    }
    this._updateVisibility();
  }

  switchTab(id) {
    const tab = this._tabs.get(id);
    if (!tab) return;

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
    if (this.isTabOpen(id)) {
      this.closeTab(id);
      return false;
    }
    this.openTab(id);
    return true;
  }

  toggleCollapsed() {
    const minHeight = this._tabBar.offsetHeight;
    const currentHeight = this._container.offsetHeight;
    if (currentHeight > minHeight) {
      this._expandedHeight = currentHeight;
      this._setHeight(minHeight);
    } else {
      this._setHeight(this._expandedHeight || 200);
    }
    this._saveHeight();
  }

  _setHeight(h) {
    this._container.style.setProperty('--drawer-height', `${h}px`);
  }

  _saveHeight() {
    const height = this._container.offsetHeight;
    this._container.classList.toggle('collapsed', height <= this._tabBar.offsetHeight);
    sessionStorage.setItem(BottomDrawer.STORAGE_KEY, height);
  }

  _updateVisibility() {
    const hasOpenTabs = [...this._tabs.values()].some(t => this._tabBar.contains(t.button));
    this._container.style.display = hasOpenTabs ? 'flex' : 'none';
  }

  _initResize() {
    let startY, startHeight;

    this._tabBar.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button, .bottom-drawer-tab-close')) return;
      e.preventDefault();
      startY = e.clientY;
      startHeight = this._container.offsetHeight;
      this._tabBar.setPointerCapture(e.pointerId);
      document.body.style.userSelect = 'none';
    });

    this._tabBar.addEventListener('pointermove', (e) => {
      if (!this._tabBar.hasPointerCapture(e.pointerId)) return;
      const minHeight = this._tabBar.offsetHeight;
      this._setHeight(Math.max(minHeight, startHeight + (startY - e.clientY)));
    });

    this._tabBar.addEventListener('pointerup', (e) => {
      this._tabBar.releasePointerCapture(e.pointerId);
      document.body.style.userSelect = '';
      this._saveHeight();
    });
  }
}

export class LazyDrawerManager {
  constructor(config, bottomDrawer) {
    this._tabId = config.tabId;
    this._factory = config.factory;
    this._modulePath = config.modulePath;
    this._bottomDrawer = bottomDrawer;

    const container = document.getElementById(`${config.tabId}-container`);
    this._loadingElement = container.querySelector('.loading-notice');
    this._bodyElement = container.querySelector('.lazy-body');

    this._shape = null;
    this._enabled = false;
    this._real = null;
    this._realPromise = null;

    this._setUpControls();
  }

  _setUpControls() {
    const tabId = this._tabId;
    const drawer = this._bottomDrawer;
    this._toggle = document.getElementById(`show-${tabId}-input`);
    autoSaveField(this._toggle);

    this._toggle.addEventListener('change', () => {
      this._enabled = this._toggle.checked;
      this._real?.setEnabled(this._enabled);
      if (this._enabled) {
        drawer.openTab(tabId);
        this._ensureLoaded();
      } else {
        drawer.closeTab(tabId);
      }
    });

    drawer.onTabClose(tabId, () => {
      this._toggle.checked = false;
      this._toggle.dispatchEvent(new Event('change'));
    });

    if (this._toggle.checked) {
      this._enabled = true;
      drawer.openTab(tabId);
      this._ensureLoaded();
    }
  }

  enable() {
    this._toggle.checked = true;
    this._toggle.dispatchEvent(new Event('change'));
  }

  toggle() {
    this._toggle.checked = !this._toggle.checked;
    this._toggle.dispatchEvent(new Event('change'));
  }

  async _ensureLoaded() {
    if (this._real) return this._real;

    if (!this._realPromise) {
      this._realPromise = (async () => {
        const module = await import(this._modulePath + self.VERSION_PARAM);
        const real = this._factory(module, this._bodyElement);

        if (this._shape) real.reshape(this._shape);
        real.setEnabled(this._enabled);

        this._real = real;
        this._loadingElement.hidden = true;
        this._bodyElement.hidden = false;
        return real;
      })().catch((e) => {
        console.error(`Failed to load ${this._tabId}:`, e);
        this._realPromise = null;
        this._loadingElement.textContent = `Failed to load: ${e?.message || e}`;
        this._loadingElement.classList.remove('notice-info');
        this._loadingElement.classList.add('notice-error');
        return null;
      });
    }

    return this._realPromise;
  }

  async get() {
    if (!this._enabled) return null;
    return this._ensureLoaded();
  }

  reshape(shape) {
    this._shape = shape;
    this._real?.reshape(shape);
  }

  clear() {
    this._real?.clear();
  }
}
