use std::sync::OnceLock;

use crate::candidate_set::CandidateSet;
use crate::solver::lookup_tables::LookupTables;

/// Pre-computed data shared between Sum handler instances, parameterized by
/// `num_values`.
///
/// Mirrors JS `SumData` from sum_handler.js.
///
/// Obtained via `SumData::get(num_values)` which returns a cached
/// `&'static` reference (lazy-initialized, thread-safe).
pub struct SumData {
    /// Maximum possible cage sum: 1+2+...+num_values.
    pub max_cage_sum: usize,

    /// Killer cage sum lookup: `killer_cage_sums[num_cells][target_sum]`
    /// gives a list of bitmasks, each representing a set of distinct values
    /// that sum to `target_sum` using exactly `num_cells` values.
    ///
    /// Example: `killer_cage_sums[2][7]` = all pairs of distinct values
    /// summing to 7: {1,6}, {2,5}, {3,4}.
    pub killer_cage_sums: Vec<Vec<Vec<CandidateSet>>>,

    /// Pairwise sums for 2 bitmasks (assumes distinct values).
    ///
    /// For cell candidate sets `a` and `b`:
    ///   `pairwise_sums[(a << num_values) | b]` = (result >> 2)
    ///
    /// Only available when `num_values <= 9` (table would be too large
    /// otherwise — matches JS behavior where `pairwiseSums` is `undefined`
    /// for larger grids).
    pub pairwise_sums: Option<Vec<u16>>,

    /// Double sums: `doubles[v]` has bit `(2*k - 1)` set for each value
    /// `k` present in bitmask `v`. Used when two cells in a 3-cell sum
    /// can repeat (different exclusion groups).
    pub doubles: Vec<u32>,
}

/// One slot per possible num_values (0..=16). Index 0 is unused.
static SUM_DATA: [OnceLock<SumData>; 17] = [
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

impl SumData {
    /// Get (or lazily create) SumData for `num_values`.
    ///
    /// Matches JS `SumData.get(numValues)`.
    pub fn get(num_values: u8) -> &'static SumData {
        debug_assert!(
            num_values >= 1 && num_values <= 16,
            "num_values must be 1..=16, got {}",
            num_values
        );
        SUM_DATA[num_values as usize].get_or_init(|| Self::build(num_values))
    }

    fn build(num_values: u8) -> SumData {
        let nv = num_values as usize;
        let tables = LookupTables::get(num_values);
        let combinations = tables.combinations;
        let max_cage_sum = nv * (nv + 1) / 2;

        let killer_cage_sums = Self::build_killer_cage_sums(tables, nv, max_cage_sum);

        // pairwise_sums is only built for num_values <= 9.
        // For larger grids, the table would be too large (O(4^n)).
        // Matches JS: pairwiseSums is undefined when numValues > SHAPE_9x9.numValues.
        let pairwise_sums = if nv <= 9 {
            Some(Self::build_pairwise_sums(nv, combinations))
        } else {
            None
        };

        let doubles = Self::build_doubles(nv, combinations);

        SumData {
            max_cage_sum,
            killer_cage_sums,
            pairwise_sums,
            doubles,
        }
    }

    /// Build the killer cage sum table.
    ///
    /// `killer_cage_sums[n][s]` = list of bitmasks with exactly `n` bits
    /// set whose values sum to `s`.
    fn build_killer_cage_sums(
        tables: &LookupTables,
        num_values: usize,
        max_cage_sum: usize,
    ) -> Vec<Vec<Vec<CandidateSet>>> {
        let combinations = tables.combinations;
        let mut table: Vec<Vec<Vec<CandidateSet>>> = Vec::with_capacity(num_values + 1);
        for _ in 0..=num_values {
            let mut totals: Vec<Vec<CandidateSet>> = Vec::with_capacity(max_cage_sum + 1);
            for _ in 0..=max_cage_sum {
                totals.push(Vec::new());
            }
            table.push(totals);
        }

        for i in 0..combinations {
            let n = (i as u16).count_ones() as usize;
            let s = tables.sum[i] as usize;
            table[n][s].push(CandidateSet::from_raw(i as u16));
        }

        table
    }

    /// Build pairwise sums table.
    ///
    /// For all pairs of bitmasks (a, b), compute all possible sums of
    /// one value from a and one distinct value from b.
    /// Result is shifted right by 2 to fit in u16.
    fn build_pairwise_sums(num_values: usize, combinations: usize) -> Vec<u16> {
        let size = combinations * combinations;
        let mut table = vec![0u16; size];

        for i in 0..combinations {
            for j in i..combinations {
                let mut result: u16 = 0;
                for k in 1..=num_values {
                    // Check if j contains value k.
                    let k_in_j = (j >> (k - 1)) & 1;
                    if k_in_j != 0 {
                        // Add k to all values in i.
                        let mut s = (i as u32) << k;
                        // Remove 2*k (value k used twice → not distinct).
                        s &= !(1u32 << (2 * k - 1));
                        // Store s-2 (shift right by 2) so it fits in u16.
                        s >>= 2;
                        result |= s as u16;
                    }
                }
                table[(i << num_values) | j] = result;
                table[(j << num_values) | i] = result;
            }
        }

        table
    }

    /// Build doubles table.
    ///
    /// For each bitmask, set bit `(2*k - 1)` for each value k present.
    /// This represents the sum `k + k` for repeated values.
    fn build_doubles(num_values: usize, combinations: usize) -> Vec<u32> {
        let mut table = vec![0u32; combinations];

        for (j, slot) in table.iter_mut().enumerate() {
            let mut result: u32 = 0;
            for k in 1..=num_values {
                let k_in_j = (j >> (k - 1)) & 1;
                if k_in_j != 0 {
                    result |= 1u32 << (2 * k - 1);
                }
            }
            *slot = result;
        }

        table
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::candidate_set::CandidateSet;

    #[test]
    fn test_killer_cage_sums_basic() {
        let sd = SumData::get(9);
        let options = &sd.killer_cage_sums[1][5];
        assert_eq!(options.len(), 1);
        assert_eq!(options[0], CandidateSet::from_value(5));
    }

    #[test]
    fn test_killer_cage_sums_pairs() {
        let sd = SumData::get(9);
        let options = &sd.killer_cage_sums[2][3];
        assert_eq!(options.len(), 1);
        assert_eq!(
            options[0],
            CandidateSet::from_value(1) | CandidateSet::from_value(2)
        );
    }

    #[test]
    fn test_killer_cage_sums_multiple() {
        let sd = SumData::get(9);
        let options = &sd.killer_cage_sums[2][7];
        assert_eq!(options.len(), 3);
    }

    #[test]
    fn test_killer_cage_sums_9cell_45() {
        let sd = SumData::get(9);
        let options = &sd.killer_cage_sums[9][45];
        assert_eq!(options.len(), 1);
        assert_eq!(options[0], CandidateSet::all(9));
    }

    #[test]
    fn test_pairwise_sums() {
        let sd = SumData::get(9);
        let nv = 9;
        let ps = sd.pairwise_sums.as_ref().unwrap();
        let a = usize::from(CandidateSet::from_value(1));
        let b = usize::from(CandidateSet::from_value(2));
        let result = ps[(a << nv) | b];
        assert_ne!(result, 0);
        let full = (result as u32) << 2;
        assert!(full & (1 << (3 - 1)) != 0);
    }

    #[test]
    fn test_pairwise_sums_distinct() {
        let sd = SumData::get(9);
        let nv = 9;
        let ps = sd.pairwise_sums.as_ref().unwrap();
        let a = usize::from(CandidateSet::from_value(3));
        let result = ps[(a << nv) | a];
        let full = (result as u32) << 2;
        assert!(full & (1 << (6 - 1)) == 0);
    }

    #[test]
    fn test_pairwise_sums_none_for_large() {
        let sd = SumData::get(10);
        assert!(sd.pairwise_sums.is_none());
    }

    #[test]
    fn test_doubles() {
        let sd = SumData::get(9);
        let mask = usize::from(CandidateSet::from_value(3));
        assert!(sd.doubles[mask] & (1 << 5) != 0);
        let mask12 = usize::from(CandidateSet::from_value(1) | CandidateSet::from_value(2));
        assert!(sd.doubles[mask12] & (1 << 1) != 0);
        assert!(sd.doubles[mask12] & (1 << 3) != 0);
    }

    #[test]
    fn test_different_num_values() {
        let sd4 = SumData::get(4);
        assert_eq!(sd4.max_cage_sum, 10); // 1+2+3+4
                                          // 4-cell cage summing to 10 should have exactly 1 option (1234)
        assert_eq!(sd4.killer_cage_sums[4][10].len(), 1);
    }
}
