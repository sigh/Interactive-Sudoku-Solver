//! SplitMix32 PRNG and Fisher-Yates shuffle.
//!
//! Mirrors JS `RandomIntGenerator` and `shuffleArray` from `util.js`.
//! See <https://github.com/bryc/code/blob/master/jshash/PRNGs.md#splitmix32>.

/// SplitMix32 PRNG.
pub struct RandomIntGenerator {
    state: u32,
}

impl RandomIntGenerator {
    /// Create a new generator with the given seed.
    /// Matches JS `new RandomIntGenerator(seed)` where `seed || 0`.
    #[inline]
    pub fn new(seed: u32) -> Self {
        RandomIntGenerator { state: seed }
    }

    /// Advance the state and generate a random 32-bit integer.
    /// Matches JS `_next()`.
    #[inline]
    fn next(&mut self) -> u32 {
        self.state = self.state.wrapping_add(0x9e3779b9);
        let mut t = self.state ^ (self.state >> 16);
        t = t.wrapping_mul(0x21f0aaad);
        t = t ^ (t >> 15);
        t = t.wrapping_mul(0x735a2d97);
        t ^ (t >> 15)
    }

    /// Random integer in the range [0, max] inclusive.
    /// Matches JS `randomInt(max)`.
    #[inline]
    pub fn random_int(&mut self, max: u32) -> u32 {
        self.next() % (max + 1)
    }
}

/// Fisher-Yates shuffle using a `RandomIntGenerator`.
///
/// Mirrors JS `shuffleArray(arr, randomGenerator)` from `util.js`.
pub fn shuffle_array<T>(arr: &mut [T], rng: &mut RandomIntGenerator) {
    for i in (1..arr.len()).rev() {
        let j = rng.random_int(i as u32) as usize;
        arr.swap(i, j);
    }
}
