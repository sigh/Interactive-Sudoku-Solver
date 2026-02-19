//! Handler utilities — shared functions and precomputed data used across
//! multiple constraint handlers.
//!
//! This module groups non-handler code that lives alongside the handlers:
//!
//! - [`handler_util`] — Static utility functions mirroring JS `HandlerUtil`.
//! - [`sum_data`] — Precomputed sum/combination tables for killer cages.

pub(crate) mod handler_util;
pub(crate) mod sum_data;
