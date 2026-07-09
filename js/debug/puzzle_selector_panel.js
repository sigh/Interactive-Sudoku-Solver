const {
  autoSaveField,
  createSourceLinkIcon,
  dynamicCSSFileLoader,
} = await import('../util.js' + self.VERSION_PARAM);

await dynamicCSSFileLoader('css/puzzle_selector.css' + self.VERSION_PARAM)();

const { extractConstraintTypes } = await import('./extract_constraint_types.js' + self.VERSION_PARAM);
const { UserScriptExecutor } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const {
  PUZZLE_INDEX,
  resolvePuzzleConfig,
} = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);
const PuzzleCollections = await import('../../data/collections.js' + self.VERSION_PARAM);

// Benchmark collections to surface, in display order.
const COLLECTION_NAMES = [
  'TAREK_ALL',
  'EXTREME_KILLERS',
  'HARD_THERMOS',
  'MATHEMAGIC_KILLERS',
  'HARD_RENBAN',
  'HARD_PENCILMARKS',
  'HS_KILLERS',
  'LITTLE_KILLER_SNIPES',
];

export class PuzzleSelectorPanel {
  constructor(constraintManager, bodyElement, openScriptInSandbox) {
    this._constraintManager = constraintManager;
    // Opens a script-built puzzle's generating source in the sandbox editor.
    this._openScriptInSandbox = openScriptInSandbox;

    this._filter = bodyElement.querySelector('#puzzle-selector-filter');
    this._modeButtons = bodyElement.querySelectorAll('#puzzle-selector-mode [data-mode]');
    this._list = bodyElement.querySelector('#puzzle-selector-list');
    this._count = bodyElement.querySelector('#puzzle-selector-count');
    this._status = bodyElement.querySelector('#puzzle-selector-status');

    // Bumped on every selection; a load whose token is stale by the time it
    // resolves is dropped (latest click wins).
    this._loadToken = 0;
    this._buildToken = 0;
    this._mode = 'examples';
    this._e2ePuzzlesPromise = null;

    // Per-group rows (for filtering) and a flat ordered list (for keyboard nav).
    this._groups = [];
    this._navItems = [];
    this._active = null;

    this._setMode(this._mode);

    // The filter persists (it is never cleared on selection), so the user can
    // browse through all puzzles matching a query by clicking each in turn.
    autoSaveField(this._filter);
    for (const button of this._modeButtons) {
      button.addEventListener('click', () => this._setMode(button.dataset.mode));
    }
    this._filter.addEventListener('input', () => this._applyFilter());
    this._filter.addEventListener('keydown', (e) => this._onFilterKey(e));
  }

  setEnabled(enabled) {
    // Focus the filter when the panel opens so the user can type immediately.
    // Deferred so it runs after the drawer has actually shown the panel.
    if (enabled) requestAnimationFrame(() => this._filter.focus());
  }

  reshape() { }

  clear() {
    this._setActive(null);
    this._setStatus('');
  }

  // Build a nav item from a puzzle config.
  _makeItem(puzzle, cfg, label) {
    const tags = cfg.constraintTypes || extractConstraintTypes(cfg.input);
    return {
      puzzle,
      input: cfg.input,
      src: cfg.src,
      tags,
      label,
      search: [label, ...tags].join(' ').toLowerCase(),
    };
  }

  _exampleGroups() {
    const groups = [];

    const exampleItems = [...PUZZLE_INDEX.values()].map(puzzle =>
      this._makeItem(puzzle, puzzle, puzzle.name || '(unnamed)'));
    groups.push({ items: exampleItems });

    for (const listName of COLLECTION_NAMES) {
      const list = PuzzleCollections[listName];
      if (!list) continue;
      const items = list.map((entry, i) => {
        const cfg = list.configFor(entry);
        const name = PUZZLE_INDEX.has(entry) ? cfg.name : '';
        return this._makeItem(entry, cfg, `${listName}[${i}]`);
      });
      groups.push({ items });
    }

    return groups;
  }

  async _e2eGroups() {
    this._e2ePuzzlesPromise ??= import('../../tests/e2e/e2e_puzzles.js' + self.VERSION_PARAM);
    const { solveCollections } = await this._e2ePuzzlesPromise;
    return solveCollections.map(({ collection, puzzles }) => ({
      items: puzzles.map((entry, i) => {
        const cfg = resolvePuzzleConfig(entry);
        const label = `${collection}[${i}]` + (cfg.name ? `: ${cfg.name}` : '');
        return this._makeItem(entry, cfg, label);
      }),
    }));
  }

  _buildGroups() {
    return this._mode === 'e2e' ? this._e2eGroups() : this._exampleGroups();
  }

  // Assign each constraint type a stable, well-separated hue
  // so a given type is the same colour everywhere.
  _makeTagHues(groups) {
    const types = new Set();
    for (const group of groups) {
      for (const item of group.items) {
        for (const type of item.tags || []) types.add(type);
      }
    }
    const hues = new Map();
    [...types].sort().forEach((type, i) => {
      hues.set(type, Math.round((i * 137.508) % 360));
    });
    return hues;
  }

  async _setMode(mode) {
    if (!mode || (mode === this._mode && this._groups.length)) return;
    this._mode = mode;
    const token = ++this._buildToken;
    this._setActive(null);
    this._groups = [];
    this._navItems = [];
    this._list.textContent = '';
    this._count.textContent = '';
    for (const button of this._modeButtons) {
      button.classList.toggle('active', button.dataset.mode === mode);
    }

    if (mode === 'e2e' && !this._e2ePuzzlesPromise) {
      this._setStatus('Loading E2E puzzles…');
    }
    try {
      const groups = await this._buildGroups();
      if (token !== this._buildToken) return;
      this._renderGroups(groups);
      this._setStatus('');
      this._applyFilter();
    } catch (e) {
      if (token !== this._buildToken) return;
      this._setStatus(`Couldn't load ${mode} puzzles: ${e.message || e}`, 'error');
    }
  }

  _renderGroups(groups) {
    const fragment = document.createDocumentFragment();
    const tagHues = this._makeTagHues(groups);

    for (const group of groups) {
      const section = document.createElement('div');
      section.className = 'puzzle-group';

      const groupItems = [];
      for (const item of group.items) {
        const row = document.createElement('div');
        row.className = 'puzzle-item hstack';
        row.title = [item.label, item.tags?.join(', ')].filter(Boolean).join(' — ');

        row.append(this._makeSrcIcon(item.src ?? item.puzzle.src));

        const label = document.createElement('span');
        label.className = 'puzzle-item-label';
        label.textContent = item.label;
        row.append(label);

        if (item.tags?.length) {
          const tags = document.createElement('span');
          tags.className = 'puzzle-item-tags';
          for (const type of item.tags) {
            const chip = document.createElement('span');
            chip.className = 'puzzle-item-tag';
            chip.textContent = type;
            chip.style.setProperty('--tag-hue', tagHues.get(type));
            tags.append(chip);
          }
          row.append(tags);
        }

        const input = item.input ?? item.puzzle.input;
        if (typeof input === 'string' && input.endsWith('.js')) {
          row.append(this._makeScriptIcon(input));
        }

        const entry = { row, item, search: item.search };
        row.addEventListener('click', () => {
          this._setActive(entry);
          this._select(entry);
        });

        groupItems.push(entry);
        this._navItems.push(entry);
        section.append(row);
      }

      fragment.append(section);
      this._groups.push({ section, items: groupItems });
    }

    this._list.append(fragment);
  }

  _applyFilter() {
    const tokens = this._filter.value.trim().toLowerCase().split(/\s+/).filter(Boolean);

    let total = 0;
    for (const group of this._groups) {
      let visible = 0;
      for (const item of group.items) {
        const match = tokens.every(t => item.search.includes(t));
        item.row.hidden = !match;
        if (match) visible++;
      }
      group.section.hidden = visible === 0;
      total += visible;
    }

    // Keep a row teed up so Enter loads the top match.
    this._setActive(this._navItems.find(e => !e.row.hidden));

    this._count.textContent =
      total === 0 ? 'No matches' :
        total === 1 ? '1 puzzle' : `${total} puzzles`;
  }

  _onFilterKey(e) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        this._moveActive(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this._moveActive(-1);
        break;
      case 'Enter':
        if (this._active) {
          e.preventDefault();
          this._select(this._active);
        }
        break;
      case 'Escape':
        if (this._filter.value) {
          e.preventDefault();
          this._filter.value = '';
          this._applyFilter();
        }
        break;
    }
  }

  _moveActive(delta) {
    const visible = this._navItems.filter(e => !e.row.hidden);
    if (!visible.length) return;
    const idx = visible.indexOf(this._active);
    const next = idx === -1
      ? (delta > 0 ? 0 : visible.length - 1)
      : Math.max(0, Math.min(visible.length - 1, idx + delta));
    this._setActive(visible[next]);
  }

  _setActive(entry) {
    if (this._active === entry) return;
    this._active?.row.classList.remove('active');
    this._active = entry || null;
    if (this._active) {
      this._active.row.classList.add('active');
      this._active.row.scrollIntoView({ block: 'nearest' });
    }
  }

  async _select(entry) {
    const token = ++this._loadToken;
    // Latest click wins: abort a script still running for a previous pick. The
    // token guard below drops its stale result even if it finishes first.
    this._userScriptExecutor?.abort();

    const { label } = entry.item;
    this._setStatus(`Loading ${label}…`);
    try {
      const input = await this._resolveInput(resolvePuzzleConfig(entry.item.puzzle));
      if (token !== this._loadToken) return;
      this._constraintManager.loadUnsafeFromText(input);
      this._setStatus('');
    } catch (e) {
      if (token !== this._loadToken) return;
      this._setStatus(`Couldn't load ${label}: ${e.message || e}`, 'error');
    }
  }

  // Resolve a puzzle's input to constraint text: pass literals through, fetch
  // paths, and run .js paths as sandbox scripts to get the constraint they
  // generate.
  async _resolveInput(puzzle) {
    if (!puzzle.input.startsWith('/')) return puzzle.input;

    const response = await fetch('.' + puzzle.input);
    if (!response.ok) {
      throw new Error(`fetch ${puzzle.input} failed (${response.status})`);
    }
    const text = await response.text();
    if (!puzzle.input.endsWith('.js')) return text;

    this._userScriptExecutor ??= new UserScriptExecutor();
    const { constraintStr } = await this._userScriptExecutor.runSandboxCode(text, {}, '');
    return constraintStr;
  }

  _setStatus(text, variant = 'info') {
    this._status.textContent = text;
    this._status.classList.toggle('notice-info', text !== '' && variant === 'info');
    this._status.classList.toggle('notice-error', variant === 'error');
  }

  // A "</>" button that opens the generating script in the sandbox for editing
  // (only shown on script-built puzzles).
  _makeScriptIcon(path) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'puzzle-item-script plain-button';
    btn.textContent = '</>';
    btn.title = 'Open generating script in sandbox';
    btn.addEventListener('click', (e) => {
      // Don't also load the puzzle into the grid.
      e.stopPropagation();
      this._openScriptInSandbox?.(path);
    });
    return btn;
  }

  // A small link icon that opens the puzzle's source, or an empty placeholder
  // (so labels stay aligned) when there is no source.
  _makeSrcIcon(src) {
    if (Array.isArray(src)) src = src[0];
    if (!src) {
      const placeholder = document.createElement('span');
      placeholder.className = 'puzzle-item-src';
      return placeholder;
    }

    const link = createSourceLinkIcon(src, 'puzzle-item-src');
    // Opening the source should not also load the puzzle.
    link.addEventListener('click', (e) => e.stopPropagation());
    return link;
  }
}
