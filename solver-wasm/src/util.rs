/// Bitmask helpers for candidate sets.
///
/// Each cell's candidates are stored as a `u16` bitmask where bit `i`
/// (0-indexed) represents value `i + 1`.
///
/// Example: candidates {1, 3, 9} = 0b1_0000_0101 = 0x105

/// Number of values in a standard 9×9 grid.
pub const NUM_VALUES: usize = 9;

/// Number of cells in a standard 9×9 grid.
pub const NUM_CELLS: usize = NUM_VALUES * NUM_VALUES;

/// Bitmask with all values set: bits 0..8 = values 1..9.
pub const ALL_VALUES: u16 = (1 << NUM_VALUES) - 1;

/// Convert a value (1-indexed) to its bitmask representation.
#[inline(always)]
pub fn value_bit(value: u16) -> u16 {
    debug_assert!(value >= 1 && value <= NUM_VALUES as u16);
    1 << (value - 1)
}

/// Convert a single-bit bitmask to its value (1-indexed).
/// The input must have exactly one bit set.
#[inline(always)]
pub fn bit_value(bit: u16) -> u16 {
    debug_assert!(bit.count_ones() == 1);
    bit.trailing_zeros() as u16 + 1
}

/// Check if a bitmask represents a single candidate (exactly one bit set).
#[inline(always)]
pub fn is_single(mask: u16) -> bool {
    mask != 0 && (mask & (mask - 1)) == 0
}

/// Count the number of candidates in a bitmask.
#[inline(always)]
pub fn count_ones(mask: u16) -> u32 {
    mask.count_ones()
}

/// Get the minimum value (1-indexed) from a candidate bitmask.
/// The mask must be non-zero.
#[inline(always)]
pub fn min_value(mask: u16) -> u16 {
    debug_assert!(mask != 0);
    mask.trailing_zeros() as u16 + 1
}

/// Get the maximum value (1-indexed) from a candidate bitmask.
/// The mask must be non-zero.
#[inline(always)]
pub fn max_value(mask: u16) -> u16 {
    debug_assert!(mask != 0);
    (NUM_VALUES as u16) - (mask.leading_zeros() as u16 - (16 - NUM_VALUES as u16))
}

/// Get the lowest set bit (isolate the minimum candidate).
#[inline(always)]
pub fn lowest_bit(mask: u16) -> u16 {
    mask & mask.wrapping_neg()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_value_bit() {
        assert_eq!(value_bit(1), 0b1);
        assert_eq!(value_bit(5), 0b10000);
        assert_eq!(value_bit(9), 0b100000000);
    }

    #[test]
    fn test_bit_value() {
        assert_eq!(bit_value(0b1), 1);
        assert_eq!(bit_value(0b10000), 5);
        assert_eq!(bit_value(0b100000000), 9);
    }

    #[test]
    fn test_is_single() {
        assert!(is_single(0b1));
        assert!(is_single(0b100));
        assert!(!is_single(0b0));
        assert!(!is_single(0b101));
    }

    #[test]
    fn test_count_ones() {
        assert_eq!(count_ones(0), 0);
        assert_eq!(count_ones(ALL_VALUES), 9);
        assert_eq!(count_ones(0b10101), 3);
    }

    #[test]
    fn test_min_max_value() {
        assert_eq!(min_value(ALL_VALUES), 1);
        assert_eq!(max_value(ALL_VALUES), 9);
        assert_eq!(min_value(0b110), 2);
        assert_eq!(max_value(0b110), 3);
        assert_eq!(min_value(value_bit(7)), 7);
        assert_eq!(max_value(value_bit(7)), 7);
    }

    #[test]
    fn test_lowest_bit() {
        assert_eq!(lowest_bit(0b1010), 0b10);
        assert_eq!(lowest_bit(0b100), 0b100);
        assert_eq!(lowest_bit(ALL_VALUES), 0b1);
    }

    #[test]
    fn test_all_values() {
        assert_eq!(ALL_VALUES, 0x1FF);
        assert_eq!(count_ones(ALL_VALUES), 9);
    }
}
