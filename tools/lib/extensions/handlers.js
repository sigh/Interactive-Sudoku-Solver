// Extension: register the constraint-handler modules whose exported classes the
// profiler can target (profile.js --handler / --list-handlers). Every class with
// an `enforceConsistency` method exported by a listed module becomes profilable.
//
// To make a new module's handlers profilable, add it to the array below.

export const handlerModules = [
  await import('../../../js/solver/handlers.js' + self.VERSION_PARAM),
  await import('../../../js/solver/chaos_handler.js' + self.VERSION_PARAM),
  await import('../../../js/solver/sum_handler.js' + self.VERSION_PARAM),
  await import('../../../js/solver/nfa_handler.js' + self.VERSION_PARAM),
];
