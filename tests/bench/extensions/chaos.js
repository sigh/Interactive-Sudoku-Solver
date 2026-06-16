// Extension: ablations for ChaosConstruction.
//
// An ablation disables one optimization (by patching a prototype method) so its
// search impact can be measured with solve.js --ablate / --compare. Disabling
// must keep the solver SOUND — it should still find the correct solution, just
// explore more; ablations are for measurement, never for changing answers.
//
// To add one: write `patch(<description>, <methodName>, <replacement>)` and give
// it a key below. The replacement must be a safe no-op for that method (one that
// preserves soundness, e.g. "found nothing" / "no contradiction").

const { ChaosConstruction } = await import('../../../js/solver/chaos_handler.js' + self.VERSION_PARAM);

// Build an ablation that swaps `method` on the prototype for `replacement`,
// returning a restore function.
const patch = (description, method, replacement) => ({
  description,
  apply() {
    const proto = ChaosConstruction.prototype;
    const original = proto[method];
    proto[method] = replacement;
    return () => { proto[method] = original; };
  },
});

export const ablations = {
  // The hidden-single deduction returns false (= "no placement made").
  'chaos-hidden-singles': patch(
    'Hidden-region-value singles (places a value confined to one cell).',
    '_enforceHiddenRegionValueSingles', function () { return false; }),

  // Forced-door returns true (= "no contradiction, nothing forced").
  'chaos-bottlenecks': patch(
    "Forced-door deduction (forces a region's single exit shard).",
    '_forceComponentDoors', function () { return true; }),
};
