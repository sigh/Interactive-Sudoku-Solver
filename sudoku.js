const CELL_SIZE = 50;
const THIN_BORDER_STYLE = '1px solid';
const FAT_BORDER_STYLE = '3px solid';

const initGrid = () => {
  let container = document.createElement('div');
  document.body.appendChild(container);

  let grid = new SudokuGrid(container);
};

class SudokuGrid {
  constructor(container) {
    this.cellMap = this.makeSudokuGrid(container);
  }

  styleCell(cell, row, col) {
    cell.className = 'cell';
    cell.style.border = THIN_BORDER_STYLE;
    if (row%3 == 0) cell.style.borderTop = FAT_BORDER_STYLE;
    if (col%3 == 0) cell.style.borderLeft = FAT_BORDER_STYLE;
    if (row == 8) cell.style.borderBottom = FAT_BORDER_STYLE;
    if (col == 8) cell.style.borderRight = FAT_BORDER_STYLE;
  }

  makeSudokuGrid(container) {
    let cellMap = {};

    for (let i = 0; i < 9; i++) {
      let row = document.createElement('div');
      for (let j = 0; j < 9; j++) {
        let cell = document.createElement('div');
        this.styleCell(cell, i, j);
        let cellValue = document.createElement('div');
        cellValue.tabIndex = i*9 + j;
        cellValue.className = 'inner-cell';
        cellValue.innerText = 1;
        cell.appendChild(cellValue);
        row.appendChild(cell);
        cellMap[`R${i}C${j}`] = cellValue;
      }
      container.appendChild(row);
    }

    return cellMap;
  }
}
