use std::sync::OnceLock;

use crate::util::NUM_VALUES;

/// Number of possible bitmask combinations for NUM_VALUES bits.
const COMBINATIONS: usize = 1 << NUM_VALUES;

/// Pre-computed lookup tables for bitmask operations.
///
/// Matches the JS `LookupTables` class. Tables are indexed by the bitmask
/// value, so `table[mask]` gives the result for that candidate set.
///
/// Lazy-initialized via `OnceLock` — thread-safe, zero overhead after init.
pub struct LookupTables {
    /// Sum of all values in a bitmask.
    /// `sum[0b1010] = 2 + 4 = 6`
    pub sum: [u8; COMBINATIONS],

    /// Packed range info for Sum handler aggregation.
    /// Layout: `[isFixed:8 | fixedValue:8 | min:8 | max:8]`
    ///
    /// Designed to be summed across cells so aggregate stats can be computed
    /// in a single pass:
    /// - Sum of isFixed → number of fixed cells
    /// - Sum of fixedValue → sum of fixed cell values
    /// - Sum of min → aggregate minimum
    /// - Sum of max → aggregate maximum
    pub range_info: [u32; COMBINATIONS],

    /// Reverse mapping: if value `v` maps to bit `i`, reverse maps bit `i`
    /// to value `NUM_VALUES + 1 - v`. Used for complement calculations.
    pub reverse: [u16; COMBINATIONS],
}

static TABLES: OnceLock<LookupTables> = OnceLock::new();

impl LookupTables {
    /// Get the singleton lookup tables instance.
    pub fn get() -> &'static LookupTables {
        TABLES.get_or_init(Self::build)
    }

    fn build() -> LookupTables {
        let mut sum = [0u8; COMBINATIONS];
        let mut range_info = [0u32; COMBINATIONS];
        let mut reverse = [0u16; COMBINATIONS];

        // Build sum table.
        for i in 1..COMBINATIONS {
            // Sum = lowest bit's value + sum of the rest.
            let lowest = i & i.wrapping_neg();
            let value = to_value(lowest as u16);
            sum[i] = sum[i & (i - 1)] + value;
        }

        // Build range_info table.
        // Layout: [isFixed:8 | fixedValue:8 | min:8 | max:8]
        for i in 1..COMBINATIONS {
            let mask = i as u16;
            let max_val = max_value(mask);
            let min_val = min_value(mask);
            let is_single = (mask & (mask - 1)) == 0;
            let fixed_value = if is_single { to_value(mask) } else { 0 };
            let is_fixed: u8 = if is_single { 1 } else { 0 };

            range_info[i] = ((is_fixed as u32) << 24)
                | ((fixed_value as u32) << 16)
                | ((min_val as u32) << 8)
                | (max_val as u32);
        }
        // If there are no values, set a high value for isFixed to indicate
        // the result is invalid (detectable after summing).
        range_info[0] = (NUM_VALUES as u32) << 24;

        // Build reverse table.
        // First: base cases for single-bit values.
        for i in 1..=NUM_VALUES {
            let from_bit = 1u16 << (i - 1);
            let to_bit = 1u16 << (NUM_VALUES - i);
            reverse[from_bit as usize] = to_bit;
        }
        // Then: OR together for multi-bit masks.
        for i in 1..COMBINATIONS {
            reverse[i] = reverse[i & (i - 1)] | reverse[i & i.wrapping_neg()];
        }

        LookupTables {
            sum,
            range_info,
            reverse,
        }
    }
}

/// Convert a single-bit bitmask to its 1-indexed value.
/// Equivalent to JS `LookupTables.toValue(v)`.
#[inline(always)]
fn to_value(v: u16) -> u8 {
    debug_assert!(v != 0);
    (16 - v.leading_zeros()) as u8
}

/// Get the maximum value (1-indexed) from a candidate bitmask.
#[inline(always)]
fn max_value(v: u16) -> u8 {
    to_value(v)
}

/// Get the minimum value (1-indexed) from a candidate bitmask.
#[inline(always)]
fn min_value(v: u16) -> u8 {
    debug_assert!(v != 0);
    to_value(v & v.wrapping_neg())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::{value_bit, ALL_VALUES};

    #[test]
    fn test_sum_table() {
        let t = LookupTables::get();
        assert_eq!(t.sum[0], 0);
        // {1} = bit 0 → sum = 1
        assert_eq!(t.sum[0b1], 1);
        // {1,2} = bits 0,1 → sum = 3
        assert_eq!(t.sum[0b11], 3);
        // {1,2,3,...,9} → sum = 45
        assert_eq!(t.sum[ALL_VALUES as usize], 45);
        // {2,4} = bits 1,3 → sum = 6
        assert_eq!(t.sum[0b1010], 6);
    }

    #[test]
    fn test_range_info_single() {
        let t = LookupTables::get();
        // Single value 5: isFixed=1, fixed=5, min=5, max=5
        let mask = value_bit(5) as usize;
        let ri = t.range_info[mask];
        assert_eq!(ri >> 24, 1); // isFixed
        assert_eq!((ri >> 16) & 0xFF, 5); // fixedValue
        assert_eq!((ri >> 8) & 0xFF, 5); // min
        assert_eq!(ri & 0xFF, 5); // max
    }

    #[test]
    fn test_range_info_multi() {
        let t = LookupTables::get();
        // {3, 7} = bits 2, 6 → isFixed=0, fixed=0, min=3, max=7
        let mask = (value_bit(3) | value_bit(7)) as usize;
        let ri = t.range_info[mask];
        assert_eq!(ri >> 24, 0); // isFixed
        assert_eq!((ri >> 16) & 0xFF, 0); // fixedValue
        assert_eq!((ri >> 8) & 0xFF, 3); // min
        assert_eq!(ri & 0xFF, 7); // max
    }

    #[test]
    fn test_range_info_empty() {
        let t = LookupTables::get();
        // Empty: isFixed = NUM_VALUES (sentinel)
        let ri = t.range_info[0];
        assert_eq!(ri >> 24, NUM_VALUES as u32);
    }

    #[test]
    fn test_range_info_sum() {
        let t = LookupTables::get();
        // Summing range_info for two fixed cells (3 and 7) should give:
        // isFixed=2, fixed=10, min=10, max=10
        let ri3 = t.range_info[value_bit(3) as usize];
        let ri7 = t.range_info[value_bit(7) as usize];
        let sum = ri3.wrapping_add(ri7);
        assert_eq!(sum >> 24, 2);
        assert_eq!((sum >> 16) & 0xFF, 10);
        assert_eq!((sum >> 8) & 0xFF, 10);
        assert_eq!(sum & 0xFF, 10);
    }

    #[test]
    fn test_reverse_table() {
        let t = LookupTables::get();
        // reverse(1) = 9, reverse(9) = 1
        assert_eq!(t.reverse[value_bit(1) as usize], value_bit(9));
        assert_eq!(t.reverse[value_bit(9) as usize], value_bit(1));
        // reverse(5) = 5 (middle value)
        assert_eq!(t.reverse[value_bit(5) as usize], value_bit(5));
        // reverse({1,2}) = {8,9}
        let mask_12 = (value_bit(1) | value_bit(2)) as usize;
        assert_eq!(t.reverse[mask_12], value_bit(8) | value_bit(9));
    }

    #[test]
    fn test_reverse_all_values() {
        let t = LookupTables::get();
        // reverse(ALL_VALUES) = ALL_VALUES
        assert_eq!(t.reverse[ALL_VALUES as usize], ALL_VALUES);
    }
}
