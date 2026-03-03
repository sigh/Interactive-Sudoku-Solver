//! `CandidateSet` — a newtype over `u16` representing a set of Sudoku
//! candidate values (1–9).
//!
//! Bit `i` represents value `i + 1`.  For example, candidates {1, 3, 9}
//! are stored as `0b1_0000_0101`.
//!
//! This type replaces the loose `u16` bitmask convention used throughout
//! the solver, giving compile-time protection against mixing candidate
//! sets with cell indices, handler indices, or raw integers.
//!
//! Every method maps to either a JS `LookupTables` static method or an
//! inline bit-trick used across handlers.  `#[repr(transparent)]`
//! guarantees zero overhead.

use std::fmt;
use std::ops::{
    BitAnd, BitAndAssign, BitOr, BitOrAssign, BitXor, BitXorAssign, Not, Shl, ShlAssign, Shr,
    ShrAssign,
};
use crate::api::types::Value;

/// A bitmask representing a set of candidate values (1–9).
/// Bit `i` represents value `i + 1`.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Default)]
#[repr(transparent)]
pub struct CandidateSet(u16);

impl CandidateSet {
    /// The empty set (no candidates).
    pub const EMPTY: Self = Self(0);

    /// A full set for an arbitrary number of values (1–16).
    #[inline(always)]
    pub const fn all(num_values: u8) -> Self {
        Self(((1u32 << num_values) - 1) as u16)
    }

    // --- Construction ---------------------------------------------------

    /// From a single value (1-indexed).
    /// JS: `LookupTables.fromValue(v)`
    #[inline(always)]
    pub const fn from_value(v: Value) -> Self {
        // debug_assert in const fn is nightly-only, so we skip it here.
        Self(1 << (v - 1))
    }

    /// From a 0-indexed bit position.
    /// JS: `LookupTables.fromIndex(i)`
    #[inline(always)]
    pub const fn from_index(i: usize) -> Self {
        Self(1 << i)
    }

    /// From an iterator of 1-indexed values.
    /// JS: `LookupTables.fromValuesArray(xs)`
    pub fn from_values(vs: impl IntoIterator<Item = Value>) -> Self {
        vs.into_iter()
            .fold(Self::EMPTY, |acc, v| acc | Self::from_value(v))
    }

    /// From raw bits (for lookup table results, deserialization).
    #[inline(always)]
    pub const fn from_raw(bits: u16) -> Self {
        Self(bits)
    }

    // --- Extraction -----------------------------------------------------

    /// Raw bits (for lookup table indexing, serialization).
    #[inline(always)]
    pub const fn raw(self) -> u16 {
        self.0
    }

    /// The single value (1-indexed).  Exactly one bit must be set.
    /// JS: `LookupTables.toValue(v)` — `32 - Math.clz32(v)`
    #[inline(always)]
    pub fn value(self) -> Value {
        debug_assert!(self.0.count_ones() == 1);
        self.0.trailing_zeros() as u8 + 1
    }

    /// The 0-indexed bit position.  Exactly one bit must be set.
    /// JS: `LookupTables.toIndex(v)` — `31 - Math.clz32(v)`
    #[inline(always)]
    pub fn index(self) -> usize {
        debug_assert!(self.0.count_ones() == 1);
        self.0.trailing_zeros() as usize
    }

    // --- Set queries ----------------------------------------------------

    /// Number of candidates.
    #[inline(always)]
    pub fn count(self) -> u32 {
        self.0.count_ones()
    }

    /// True if at most one candidate (power of 2 or zero).
    /// Matches JS `!(v & (v-1))` — returns true for EMPTY.
    /// Callers already guard `v == 0` as a contradiction separately;
    /// this avoids an extra branch in hot loops.
    #[inline(always)]
    pub fn is_single(self) -> bool {
        (self.0 & self.0.wrapping_sub(1)) == 0
    }

    /// True if no candidates (contradiction).
    #[inline(always)]
    pub fn is_empty(self) -> bool {
        self.0 == 0
    }

    // --- Value range ----------------------------------------------------

    /// Minimum value (1-indexed).  Mask must be non-empty.
    /// JS: `LookupTables.minValue(v)`
    #[inline(always)]
    pub fn min_value(self) -> Value {
        debug_assert!(!self.is_empty());
        self.0.trailing_zeros() as u8 + 1
    }

    /// Maximum value (1-indexed).  Mask must be non-empty.
    /// JS: `LookupTables.maxValue(v)`
    #[inline(always)]
    pub fn max_value(self) -> Value {
        debug_assert!(!self.is_empty());
        16 - self.0.leading_zeros() as u8
    }

    /// Packed (min, max) designed to be summed across cells.
    /// Layout: `[min: 16 bits, max: 16 bits]`
    ///
    /// The magic constant `0x200020` equals `(32 << 16) | 32`: it biases
    /// `leading_zeros` (which returns 0–32) into 1-indexed value space so
    /// that the packed result can be summed across cells to get aggregate
    /// min and max.
    ///
    /// JS: `LookupTables.minMax16bitValue(v)`
    #[inline(always)]
    pub fn min_max_packed(self) -> u32 {
        let lowest = self.0 & self.0.wrapping_neg();
        0x200020 - ((lowest as u32).leading_zeros() << 16) - (self.0 as u32).leading_zeros()
    }

    /// Bitmask spanning min..=max (inclusive).
    /// JS: `LookupTables.valueRangeInclusive(v)`
    #[inline(always)]
    pub fn value_range_inclusive(self) -> Self {
        let low = self.0 & self.0.wrapping_neg();
        Self((1u32.wrapping_shl(32 - (self.0 as u32).leading_zeros()) as u16).wrapping_sub(low))
    }

    /// Bitmask spanning (min..max) exclusive of endpoints.
    /// Must have at least 2 values with a gap between them to produce
    /// a meaningful result.
    /// JS: `LookupTables.valueRangeExclusive(v)`
    #[inline(always)]
    pub fn value_range_exclusive(self) -> Self {
        debug_assert!(
            self.count() >= 2,
            "value_range_exclusive requires at least 2 candidates"
        );
        let low = self.0 & self.0.wrapping_neg();
        let high_shift = 31 - (self.0 as u32).leading_zeros();
        Self((1u32.wrapping_shl(high_shift).wrapping_sub((low as u32) * 2)) as u16)
    }

    // --- Bit manipulation -----------------------------------------------

    /// Isolate the lowest candidate bit.
    #[inline(always)]
    pub fn lowest(self) -> Self {
        Self(self.0 & self.0.wrapping_neg())
    }

    /// Test if any overlap exists.
    #[inline(always)]
    pub fn intersects(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }

    /// Remove candidates not in `mask`; returns true if anything changed.
    #[inline(always)]
    pub fn restrict(&mut self, mask: Self) -> bool {
        let old = self.0;
        self.0 &= mask.0;
        self.0 != old
    }

    // --- Iteration ------------------------------------------------------

    /// Iterate over individual single-bit `CandidateSet`s (lowest first).
    /// JS: `while (values) { let v = values & -values; values ^= v; ... }`
    #[inline]
    pub fn iter(self) -> CandidateSetIter {
        CandidateSetIter(self.0)
    }

    /// Collect to a `Vec` of 1-indexed values.
    /// JS: `LookupTables.toValuesArray(v)`
    pub fn to_values(self) -> Vec<Value> {
        self.iter().map(|c| c.value()).collect()
    }
}

// ============================================================================
// Iterator
// ============================================================================

/// Iterates over individual single-bit `CandidateSet`s, lowest first.
#[derive(Clone)]
pub struct CandidateSetIter(u16);

impl Iterator for CandidateSetIter {
    type Item = CandidateSet;

    #[inline]
    fn next(&mut self) -> Option<CandidateSet> {
        if self.0 == 0 {
            return None;
        }
        let bit = self.0 & self.0.wrapping_neg();
        self.0 ^= bit;
        Some(CandidateSet(bit))
    }

    #[inline]
    fn size_hint(&self) -> (usize, Option<usize>) {
        let n = self.0.count_ones() as usize;
        (n, Some(n))
    }
}

impl ExactSizeIterator for CandidateSetIter {}

// ============================================================================
// Bitwise operators
// ============================================================================

impl BitAnd for CandidateSet {
    type Output = Self;
    #[inline(always)]
    fn bitand(self, rhs: Self) -> Self {
        Self(self.0 & rhs.0)
    }
}

impl BitAndAssign for CandidateSet {
    #[inline(always)]
    fn bitand_assign(&mut self, rhs: Self) {
        self.0 &= rhs.0;
    }
}

impl BitOr for CandidateSet {
    type Output = Self;
    #[inline(always)]
    fn bitor(self, rhs: Self) -> Self {
        Self(self.0 | rhs.0)
    }
}

impl BitOrAssign for CandidateSet {
    #[inline(always)]
    fn bitor_assign(&mut self, rhs: Self) {
        self.0 |= rhs.0;
    }
}

impl BitXor for CandidateSet {
    type Output = Self;
    #[inline(always)]
    fn bitxor(self, rhs: Self) -> Self {
        Self(self.0 ^ rhs.0)
    }
}

impl BitXorAssign for CandidateSet {
    #[inline(always)]
    fn bitxor_assign(&mut self, rhs: Self) {
        self.0 ^= rhs.0;
    }
}

impl Not for CandidateSet {
    type Output = Self;
    /// Raw bitwise NOT. Upper bits (≥ NUM_VALUES) are garbage; callers
    /// bound the result via `&` with another CandidateSet.
    #[inline(always)]
    fn not(self) -> Self {
        Self(!self.0)
    }
}

impl Shl<u32> for CandidateSet {
    type Output = Self;
    #[inline(always)]
    fn shl(self, rhs: u32) -> Self {
        Self(self.0 << rhs)
    }
}

impl ShlAssign<u32> for CandidateSet {
    #[inline(always)]
    fn shl_assign(&mut self, rhs: u32) {
        self.0 <<= rhs;
    }
}

impl Shr<u32> for CandidateSet {
    type Output = Self;
    #[inline(always)]
    fn shr(self, rhs: u32) -> Self {
        Self(self.0 >> rhs)
    }
}

impl ShrAssign<u32> for CandidateSet {
    #[inline(always)]
    fn shr_assign(&mut self, rhs: u32) {
        self.0 >>= rhs;
    }
}

// ============================================================================
// Conversions
// ============================================================================

impl From<CandidateSet> for usize {
    /// Convert to `usize` for use as a table index.
    /// Zero-cost: just a widening cast from the inner `u16`.
    #[inline(always)]
    fn from(cs: CandidateSet) -> usize {
        cs.0 as usize
    }
}

// ============================================================================
// Debug / Display
// ============================================================================

impl fmt::Debug for CandidateSet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "CandidateSet({{")?;
        let mut first = true;
        for v in self.iter() {
            if !first {
                write!(f, ", ")?;
            }
            write!(f, "{}", v.value())?;
            first = false;
        }
        write!(f, "}})")
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // --- Constants -------------------------------------------------------

    #[test]
    fn test_constants() {
        assert_eq!(CandidateSet::EMPTY.raw(), 0);
        assert_eq!(CandidateSet::all(9).raw(), 0x1FF);
        assert_eq!(CandidateSet::all(9).count(), 9);
    }

    // --- Construction ----------------------------------------------------

    #[test]
    fn test_from_value() {
        assert_eq!(CandidateSet::from_value(1).raw(), 0b1);
        assert_eq!(CandidateSet::from_value(5).raw(), 0b10000);
        assert_eq!(CandidateSet::from_value(9).raw(), 0b100000000);
    }

    #[test]
    fn test_from_index() {
        assert_eq!(CandidateSet::from_index(0).raw(), 0b1);
        assert_eq!(CandidateSet::from_index(4).raw(), 0b10000);
        assert_eq!(CandidateSet::from_index(8).raw(), 0b100000000);
    }

    #[test]
    fn test_from_values() {
        let cs = CandidateSet::from_values([1, 3, 9]);
        assert_eq!(cs.raw(), 0b100000101);
        assert_eq!(cs.count(), 3);
    }

    #[test]
    fn test_from_values_empty() {
        let cs = CandidateSet::from_values(std::iter::empty::<u8>());
        assert_eq!(cs, CandidateSet::EMPTY);
    }

    #[test]
    fn test_from_raw() {
        assert_eq!(CandidateSet::from_raw(0b110).raw(), 0b110);
    }

    // --- Extraction ------------------------------------------------------

    #[test]
    fn test_value() {
        assert_eq!(CandidateSet::from_value(1).value(), 1);
        assert_eq!(CandidateSet::from_value(5).value(), 5);
        assert_eq!(CandidateSet::from_value(9).value(), 9);
    }

    #[test]
    fn test_index() {
        assert_eq!(CandidateSet::from_index(0).index(), 0);
        assert_eq!(CandidateSet::from_index(4).index(), 4);
        assert_eq!(CandidateSet::from_index(8).index(), 8);
    }

    // --- Set queries -----------------------------------------------------

    #[test]
    fn test_count() {
        assert_eq!(CandidateSet::EMPTY.count(), 0);
        assert_eq!(CandidateSet::all(9).count(), 9);
        assert_eq!(CandidateSet::from_raw(0b10101).count(), 3);
    }

    #[test]
    fn test_is_single() {
        // Single-bit values:
        assert!(CandidateSet::from_value(1).is_single());
        assert!(CandidateSet::from_value(5).is_single());
        // Empty returns true (matches JS !(v & (v-1))):
        assert!(CandidateSet::EMPTY.is_single());
        // Multi-bit:
        assert!(!CandidateSet::from_raw(0b101).is_single());
        assert!(!CandidateSet::all(9).is_single());
    }

    #[test]
    fn test_is_empty() {
        assert!(CandidateSet::EMPTY.is_empty());
        assert!(!CandidateSet::from_value(1).is_empty());
        assert!(!CandidateSet::all(9).is_empty());
    }

    // --- Value range -----------------------------------------------------

    #[test]
    fn test_min_value() {
        assert_eq!(CandidateSet::all(9).min_value(), 1);
        assert_eq!(CandidateSet::from_raw(0b110).min_value(), 2);
        assert_eq!(CandidateSet::from_value(7).min_value(), 7);
    }

    #[test]
    fn test_max_value() {
        assert_eq!(CandidateSet::all(9).max_value(), 9);
        assert_eq!(CandidateSet::from_raw(0b110).max_value(), 3);
        assert_eq!(CandidateSet::from_value(7).max_value(), 7);
    }

    #[test]
    fn test_min_max_packed() {
        // Single value 5: min=5, max=5
        let v = CandidateSet::from_value(5);
        let packed = v.min_max_packed();
        let max = packed & 0xFFFF;
        let min = packed >> 16;
        assert_eq!(min, 5);
        assert_eq!(max, 5);

        // Values {2, 3}: min=2, max=3
        let v = CandidateSet::from_raw(0b110);
        let packed = v.min_max_packed();
        let max = packed & 0xFFFF;
        let min = packed >> 16;
        assert_eq!(min, 2);
        assert_eq!(max, 3);

        // Summability: sum two single cells
        let a = CandidateSet::from_value(3).min_max_packed();
        let b = CandidateSet::from_value(7).min_max_packed();
        let sum = a + b;
        assert_eq!(sum >> 16, 10); // min sum = 3+7
        assert_eq!(sum & 0xFFFF, 10); // max sum = 3+7
    }

    #[test]
    fn test_value_range_inclusive() {
        // {2, 5} → bits 1..=4 → {2, 3, 4, 5}
        let cs = CandidateSet::from_values([2, 5]);
        let range = cs.value_range_inclusive();
        assert_eq!(range, CandidateSet::from_values([2, 3, 4, 5]));

        // Single value → itself
        let cs = CandidateSet::from_value(4);
        assert_eq!(cs.value_range_inclusive(), cs);
    }

    #[test]
    fn test_value_range_exclusive() {
        // {2, 5} → bits strictly between → {3, 4}
        let cs = CandidateSet::from_values([2, 5]);
        let range = cs.value_range_exclusive();
        assert_eq!(range, CandidateSet::from_values([3, 4]));

        // {1, 9} → {2, 3, 4, 5, 6, 7, 8}
        let cs = CandidateSet::from_values([1, 9]);
        let range = cs.value_range_exclusive();
        assert_eq!(range, CandidateSet::from_values([2, 3, 4, 5, 6, 7, 8]));

        // Adjacent values → empty
        let cs = CandidateSet::from_values([3, 4]);
        assert_eq!(cs.value_range_exclusive(), CandidateSet::EMPTY);
    }

    // --- Bit manipulation ------------------------------------------------

    #[test]
    fn test_lowest() {
        assert_eq!(
            CandidateSet::from_raw(0b1010).lowest(),
            CandidateSet::from_raw(0b10)
        );
        assert_eq!(
            CandidateSet::from_raw(0b100).lowest(),
            CandidateSet::from_raw(0b100)
        );
        assert_eq!(CandidateSet::all(9).lowest(), CandidateSet::from_value(1));
    }

    #[test]
    fn test_intersects() {
        let a = CandidateSet::from_values([1, 3, 5]);
        let b = CandidateSet::from_values([3, 7]);
        let c = CandidateSet::from_values([2, 4]);
        assert!(a.intersects(b));
        assert!(!a.intersects(c));
        assert!(!CandidateSet::EMPTY.intersects(CandidateSet::all(9)));
    }

    #[test]
    fn test_restrict() {
        let mut cs = CandidateSet::from_values([1, 3, 5, 7]);
        let mask = CandidateSet::from_values([1, 2, 3]);
        let changed = cs.restrict(mask);
        assert!(changed);
        assert_eq!(cs, CandidateSet::from_values([1, 3]));

        // No change:
        let mut cs2 = CandidateSet::from_values([1, 3]);
        assert!(!cs2.restrict(mask));
        assert_eq!(cs2, CandidateSet::from_values([1, 3]));
    }

    // --- Bitwise operators -----------------------------------------------

    #[test]
    fn test_bitand() {
        let a = CandidateSet::from_values([1, 3, 5]);
        let b = CandidateSet::from_values([3, 5, 7]);
        assert_eq!(a & b, CandidateSet::from_values([3, 5]));
    }

    #[test]
    fn test_bitor() {
        let a = CandidateSet::from_values([1, 3]);
        let b = CandidateSet::from_values([5, 7]);
        assert_eq!(a | b, CandidateSet::from_values([1, 3, 5, 7]));
    }

    #[test]
    fn test_bitxor() {
        let a = CandidateSet::from_values([1, 3, 5]);
        let b = CandidateSet::from_values([3, 5, 7]);
        assert_eq!(a ^ b, CandidateSet::from_values([1, 7]));
    }

    #[test]
    fn test_not() {
        // Not is a raw flip; only lower NUM_VALUES bits are meaningful.
        assert_eq!(!CandidateSet::EMPTY & CandidateSet::all(9), CandidateSet::all(9));
        assert_eq!(!CandidateSet::all(9) & CandidateSet::all(9), CandidateSet::EMPTY);
        assert_eq!(
            !CandidateSet::from_values([1, 3, 5, 7, 9]) & CandidateSet::all(9),
            CandidateSet::from_values([2, 4, 6, 8])
        );
        // Double negation is identity.
        assert_eq!(
            !!CandidateSet::from_values([1, 5, 9]),
            CandidateSet::from_values([1, 5, 9])
        );
    }

    #[test]
    fn test_bitand_assign() {
        let mut a = CandidateSet::from_values([1, 3, 5]);
        a &= CandidateSet::from_values([3, 5, 7]);
        assert_eq!(a, CandidateSet::from_values([3, 5]));
    }

    #[test]
    fn test_bitor_assign() {
        let mut a = CandidateSet::from_values([1, 3]);
        a |= CandidateSet::from_values([5, 7]);
        assert_eq!(a, CandidateSet::from_values([1, 3, 5, 7]));
    }

    #[test]
    fn test_bitxor_assign() {
        let mut a = CandidateSet::from_values([1, 3, 5]);
        a ^= CandidateSet::from_value(3);
        assert_eq!(a, CandidateSet::from_values([1, 5]));
    }

    #[test]
    fn test_shl() {
        // Shifting {1} left by 2 gives {3}.
        assert_eq!(
            CandidateSet::from_value(1) << 2,
            CandidateSet::from_value(3)
        );
        // Shifting {1,2} left by 1 gives {2,3}.
        assert_eq!(
            CandidateSet::from_values([1, 2]) << 1,
            CandidateSet::from_values([2, 3])
        );
        // Shifting EMPTY is still EMPTY.
        assert_eq!(CandidateSet::EMPTY << 3, CandidateSet::EMPTY);
    }

    #[test]
    fn test_shr() {
        // Shifting {3} right by 2 gives {1}.
        assert_eq!(
            CandidateSet::from_value(3) >> 2,
            CandidateSet::from_value(1)
        );
        // Shifting {1} right by 1 gives EMPTY (shifted out).
        assert_eq!(CandidateSet::from_value(1) >> 1, CandidateSet::EMPTY);
        // Shifting EMPTY is still EMPTY.
        assert_eq!(CandidateSet::EMPTY >> 3, CandidateSet::EMPTY);
    }

    #[test]
    fn test_shl_assign() {
        let mut a = CandidateSet::from_value(1);
        a <<= 4;
        assert_eq!(a, CandidateSet::from_value(5));
    }

    #[test]
    fn test_shr_assign() {
        let mut a = CandidateSet::from_value(5);
        a >>= 4;
        assert_eq!(a, CandidateSet::from_value(1));
    }

    // --- Iterator --------------------------------------------------------

    #[test]
    fn test_iter() {
        let cs = CandidateSet::from_values([1, 4, 9]);
        let values: Vec<u8> = cs.iter().map(|c| c.value()).collect();
        assert_eq!(values, vec![1, 4, 9]);
    }

    #[test]
    fn test_iter_empty() {
        assert_eq!(CandidateSet::EMPTY.iter().count(), 0);
    }

    #[test]
    fn test_iter_all() {
        let values: Vec<u8> = CandidateSet::all(9).iter().map(|c| c.value()).collect();
        assert_eq!(values, vec![1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }

    #[test]
    fn test_iter_exact_size() {
        let cs = CandidateSet::from_values([2, 5, 8]);
        let iter = cs.iter();
        assert_eq!(iter.len(), 3);
    }

    #[test]
    fn test_to_values() {
        assert_eq!(
            CandidateSet::from_values([1, 3, 9]).to_values(),
            vec![1, 3, 9]
        );
        assert_eq!(CandidateSet::EMPTY.to_values(), Vec::<u8>::new());
    }

    // --- Debug -----------------------------------------------------------

    #[test]
    fn test_debug() {
        assert_eq!(format!("{:?}", CandidateSet::EMPTY), "CandidateSet({})");
        assert_eq!(
            format!("{:?}", CandidateSet::from_values([1, 5, 9])),
            "CandidateSet({1, 5, 9})"
        );
    }
}
