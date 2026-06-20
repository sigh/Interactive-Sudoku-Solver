const {
  clearDOMNode,
  dynamicCSSFileLoader,
} = await import('../util.js' + self.VERSION_PARAM);

await dynamicCSSFileLoader('css/puzzle_selector.css' + self.VERSION_PARAM)();

const { SudokuParser } = await import('../sudoku_parser.js' + self.VERSION_PARAM);
const {
  PUZZLE_INDEX,
  resolvePuzzleConfig,
} = await import('../../data/example_puzzles.js' + self.VERSION_PARAM);
const PuzzleCollections = await import('../../data/collections.js' + self.VERSION_PARAM);

export class PuzzleSelectorPanel {
  constructor(constraintManager, bodyElement) {
    this._constraintManager = constraintManager;

    this._input = bodyElement.querySelector('#puzzle-selector-input');
    this._datalist = bodyElement.querySelector('#puzzle-selector-puzzles');
    this._puzzleSrc = bodyElement.querySelector('#puzzle-selector-src');

    this._loadPuzzleInput();
  }

  setEnabled() { }

  reshape() { }

  clear() {
    clearDOMNode(this._puzzleSrc);
  }

  static _makeIndex() {
    const index = new Map();

    for (const puzzle of PUZZLE_INDEX.values()) {
      const constraintTypes = puzzle.constraintTypes
        || SudokuParser.extractConstraintTypes(puzzle.input);
      const title = `${puzzle.name || ''} [${constraintTypes.join(',')}]`;
      index.set(title, puzzle);
    }

    const puzzleLists = {
      TAREK_ALL: PuzzleCollections.TAREK_ALL,
      EXTREME_KILLERS: PuzzleCollections.EXTREME_KILLERS,
      HARD_THERMOS: PuzzleCollections.HARD_THERMOS,
      MATHEMAGIC_KILLERS: PuzzleCollections.MATHEMAGIC_KILLERS,
      HARD_RENBAN: PuzzleCollections.HARD_RENBAN,
      HARD_PENCILMARKS: PuzzleCollections.HARD_PENCILMARKS,
      HS_KILLERS: PuzzleCollections.HS_KILLERS,
      LITTLE_KILLER_SNIPES: PuzzleCollections.LITTLE_KILLER_SNIPES,
    };
    for (const [listName, list] of Object.entries(puzzleLists)) {
      for (let i = 0; i < list.length; i++) {
        const puzzle = list[i];
        const name = `${listName}[${i}]`;
        index.set(name, puzzle);
      }
    }

    return index;
  }

  async _loadInput(puzzleCfg) {
    const puzzle = resolvePuzzleConfig(puzzleCfg);

    // Lazily fetch input from file if it's a path.
    if (puzzle.input.startsWith('/')) {
      const response = await fetch('.' + puzzle.input);
      puzzle.input = await response.text();
    }

    this._constraintManager.loadUnsafeFromText(puzzle.input);
  }

  _loadPuzzleInput() {
    const index = this.constructor._makeIndex();
    const datalist = this._datalist;
    for (const name of index.keys()) {
      const option = document.createElement('option');
      option.value = name;
      datalist.appendChild(option);
    }

    const input = this._input;
    input.onchange = async () => {
      const name = input.value;
      // Clear the input after a short time so the user can still notice
      // what was selected.
      window.setTimeout(() => {
        input.value = '';
      }, 300);

      const puzzle = index.get(name);
      if (!puzzle) return;

      await this._loadInput(puzzle);

      window.setTimeout(() => {
        const puzzleSrc = this._puzzleSrc;
        clearDOMNode(puzzleSrc);
        if (puzzle.src) {
          const link = document.createElement('a');
          link.href = puzzle.src;
          link.textContent = puzzle.name;
          puzzleSrc.appendChild(link);
        } else {
          puzzleSrc.textContent = puzzle.name;
        }
      }, 0);
    };
  }
}
