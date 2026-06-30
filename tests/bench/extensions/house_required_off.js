const { SudokuConstraintOptimizer } = await import('../../../js/solver/optimizer.js' + self.VERSION_PARAM);
export const ablations = {
  'house-required-off': {
    description: 'Disable house-derived required-digit propagation for Rellik cages.',
    apply() {
      const orig = SudokuConstraintOptimizer.prototype._optimizeRellik;
      SudokuConstraintOptimizer.prototype._optimizeRellik = function () { };
      return () => { SudokuConstraintOptimizer.prototype._optimizeRellik = orig; };
    },
  },
};
