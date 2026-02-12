use std::sync::OnceLock;

use crate::lookup_tables::LookupTables;
use crate::util::NUM_VALUES;

/// Number of possible bitmask combinations for NUM_VALUES bits.
const COMBINATIONS: usize = 1 << NUM_VALUES;

/// Maximum possible cage sum: 1+2+...+9 = 45.
pub const MAX_CAGE_SUM: usize = NUM_VALUES * (NUM_VALUES + 1) / 2;

/// Pre-computed data shared between Sum handler instances.
///
/// Mirrors JS `SumData` from sum_handler.js.
///
/// Lazy-initialized via `OnceLock` — thread-safe, zero overhead after init.
pub struct SumData {
    /// Killer cage sum lookup: `killer_cage_sums[num_cells][target_sum]`
    /// gives a list of bitmasks, each representing a set of distinct values
    /// that sum to `target_sum` using exactly `num_cells` values.
    ///
    /// Example: `killer_cage_sums[2][7]` = all pairs of distinct values
    /// summing to 7: {1,6}, {2,5}, {3,4}.
    pub killer_cage_sums: Vec<Vec<Vec<u16>>>,

    /// Pairwise sums for 2 bitmasks (assumes distinct values).
    ///
    /// For cell candidate sets `a` and `b`:
    ///   `pairwise_sums[(a << NUM_VALUES) | b]` = (result >> 2)
    ///
    /// The result bitmask has bit `s-1` set if there exist distinct values
    /// `va ∈ a` and `vb ∈ b` with `va + vb = s`.
    ///
    /// Shifted right by 2 to fit in u16 (minimum sum of distinct pair is 3).
    pub pairwise_sums: Vec<u16>,

    /// Double sums: `doubles[v]` has bit `(2*k - 1)` set for each value
    /// `k` present in bitmask `v`. Used when two cells in a 3-cell sum
    /// can repeat (different exclusion groups).
    pub doubles: Vec<u32>,
}

static SUM_DATA: OnceLock<SumData> = OnceLock::new();

impl SumData {
    /// Get the singleton SumData instance.
    pub fn get() -> &'static SumData {
        SUM_DATA.get_or_init(Self::build)
    }

    fn build() -> SumData {
        let tables = LookupTables::get();

        let killer_cage_sums = Self::build_killer_cage_sums(tables);
        let pairwise_sums = Self::build_pairwise_sums();
        let doubles = Self::build_doubles();

        SumData {
            killer_cage_sums,
            pairwise_sums,
            doubles,
        }
    }

    /// Build the killer cage sum table.
    ///
    /// `killer_cage_sums[n][s]` = list of bitmasks with exactly `n` bits
    /// set whose values sum to `s`.
    fn build_killer_cage_sums(tables: &LookupTables) -> Vec<Vec<Vec<u16>>> {
        let mut table: Vec<Vec<Vec<u16>>> = Vec::with_capacity(NUM_VALUES + 1);
        for _ in 0..=NUM_VALUES {
            let mut totals: Vec<Vec<u16>> = Vec::with_capacity(MAX_CAGE_SUM + 1);
            for _ in 0..=MAX_CAGE_SUM {
                totals.push(Vec::new());
            }
            table.push(totals);
        }

        for i in 0..COMBINATIONS {
            let n = (i as u16).count_ones() as usize;
            let s = tables.sum[i] as usize;
            table[n][s].push(i as u16);
        }

        table
    }

    /// Build pairwise sums table.
    ///
    /// For all pairs of bitmasks (a, b), compute all possible sums of
    /// one value from a and one distinct value from b.
    /// Result is shifted right by 2 to fit in u16.
    fn build_pairwise_sums() -> Vec<u16> {
        let size = COMBINATIONS * COMBINATIONS;
        let mut table = vec![0u16; size];

        for i in 0..COMBINATIONS {
            for j in i..COMBINATIONS {
                let mut result: u16 = 0;
                for k in 1..=NUM_VALUES {
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
                table[(i << NUM_VALUES) | j] = result;
                table[(j << NUM_VALUES) | i] = result;
            }
        }

        table
    }

    /// Build doubles table.
    ///
    /// For each bitmask, set bit `(2*k - 1)` for each value k present.
    /// This represents the sum `k + k` for repeated values.
    fn build_doubles() -> Vec<u32> {
        let mut table = vec![0u32; COMBINATIONS];

        for j in 0..COMBINATIONS {
            let mut result: u32 = 0;
            for k in 1..=NUM_VALUES {
                let k_in_j = (j >> (k - 1)) & 1;
                if k_in_j != 0 {
                    result |= 1u32 << (2 * k - 1);
                }
            }
            table[j] = result;
        }

        table
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::util::{value_bit, ALL_VALUES};

    #[test]
    fn test_killer_cage_sums_basic() {
        let sd = SumData::get();
        // 1-cell cage with sum=5: only option is {5} = bit 4.
        let options = &sd.killer_cage_sums[1][5];
        assert_eq!(options.len(), 1);
        assert_eq!(options[0], value_bit(5));
    }

    #[test]
    fn test_killer_cage_sums_pairs() {
        let sd = SumData::get();
        // 2-cell cage with sum=3: {1,2}.
        let options = &sd.killer_cage_sums[2][3];
        assert_eq!(options.len(), 1);
        assert_eq!(options[0], value_bit(1) | value_bit(2));
    }

    #[test]
    fn test_killer_cage_sums_multiple() {
        let sd = SumData::get();
        // 2-cell cage with sum=7: {1,6}, {2,5}, {3,4}.
        let options = &sd.killer_cage_sums[2][7];
        assert_eq!(options.len(), 3);
    }

    #[test]
    fn test_killer_cage_sums_9cell_45() {
        let sd = SumData::get();
        // 9-cell cage with sum=45: only {1,2,...,9}.
        let options = &sd.killer_cage_sums[9][45];
        assert_eq!(options.len(), 1);
        assert_eq!(options[0], ALL_VALUES);
    }

    #[test]
    fn test_pairwise_sums() {
        let sd = SumData::get();
        // a = {1}, b = {2}: only possible sum is 3.
        // pairwise_sums[(a << 9) | b] >> 0, then result << 2 to get actual sums.
        let a = value_bit(1) as usize; // 0b1
        let b = value_bit(2) as usize; // 0b10
        let result = sd.pairwise_sums[(a << NUM_VALUES) | b];
        // Sum 3 → bit (3-1) = bit 2 in the full result. After >> 2, bit 0.
        assert_ne!(result, 0);
        // Check that bit for sum=3 is set: result << 2 has bit 2 set.
        let full = (result as u32) << 2;
        assert!(full & (1 << (3 - 1)) != 0);
    }

    #[test]
    fn test_pairwise_sums_distinct() {
        let sd = SumData::get();
        // a = {3}, b = {3}: should produce NO valid sums (values must be distinct).
        let a = value_bit(3) as usize;
        let result = sd.pairwise_sums[(a << NUM_VALUES) | a];
        // Sum 6 with k=3 removed: bit (2*3-1) = bit 5 cleared.
        let full = (result as u32) << 2;
        assert!(full & (1 << (6 - 1)) == 0);
    }

    #[test]
    fn test_doubles() {
        let sd = SumData::get();
        // doubles for {3} = bit (2*3 - 1) = bit 5.
        let mask = value_bit(3) as usize;
        assert!(sd.doubles[mask] & (1 << 5) != 0);
        // doubles for {1,2} = bit 1 + bit 3.
        let mask12 = (value_bit(1) | value_bit(2)) as usize;
        assert!(sd.doubles[mask12] & (1 << 1) != 0); // 1+1=2, bit 1
        assert!(sd.doubles[mask12] & (1 << 3) != 0); // 2+2=4, bit 3
    }
}
