/// Variable-capacity bitset backed by a `Vec<u32>`.
///
/// Mirrors JS `BitSet` from `util.js`. Word count is determined by
/// `ceil(capacity / 32)`, matching JS `_wordCountFor`.
#[derive(Clone)]
pub struct BitSet {
    words: Vec<u32>,
}

impl BitSet {
    /// Create a zero-capacity bitset (placeholder).
    #[inline]
    pub fn new() -> Self {
        BitSet { words: Vec::new() }
    }

    /// Create an empty bitset with the given capacity in bits.
    /// Matches JS `new BitSet(capacity)`.
    #[inline]
    pub fn with_capacity(capacity: usize) -> Self {
        let word_count = (capacity + 31) / 32;
        BitSet {
            words: vec![0u32; word_count],
        }
    }

    /// Clear all bits.
    /// Matches JS `clear()`.
    #[inline]
    pub fn clear(&mut self) {
        self.words.fill(0);
    }

    /// Set a bit.
    /// Matches JS `add(bitIndex)`.
    #[inline]
    pub fn add(&mut self, bit_index: usize) {
        let word_index = bit_index >> 5;
        let mask = 1u32 << (bit_index & 31);
        self.words[word_index] |= mask;
    }

    /// Clear a bit.
    /// Matches JS `remove(bitIndex)`.
    #[inline]
    pub fn remove(&mut self, bit_index: usize) {
        let word_index = bit_index >> 5;
        let mask = 1u32 << (bit_index & 31);
        self.words[word_index] &= !mask;
    }

    /// Test if a bit is set.
    /// Matches JS `has(bitIndex)`.
    #[inline]
    pub fn has(&self, bit_index: usize) -> bool {
        let word_index = bit_index >> 5;
        let mask = 1u32 << (bit_index & 31);
        (self.words[word_index] & mask) != 0
    }

    /// In-place intersection: `self &= other`.
    /// Matches JS `intersect(other)`.
    #[inline]
    pub fn intersect(&mut self, other: &BitSet) {
        for i in 0..self.words.len() {
            self.words[i] &= other.words[i];
        }
    }

    /// Count of bits set in `self & other` (without modifying either).
    /// Matches JS `intersectCount(other)`.
    #[inline]
    pub fn intersect_count(&self, other: &BitSet) -> usize {
        let mut count = 0u32;
        for i in 0..self.words.len() {
            count += (self.words[i] & other.words[i]).count_ones();
        }
        count as usize
    }

    /// Returns true iff `self & other` is non-empty.
    /// Matches JS `hasIntersection(other)`.
    #[inline]
    pub fn has_intersection(&self, other: &BitSet) -> bool {
        for i in 0..self.words.len() {
            if (self.words[i] & other.words[i]) != 0 {
                return true;
            }
        }
        false
    }

    /// Raw word slice for performance-critical code that operates on
    /// words directly (e.g. bulk copy into scratch buffers).
    #[inline]
    pub fn words(&self) -> &[u32] {
        &self.words
    }

    /// Mutable raw word slice.
    #[inline]
    pub fn words_mut(&mut self) -> &mut [u32] {
        &mut self.words
    }

    /// Iterate over each set bit, calling `f(bit_index)`.
    /// If `f` returns `false`, iteration stops early.
    /// Matches JS `forEachBit(callback)`.
    #[inline]
    pub fn for_each_bit<F: FnMut(usize) -> bool>(&self, mut f: F) {
        for word_index in 0..self.words.len() {
            let mut word = self.words[word_index];
            while word != 0 {
                let lowest_bit = word & word.wrapping_neg();
                let bit_position = 31 - lowest_bit.leading_zeros();
                let bit_index = (word_index << 5) + bit_position as usize;
                if !f(bit_index) {
                    return;
                }
                word ^= lowest_bit;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_has_remove() {
        let mut bs = BitSet::with_capacity(256);
        assert!(!bs.has(0));
        bs.add(0);
        assert!(bs.has(0));
        bs.add(255);
        assert!(bs.has(255));
        bs.remove(0);
        assert!(!bs.has(0));
        assert!(bs.has(255));
    }

    #[test]
    fn test_intersect() {
        let mut a = BitSet::with_capacity(32);
        let mut b = BitSet::with_capacity(32);
        a.add(1);
        a.add(2);
        a.add(3);
        b.add(2);
        b.add(3);
        b.add(4);
        a.intersect(&b);
        assert!(!a.has(1));
        assert!(a.has(2));
        assert!(a.has(3));
        assert!(!a.has(4));
    }

    #[test]
    fn test_intersect_count() {
        let mut a = BitSet::with_capacity(32);
        let mut b = BitSet::with_capacity(32);
        a.add(1);
        a.add(2);
        a.add(3);
        b.add(2);
        b.add(3);
        b.add(4);
        assert_eq!(a.intersect_count(&b), 2);
    }

    #[test]
    fn test_for_each_bit() {
        let mut bs = BitSet::with_capacity(256);
        bs.add(5);
        bs.add(10);
        bs.add(200);
        let mut bits = Vec::new();
        bs.for_each_bit(|b| {
            bits.push(b);
            true
        });
        assert_eq!(bits, vec![5, 10, 200]);
    }

    #[test]
    fn test_clear() {
        let mut bs = BitSet::with_capacity(64);
        bs.add(42);
        bs.clear();
        assert!(!bs.has(42));
    }

    #[test]
    fn test_has_intersection() {
        let mut a = BitSet::with_capacity(64);
        let mut b = BitSet::with_capacity(64);
        assert!(!a.has_intersection(&b));
        a.add(5);
        assert!(!a.has_intersection(&b));
        b.add(5);
        assert!(a.has_intersection(&b));
    }

    #[test]
    fn test_word_count() {
        assert_eq!(BitSet::with_capacity(1).words.len(), 1);
        assert_eq!(BitSet::with_capacity(32).words.len(), 1);
        assert_eq!(BitSet::with_capacity(33).words.len(), 2);
        assert_eq!(BitSet::with_capacity(256).words.len(), 8);
    }
}
