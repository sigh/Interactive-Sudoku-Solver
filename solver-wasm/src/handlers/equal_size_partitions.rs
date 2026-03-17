//! EqualSizePartitions constraint handler.
//!
//! Enforces that cells are split equally between two disjoint value sets
//! (partitions). Exactly half the cells must take values from partition 1
//! and half from partition 2.
//!
//! Used in EqualityCage puzzles — two instances are created per cage:
//!   * even (partition 1) vs odd (partition 2) values
//!   * low (≤ N/2) vs high (≥ N/2+1) values
//!
//! Mirrors JS `EqualSizePartitions` from handlers.js (L3365–L3437).

use crate::api::types::CellIndex;
use crate::candidate_set::CandidateSet;
use crate::grid_shape::GridShape;
use crate::solver::cell_exclusions::CellExclusions;
use crate::solver::grid_state_allocator::GridStateAllocator;
use crate::solver::handler_accumulator::HandlerAccumulator;

use super::ConstraintHandler;

// ============================================================================
// EqualSizePartitions
// ============================================================================

pub struct EqualSizePartitions {
    cells: Vec<CellIndex>,
    /// Raw partition 1 values (external, before offset conversion).
    partition1: Vec<i32>,
    /// Raw partition 2 values (external, before offset conversion).
    partition2: Vec<i32>,
    /// Bitmask for partition 1 values (set during initialize).
    mask1: CandidateSet,
    /// Bitmask for partition 2 values (set during initialize).
    mask2: CandidateSet,
}

impl EqualSizePartitions {
    /// Create a new handler.
    ///
    /// `partition1` and `partition2` are slices of external values.
    pub fn new(cells: Vec<CellIndex>, partition1: &[i32], partition2: &[i32]) -> Self {
        EqualSizePartitions {
            cells,
            partition1: partition1.to_vec(),
            partition2: partition2.to_vec(),
            mask1: CandidateSet::EMPTY,
            mask2: CandidateSet::EMPTY,
        }
    }
}

impl ConstraintHandler for EqualSizePartitions {
    fn cells(&self) -> &[CellIndex] {
        &self.cells
    }

    fn name(&self) -> &'static str {
        "EqualSizePartitions"
    }

    fn initialize(
        &mut self,
        initial_grid: &mut [CandidateSet],
        _cell_exclusions: &CellExclusions,
        shape: GridShape,
        _state_allocator: &mut GridStateAllocator,
    ) -> bool {
        let offset = shape.value_offset;
        self.mask1 =
            CandidateSet::from_offset_values(self.partition1.iter().copied(), offset);
        self.mask2 =
            CandidateSet::from_offset_values(self.partition2.iter().copied(), offset);

        // Remove values that belong to neither partition.
        let combined = self.mask1 | self.mask2;
        for &cell in &self.cells {
            initial_grid[cell as usize] &= combined;
            if initial_grid[cell as usize].is_empty() {
                return false;
            }
        }
        true
    }

    fn enforce_consistency(
        &self,
        grid: &mut [CandidateSet],
        acc: &mut HandlerAccumulator,
    ) -> bool {
        let cells = &self.cells;
        let num_cells = cells.len();
        let mask1 = self.mask1;
        let mask2 = self.mask2;

        let mut partition1_count = 0usize;
        let mut partition2_count = 0usize;
        let mut both_count = 0usize;

        for i in 0..num_cells {
            let v = grid[cells[i] as usize];
            let in1 = v & mask1;
            let in2 = v & mask2;
            if !in1.is_empty() && !in2.is_empty() {
                both_count += 1;
            } else if !in1.is_empty() {
                partition1_count += 1;
            } else if !in2.is_empty() {
                partition2_count += 1;
            }
            // Cells with no valid partition value are ignored here; the
            // solver detects the resulting empty cell as a contradiction.
        }

        let target_count = num_cells / 2;

        // One partition already has more cells than allowed.
        if partition1_count > target_count || partition2_count > target_count {
            return false;
        }

        // No ambiguous cells — nothing more to do.
        if both_count == 0 {
            return true;
        }

        // If one partition is full, force all ambiguous cells into the other.
        if partition1_count == target_count || partition2_count == target_count {
            let (mask_to_keep, mask_to_remove) = if partition1_count == target_count {
                (mask2, mask1)
            } else {
                (mask1, mask2)
            };

            for i in 0..num_cells {
                let cell = cells[i] as usize;
                let v = grid[cell];
                // Only act on ambiguous cells (those that could go either way).
                if !(v & mask_to_keep).is_empty() && !(v & mask_to_remove).is_empty() {
                    grid[cell] = v & !mask_to_remove;
                    if grid[cell].is_empty() {
                        return false;
                    }
                    acc.add_for_cell(cells[i]);
                }
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::handlers::test_util::*;

    #[test]
    fn init_restricts_cells_to_partition_values() {
        // 4 cells, partition1=[1,2], partition2=[3,4]
        let (mut grid, shape) = make_grid(1, 4, None);
        let mut handler = EqualSizePartitions::new(
            vec![0, 1, 2, 3], &[1, 2], &[3, 4]);
        assert!(init(&mut handler, &mut grid, shape));
        // All cells should only have values 1-4.
        for i in 0..4 {
            assert_eq!(grid[i], vm(&[1, 2, 3, 4]));
        }
    }

    #[test]
    fn one_partition_full_forces_remaining() {
        // 4 cells → 2 per partition. Partition1=[1,2], Partition2=[3,4].
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let mut handler = EqualSizePartitions::new(
            vec![0, 1, 2, 3], &[1, 2], &[3, 4]);
        init(&mut handler, &mut grid, shape);

        // Cells 0,1 fixed to partition1 values.
        grid[0] = vm(&[1]);
        grid[1] = vm(&[2]);
        // Cells 2,3 still ambiguous.
        grid[2] = vm(&[1, 2, 3, 4]);
        grid[3] = vm(&[1, 2, 3, 4]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
        // Cells 2,3 should be forced to partition2 (only 3,4).
        assert_eq!(grid[2], vm(&[3, 4]));
        assert_eq!(grid[3], vm(&[3, 4]));
    }

    #[test]
    fn both_partitions_satisfied_no_op() {
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let mut handler = EqualSizePartitions::new(
            vec![0, 1, 2, 3], &[1, 2], &[3, 4]);
        init(&mut handler, &mut grid, shape);

        grid[0] = vm(&[1]);
        grid[1] = vm(&[2]);
        grid[2] = vm(&[3]);
        grid[3] = vm(&[4]);

        let mut a = acc();
        assert!(handler.enforce_consistency(&mut grid, &mut a));
    }

    #[test]
    fn fail_when_too_many_in_one_partition() {
        let (mut grid, shape) = make_grid(1, 4, Some(4));
        let mut handler = EqualSizePartitions::new(
            vec![0, 1, 2, 3], &[1, 2], &[3, 4]);
        init(&mut handler, &mut grid, shape);

        // 3 cells fixed to partition1 — exceeds target of 2.
        grid[0] = vm(&[1]);
        grid[1] = vm(&[2]);
        grid[2] = vm(&[1]);
        grid[3] = vm(&[3, 4]);

        let mut a = acc();
        assert!(!handler.enforce_consistency(&mut grid, &mut a));
    }
}
