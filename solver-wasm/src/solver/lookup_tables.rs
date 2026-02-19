use std::sync::OnceLock;

/// Pre-computed lookup tables for bitmask operations, parameterized by
/// `num_values`.
///
/// Matches the JS `LookupTables` class. Tables are indexed by the bitmask
/// value, so `table[mask]` gives the result for that candidate set.
///
/// Obtained via `LookupTables::get(num_values)` which returns a cached
/// `&'static` reference (lazy-initialized, thread-safe).
pub struct LookupTables {
    /// `1 << num_values` — total number of bitmask combinations.
    pub combinations: usize,

    /// Sum of all values in a bitmask.
    /// `sum[0b1010] = 2 + 4 = 6`
    pub sum: Vec<u8>,

    /// Packed range info for Sum handler aggregation.
    /// Layout: `[isFixed:8 | fixedValue:8 | min:8 | max:8]`
    ///
    /// Designed to be summed across cells so aggregate stats can be computed
    /// in a single pass:
    /// - Sum of isFixed → number of fixed cells
    /// - Sum of fixedValue → sum of fixed cell values
    /// - Sum of min → aggregate minimum
    /// - Sum of max → aggregate maximum
    pub range_info: Vec<u32>,

    /// Reverse mapping: if value `v` maps to bit `i`, reverse maps bit `i`
    /// to value `num_values + 1 - v`. Used for complement calculations.
    pub reverse: Vec<u16>,
}

/// One slot per possible num_values (0..=16). Index 0 is unused.
static TABLES: [OnceLock<LookupTables>; 17] = [
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
    OnceLock::new(),
];

impl LookupTables {
    /// Get (or lazily create) lookup tables for `num_values`.
    ///
    /// Matches JS `LookupTables.get(numValues)`.
    pub fn get(num_values: u8) -> &'static LookupTables {
        debug_assert!(
            num_values >= 1 && num_values <= 16,
            "num_values must be 1..=16, got {}",
            num_values
        );
        TABLES[num_values as usize].get_or_init(|| Self::build(num_values))
    }

    fn build(num_values: u8) -> LookupTables {
        let nv = num_values as usize;
        let combinations = 1usize << nv;

        let mut sum = vec![0u8; combinations];
        let mut range_info = vec![0u32; combinations];
        let mut reverse = vec![0u16; combinations];

        // Build sum table.
        for i in 1..combinations {
            // Sum = lowest bit's value + sum of the rest.
            let lowest = i & i.wrapping_neg();
            let value = to_value(lowest as u16);
            sum[i] = sum[i & (i - 1)] + value;
        }

        // Build range_info table.
        // Layout: [isFixed:8 | fixedValue:8 | min:8 | max:8]
        for (i, slot) in range_info.iter_mut().enumerate().skip(1) {
            let mask = i as u16;
            let max_val = max_value(mask);
            let min_val = min_value(mask);
            let is_single = (mask & (mask - 1)) == 0;
            let fixed_value = if is_single { to_value(mask) } else { 0 };
            let is_fixed: u8 = if is_single { 1 } else { 0 };

            *slot = ((is_fixed as u32) << 24)
                | ((fixed_value as u32) << 16)
                | ((min_val as u32) << 8)
                | (max_val as u32);
        }
        // If there are no values, set a high value for isFixed to indicate
        // the result is invalid (detectable after summing).
        range_info[0] = (num_values as u32) << 24;

        // Build reverse table.
        // First: base cases for single-bit values.
        for i in 1..=nv {
            let from_bit = 1u16 << (i - 1);
            let to_bit = 1u16 << (nv - i);
            reverse[from_bit as usize] = to_bit;
        }
        // Then: OR together for multi-bit masks.
        for i in 1..combinations {
            reverse[i] = reverse[i & (i - 1)] | reverse[i & i.wrapping_neg()];
        }

        LookupTables {
            combinations,
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
    use crate::candidate_set::CandidateSet;

    #[test]
    fn test_sum_table() {
        let t = LookupTables::get(9);
        assert_eq!(t.sum[0], 0);
        assert_eq!(t.sum[0b1], 1);
        assert_eq!(t.sum[0b11], 3);
        assert_eq!(t.sum[usize::from(CandidateSet::all(9))], 45);
        assert_eq!(t.sum[0b1010], 6);
    }

    #[test]
    fn test_range_info_single() {
        let t = LookupTables::get(9);
        let mask = usize::from(CandidateSet::from_value(5));
        let ri = t.range_info[mask];
        assert_eq!(ri >> 24, 1);
        assert_eq!((ri >> 16) & 0xFF, 5);
        assert_eq!((ri >> 8) & 0xFF, 5);
        assert_eq!(ri & 0xFF, 5);
    }

    #[test]
    fn test_range_info_multi() {
        let t = LookupTables::get(9);
        let mask = usize::from(CandidateSet::from_value(3) | CandidateSet::from_value(7));
        let ri = t.range_info[mask];
        assert_eq!(ri >> 24, 0);
        assert_eq!((ri >> 16) & 0xFF, 0);
        assert_eq!((ri >> 8) & 0xFF, 3);
        assert_eq!(ri & 0xFF, 7);
    }

    #[test]
    fn test_range_info_empty() {
        let t = LookupTables::get(9);
        let ri = t.range_info[0];
        assert_eq!(ri >> 24, 9);
    }

    #[test]
    fn test_range_info_sum() {
        let t = LookupTables::get(9);
        let ri3 = t.range_info[usize::from(CandidateSet::from_value(3))];
        let ri7 = t.range_info[usize::from(CandidateSet::from_value(7))];
        let sum = ri3.wrapping_add(ri7);
        assert_eq!(sum >> 24, 2);
        assert_eq!((sum >> 16) & 0xFF, 10);
        assert_eq!((sum >> 8) & 0xFF, 10);
        assert_eq!(sum & 0xFF, 10);
    }

    #[test]
    fn test_reverse_table() {
        let t = LookupTables::get(9);
        assert_eq!(
            t.reverse[usize::from(CandidateSet::from_value(1))],
            CandidateSet::from_value(9).raw()
        );
        assert_eq!(
            t.reverse[usize::from(CandidateSet::from_value(9))],
            CandidateSet::from_value(1).raw()
        );
        assert_eq!(
            t.reverse[usize::from(CandidateSet::from_value(5))],
            CandidateSet::from_value(5).raw()
        );
        let mask_12 = usize::from(CandidateSet::from_value(1) | CandidateSet::from_value(2));
        assert_eq!(
            t.reverse[mask_12],
            (CandidateSet::from_value(8) | CandidateSet::from_value(9)).raw()
        );
    }

    #[test]
    fn test_reverse_all_values() {
        let t = LookupTables::get(9);
        assert_eq!(
            t.reverse[usize::from(CandidateSet::all(9))],
            CandidateSet::all(9).raw()
        );
    }

    #[test]
    fn test_different_num_values() {
        let t4 = LookupTables::get(4);
        assert_eq!(t4.combinations, 16);
        assert_eq!(t4.sum[0b1111], 10); // 1+2+3+4

        let t16 = LookupTables::get(16);
        assert_eq!(t16.combinations, 65536);
    }
}
