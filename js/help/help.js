const { SudokuConstraint } = await import('../sudoku_constraint.js' + self.VERSION_PARAM);
const { clearDOMNode } = await import('../util.js' + self.VERSION_PARAM);

const CATEGORY_DESCRIPTIONS = {
  'LinesAndSets': 'Constraints that apply to lines, regions, or sets of cells',
  'OutsideClue': 'Constraints that use clues outside the grid',
  'LayoutCheckbox': 'Layout and structural constraints',
  'GlobalCheckbox': 'Global rules that apply to the entire grid',
  'GivenCandidates': '',
  'CustomBinary': 'Custom binary relationships between cells',
  'Jigsaw': '',
  'Composite': 'Composite constraints that group other constraints',
  'Shape': '',
};

const getAllConstraintClasses = () => {
  const classes = [];
  for (const [name, constraintClass] of Object.entries(SudokuConstraint)) {
    if (typeof constraintClass !== 'function' || !constraintClass.CATEGORY) {
      continue;
    }

    if (!CATEGORY_DESCRIPTIONS.hasOwnProperty(constraintClass.CATEGORY)) {
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

  for (const category of Object.keys(CATEGORY_DESCRIPTIONS)) {
    grouped.set(category, []);
  }

  for (const constraint of constraints) {
    grouped.get(constraint.category).push(constraint);
  }
  return grouped;
};

const sortConstraintsInCategory = (constraints) => {
  return constraints.sort((a, b) => a.displayName.localeCompare(b.displayName));
};

const formatCategoryName = (category) => {
  return category.replace(/([A-Z])/g, ' $1').trim();
};

const createConstraintItem = (constraint) => {
  const constraintItem = document.createElement('div');
  constraintItem.className = 'constraint-item';

  const constraintName = document.createElement('div');
  constraintName.className = 'constraint-name';
  constraintName.textContent = constraint.displayName;

  const constraintDescription = document.createElement('div');
  constraintDescription.className = 'constraint-description';

  if (constraint.description) {
    constraintDescription.textContent = constraint.description;
  } else {
    const noDescription = document.createElement('span');
    noDescription.className = 'no-description';
    noDescription.textContent = 'No description available';
    constraintDescription.appendChild(noDescription);
  }

  constraintItem.appendChild(constraintName);
  constraintItem.appendChild(constraintDescription);

  return constraintItem;
};

const createCategorySection = (category, constraints) => {
  const categorySection = document.createElement('div');
  categorySection.className = 'category-section';

  const categoryTitle = document.createElement('h2');
  categoryTitle.className = 'category-title';
  categoryTitle.textContent = formatCategoryName(category);

  const categoryDescription = document.createElement('p');
  categoryDescription.textContent = CATEGORY_DESCRIPTIONS[category];

  const constraintList = document.createElement('div');
  constraintList.className = 'constraint-list';

  for (const constraint of constraints) {
    const constraintItem = createConstraintItem(constraint);
    constraintList.appendChild(constraintItem);
  }

  categorySection.appendChild(categoryTitle);
  categorySection.appendChild(categoryDescription);
  categorySection.appendChild(constraintList);

  return categorySection;
};

export const renderHelpPage = () => {
  const container = document.getElementById('constraints-content');
  const constraints = getAllConstraintClasses();
  const grouped = groupConstraintsByCategory(constraints);

  clearDOMNode(container);

  for (const category of Object.keys(CATEGORY_DESCRIPTIONS)) {
    if (grouped.has(category)) {
      const categoryConstraints = sortConstraintsInCategory(grouped.get(category));
      const categorySection = createCategorySection(category, categoryConstraints);
      container.appendChild(categorySection);
    }
  }
};