//! NFA (Non-deterministic Finite Automaton) pipeline.
//!
//! This module provides:
//! - [`Nfa`] — core NFA data structure with epsilon closure, dead-state
//!   removal, and simulation-based reduction.
//! - [`CompressedNfa`] — solver-internal format with packed u32 transition
//!   entries for fast constraint propagation.
//! - [`NfaSerializer`] — binary serialization/deserialization (Base64-encoded
//!   bitstream, PLAIN and PACKED formats).
//! - [`RegexParser`] / [`regex_to_nfa`] — regex pattern → NFA compilation
//!   via Thompson's construction.
//! - [`javascript_spec_to_nfa`] — user-defined JS state-machine → NFA
//!   conversion (used by the NFA constraint type).
//!
//! Mirrors JS `nfa_builder.js` and `nfa_handler.js::compressNFA`.

mod compress;
mod nfa_core;
mod regex;
mod serializer;

pub use compress::{compress_nfa, CompressedNfa};
pub use nfa_core::Nfa;
pub use regex::regex_to_nfa;
pub use serializer::NfaSerializer;
