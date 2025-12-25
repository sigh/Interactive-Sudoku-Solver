const { SudokuConstraint } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { clearDOMNode } = await import('../util.js' + self.VERSION_PARAM);

const CATEGORY_CONFIGS = {
  'LinesAndSets': {
    description: 'Constraints that apply to lines, regions, or sets of cells',
    instructions: `
      Select cells by click and dragging on the grid then select a constraint
      from the "Lines & Sets" panel.
      Cells can also be added and removed by holding down shift while
      clicking.`,
  },
  'OutsideClue': {
    description: 'Constraints that use clues outside the grid',
    instructions: `
      Click on an arrow outside the grid then select a constraint from the
      "Outside Clues" panel.`
  },
  'LayoutCheckbox': {
    description: 'Layout and structural constraints',
    instructions: `Use checkboxes in the "Layout constraints" panel.`
  },
  'Global': {
    description: 'Constraints that apply to the entire grid',
    instructions: `Use the controls in the "Global constraints" panel.`
  },
  'GivenCandidates': {
    description: 'Restrictions on the initial values of cells',
    instructions: `
      Select a cell by clicking on it then typing to enter a value or backspace
      to clear the cells.
      Use the "Set multiple values" panel to set more than one value.
      Select extra cells by dragging, or shift-clicking.`
  },
  'Pairwise': {
    description: 'Custom pairwise relationships between cells',
    instructions: `
      Select cells by click and dragging on the grid then configuring the
      constraint in the "JavaScript constraints" panel using the Pairwise tab
      (see panel for instructions).
      Cells can also be added and removed by holding down shift while
      clicking.`,
  },
  'StateMachine': {
    description: 'Finite-state machine for accepting cell sequences',
    instructions: `
      Select cells by click and dragging on the grid, then use the
      "Custom JavaScript constraints" panel with the State machine tab to define
      the start state, transition, and accept logic (see panel for guidance).
      Cells can also be added and removed by holding shift while clicking.`,
  },
  'Jigsaw': {
    description: 'Irregular grid regions',
    instructions: `
      Select cells by click and dragging on the grid then pressing
      "Add Jigsaw Piece" in the "Layout constraints" panel.
      The selected region size must match the row/column length.
      Cells can also be added and removed by holding down shift while
      clicking.`,
  },
  'Composite': {
    description: 'Composite constraints that group other constraints',
    instructions: `
      Use the "Composite constraints" panel to create a new composite group
      by pressing the button of the group type you want.
      When a group is selected, new constraints you create will be added to it.
    `
  },
  'Shape': {
    description: 'Overall grid size',
    instructions: `Select the grid shape using the "Shape" dropdown.`
  },
};

const getAllConstraintClasses = () => {
  const classes = [];
  for (const [name, constraintClass] of Object.entries(SudokuConstraint)) {
    if (typeof constraintClass !== 'function' || !constraintClass.CATEGORY) {
      continue;
    }

    if (!CATEGORY_CONFIGS.hasOwnProperty(constraintClass.CATEGORY)) {
      continue;
    }

    classes.push({
      name: name,
      class: constraintClass,
      category: constraintClass.CATEGORY,
      displayName: constraintClass.displayName ? constraintClass.displayName() : name,
      description: constraintClass.DESCRIPTION || null
    });
  }
  return classes;
};

const groupConstraintsByCategory = (constraints) => {
  const grouped = new Map();

  for (const category of Object.keys(CATEGORY_CONFIGS)) {
    grouped.set(category, []);
  }

  for (const constraint of constraints) {
    grouped.get(constraint.category).push(constraint);
  }
  return grouped;
};

const formatCategoryName = (category) => {
  return category.replace(/([A-Z])/g, ' $1').trim();
};

const formatInstructions = (instructions) => {
  // Format instructions with one sentence per line.
  const cleaned = instructions.trim().replace(/\s+/g, ' ');
  const sentences = cleaned.split('.').filter(
    sentence => sentence.trim().length > 0);
  return sentences.map(sentence => sentence.trim() + '.').join('\n');
};

const createCategoryOverviewItem = (category, config) => {
  const overviewItem = document.createElement('div');
  overviewItem.className = 'category-overview-item';

  // Left column: category content
  const categoryContent = document.createElement('div');
  categoryContent.className = 'category-overview-content';

  const categoryTitle = document.createElement('div');
  categoryTitle.className = 'category-name';
  const categoryLink = document.createElement('a');
  categoryLink.href = `#${category}`;
  categoryLink.textContent = formatCategoryName(category);
  categoryTitle.appendChild(categoryLink);

  const categoryDescription = document.createElement('p');
  categoryDescription.textContent = config.description || '';

  categoryContent.appendChild(categoryTitle);
  categoryContent.appendChild(categoryDescription);

  // Right column: instructions
  const categoryInstructions = document.createElement('div');
  categoryInstructions.className = 'instructions';
  categoryInstructions.textContent = formatInstructions(config.instructions);

  overviewItem.appendChild(categoryContent);
  overviewItem.appendChild(categoryInstructions);

  return overviewItem;
};

const createConstraintItem = (constraint) => {
  const constraintItem = document.createElement('div');
  constraintItem.className = 'constraint-item';

  const constraintName = document.createElement('h4');
  constraintName.textContent = constraint.displayName;

  const constraintDescription = document.createElement('p');
  constraintDescription.textContent = constraint.description || '';

  constraintItem.appendChild(constraintName);
  constraintItem.appendChild(constraintDescription);

  return constraintItem;
};

const createCategorySection = (category, constraints) => {
  const categorySection = document.createElement('div');
  categorySection.className = 'category-section';

  const categoryTitle = document.createElement('h3');
  categoryTitle.id = category;
  categoryTitle.textContent = formatCategoryName(category);

  const categoryDescription = document.createElement('p');
  categoryDescription.textContent = CATEGORY_CONFIGS[category].description || '';

  const categoryInstructions = document.createElement('p');
  categoryInstructions.className = 'instructions';
  categoryInstructions.textContent = formatInstructions(
    CATEGORY_CONFIGS[category].instructions);

  const constraintList = document.createElement('div');
  constraintList.className = 'constraint-list';

  for (const constraint of constraints) {
    const constraintItem = createConstraintItem(constraint);
    constraintList.appendChild(constraintItem);
  }

  categorySection.appendChild(categoryTitle);
  categorySection.appendChild(categoryDescription);
  categorySection.appendChild(categoryInstructions);
  categorySection.appendChild(constraintList);

  return categorySection;
};

export const renderHelpPage = () => {
  const categoriesContainer = document.getElementById('categories-content');
  const constraintsContainer = document.getElementById('constraints-content');
  const constraints = getAllConstraintClasses();
  const grouped = groupConstraintsByCategory(constraints);

  clearDOMNode(categoriesContainer);
  clearDOMNode(constraintsContainer);

  // Create categories overview section
  const categoriesOverview = document.createElement('div');
  categoriesOverview.className = 'categories-overview';

  for (const category of Object.keys(CATEGORY_CONFIGS)) {
    const overviewItem = createCategoryOverviewItem(
      category, CATEGORY_CONFIGS[category]);
    categoriesOverview.appendChild(overviewItem);
  }

  categoriesContainer.appendChild(categoriesOverview);

  // Create detailed constraints section
  for (const category of Object.keys(CATEGORY_CONFIGS)) {
    const categoryConstraints = grouped.get(category).sort(
      (a, b) => a.displayName.localeCompare(b.displayName));
    const categorySection = createCategorySection(category, categoryConstraints);
    constraintsContainer.appendChild(categorySection);
  }
};