const {
  autoSaveField,
  dynamicCSSFileLoader,
} = await import('../util.js' + self.VERSION_PARAM);

await dynamicCSSFileLoader('css/puzzle_selector.css' + self.VERSION_PARAM)();

const { SudokuParser } = await import('../sudoku_parser.js' + self.VERSION_PARAM);
const { UserScriptExecutor } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const {
  PUZZLE_INDEX,
  resolvePuzzleConfig,
} = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);
const PuzzleCollections = await import('../../data/collections.js' + self.VERSION_PARAM);

// Common source domains we have a local favicon for (img/link_favicons/<domain>.png).
// Anything else falls back to a generic "open in new tab" icon.
const FAVICON_DOMAINS = [
  'logic-masters.de',
  'youtube.com',
  'sudokupad.app',
  'forum.enjoysudoku.com',
  'reddit.com',
  'discord.com',
];

const FALLBACK_ICON = 'img/open-in-new-48.png';

// Resolve a source URL to a local favicon path, or null if we don't have one.
const faviconForSrc = (src) => {
  let host;
  try {
    host = new URL(src).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  // Progressive suffix match so subdomains resolve too
  // (e.g. forum.enjoysudoku.com -> enjoysudoku.com).
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (FAVICON_DOMAINS.includes(candidate)) {
      return `img/link_favicons/${candidate}.png`;
    }
  }
  return null;
};

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
  constructor(constraintManager, bodyElement) {
    this._constraintManager = constraintManager;

    this._filter = bodyElement.querySelector('#puzzle-selector-filter');
    this._list = bodyElement.querySelector('#puzzle-selector-list');
    this._count = bodyElement.querySelector('#puzzle-selector-count');

    // Per-group rows (for filtering) and a flat ordered list (for keyboard nav).
    this._groups = [];
    this._navItems = [];
    this._active = null;

    this._buildList();

    // The filter persists (it is never cleared on selection), so the user can
    // browse through all puzzles matching a query by clicking each in turn.
    autoSaveField(this._filter);
    this._filter.addEventListener('input', () => this._applyFilter());
    this._filter.addEventListener('keydown', (e) => this._onFilterKey(e));
    this._applyFilter();
  }

  setEnabled(enabled) {
    // Focus the filter when the panel opens so the user can type immediately.
    // Deferred so it runs after the drawer has actually shown the panel.
    if (enabled) requestAnimationFrame(() => this._filter.focus());
  }

  reshape() { }

  clear() {
    this._setActive(null);
  }

  // Build the grouped model: Examples followed by each benchmark collection.
  _buildGroups() {
    const groups = [];

    const exampleItems = [];
    for (const puzzle of PUZZLE_INDEX.values()) {
      const types = puzzle.constraintTypes
        || SudokuParser.extractConstraintTypes(puzzle.input);
      exampleItems.push({
        puzzle,
        label: puzzle.name || '(unnamed)',
        tags: types,
        search: `${puzzle.name || ''} ${types.join(' ')}`.toLowerCase(),
      });
    }
    groups.push({ items: exampleItems });

    for (const listName of COLLECTION_NAMES) {
      const list = PuzzleCollections[listName];
      if (!list) continue;
      const items = list.map((puzzle, i) => ({
        puzzle,
        label: `${listName}[${i}]`,
        detail: puzzle.name || '',
        search: `${listName} ${i} ${puzzle.name || ''}`.toLowerCase(),
      }));
      groups.push({ items });
    }

    return groups;
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

  _buildList() {
    const fragment = document.createDocumentFragment();
    const groups = this._buildGroups();
    const tagHues = this._makeTagHues(groups);

    for (const group of groups) {
      const section = document.createElement('div');
      section.className = 'puzzle-group';

      const groupItems = [];
      for (const item of group.items) {
        const secondary = item.tags?.length ? item.tags.join(', ') : item.detail;

        const row = document.createElement('div');
        row.className = 'puzzle-item hstack';
        row.title = [item.label, secondary].filter(Boolean).join(' — ');

        row.append(this._makeSrcIcon(item.puzzle.src));

        const label = document.createElement('span');
        label.className = 'puzzle-item-label';
        label.textContent = item.label;
        row.append(label);

        if (item.tags?.length) {
          // Constraint types as small chips, so they read as distinct tokens.
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
        } else if (item.detail) {
          const detail = document.createElement('span');
          detail.className = 'puzzle-item-detail';
          detail.textContent = item.detail;
          row.append(detail);
        }

        const entry = { row, item, search: item.search };
        row.addEventListener('click', () => {
          this._setActive(entry);
          this._select(item);
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
          this._select(this._active.item);
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

  async _select(item) {
    const puzzle = resolvePuzzleConfig(item.puzzle);
    // Lazily fetch input from file if it's a path.
    if (puzzle.input.startsWith('/')) {
      const response = await fetch('.' + puzzle.input);
      const text = await response.text();
      // .js files are sandbox scripts that generate the constraint.
      if (puzzle.input.endsWith('.js')) {
        puzzle.input = await this._runSandboxScript(text);
      } else {
        puzzle.input = text;
      }
    }
    this._constraintManager.loadUnsafeFromText(puzzle.input);
  }

  // Run a sandbox script and return the constraint string it generates. The
  // script has the same capabilities (and risks) as code typed into the
  // sandbox editor.
  _runSandboxScript(code) {
    this._userScriptExecutor ??= new UserScriptExecutor();
    return this._userScriptExecutor.runSandboxCode(code, {}, '')
      .then(result => result.constraintStr);
  }

  // A small link icon that opens the puzzle's source, or an empty placeholder
  // (so labels stay aligned) when there is no source.
  _makeSrcIcon(src) {
    if (!src) {
      const placeholder = document.createElement('span');
      placeholder.className = 'puzzle-item-src';
      return placeholder;
    }

    const link = document.createElement('a');
    link.className = 'puzzle-item-src';
    link.href = src;
    link.target = '_blank';
    link.rel = 'noopener';
    link.title = 'Open source';
    // Opening the source should not also load the puzzle.
    link.addEventListener('click', (e) => e.stopPropagation());

    const img = document.createElement('img');
    img.alt = 'source';
    const favicon = faviconForSrc(src);
    if (favicon) {
      img.src = favicon;
      // Fall back if a favicon ever fails to load.
      img.onerror = () => { img.onerror = null; this._setFallbackIcon(img); };
    } else {
      this._setFallbackIcon(img);
    }
    link.append(img);
    return link;
  }

  _setFallbackIcon(img) {
    img.src = FALLBACK_ICON;
  }
}
