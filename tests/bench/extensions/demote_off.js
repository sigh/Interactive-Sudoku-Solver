const { ConflictScores } = await import('../../../js/solver/candidate_selector.js' + self.VERSION_PARAM);
export const ablations = {
  'demote-off': {
    description: 'Disable the inert-cell demote.',
    apply() {
      const orig = ConflictScores.prototype.demote;
      ConflictScores.prototype.demote = function () { };
      return () => { ConflictScores.prototype.demote = orig; };
    },
  },
};
