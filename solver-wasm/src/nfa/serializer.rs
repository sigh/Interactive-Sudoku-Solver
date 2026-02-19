//! NFA binary serialization/deserialization.
//!
//! Mirrors JS `NFASerializer` from `nfa_builder.js`.
//! Uses a compact bitstream format with Base64 encoding.
//!
//! Two body formats:
//! - PLAIN: per-state transition count + (symbolIndex, target) pairs.
//! - PACKED: per-state symbol bitmask + one target per active symbol
//!   (only works when each (state, symbol) has at most one target).

use super::Nfa;

// ============================================================================
// Base64 codec (matching JS Base64Codec)
// ============================================================================

/// Standard Base64 alphabet (RFC 4648 §4).
#[cfg(test)]
const BASE64_CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn base64_decode_char(ch: u8) -> Option<u8> {
    match ch {
        b'A'..=b'Z' => Some(ch - b'A'),
        b'a'..=b'z' => Some(ch - b'a' + 26),
        b'0'..=b'9' => Some(ch - b'0' + 52),
        b'+' => Some(62),
        b'/' => Some(63),
        _ => None,
    }
}

/// Decode a Base64 string to bytes (no padding required).
fn base64_decode(input: &str) -> Vec<u8> {
    let bytes: Vec<u8> = input
        .bytes()
        .filter_map(base64_decode_char)
        .collect();

    let mut result = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let b3 = if chunk.len() > 3 { chunk[3] as u32 } else { 0 };
        let n = (b0 << 18) | (b1 << 12) | (b2 << 6) | b3;

        result.push((n >> 16) as u8);
        if chunk.len() > 2 {
            result.push((n >> 8) as u8);
        }
        if chunk.len() > 3 {
            result.push(n as u8);
        }
    }
    result
}

/// Encode bytes to Base64 string (no padding).
#[cfg(test)]
fn base64_encode(data: &[u8]) -> String {
    let mut result = String::with_capacity((data.len() * 4 + 2) / 3);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;

        result.push(BASE64_CHARS[(n >> 18) as usize & 63] as char);
        result.push(BASE64_CHARS[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            result.push(BASE64_CHARS[(n >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            result.push(BASE64_CHARS[n as usize & 63] as char);
        }
    }
    result
}

// ============================================================================
// BitReader / BitWriter
// ============================================================================

struct BitReader {
    bytes: Vec<u8>,
    bit_pos: usize,
}

impl BitReader {
    fn new(bytes: Vec<u8>) -> Self {
        Self { bytes, bit_pos: 0 }
    }

    fn read_bits(&mut self, count: usize) -> u32 {
        let mut value = 0u32;
        for i in 0..count {
            let byte_idx = self.bit_pos / 8;
            let bit_idx = self.bit_pos % 8;
            if byte_idx < self.bytes.len() {
                if (self.bytes[byte_idx] >> (7 - bit_idx)) & 1 != 0 {
                    value |= 1 << (count - 1 - i);
                }
            }
            self.bit_pos += 1;
        }
        value
    }

    fn remaining_bits(&self) -> usize {
        self.bytes.len() * 8 - self.bit_pos.min(self.bytes.len() * 8)
    }

    fn skip_padding(&mut self) {
        // Skip to the end — padding bits are just trailing zeros.
        self.bit_pos = self.bytes.len() * 8;
    }
}

#[cfg(test)]
struct BitWriter {
    bytes: Vec<u8>,
    bit_pos: usize,
}

#[cfg(test)]
impl BitWriter {
    fn new() -> Self {
        Self {
            bytes: Vec::new(),
            bit_pos: 0,
        }
    }

    fn write_bits(&mut self, value: u32, count: usize) {
        for i in 0..count {
            let byte_idx = self.bit_pos / 8;
            let bit_idx = self.bit_pos % 8;
            if byte_idx >= self.bytes.len() {
                self.bytes.push(0);
            }
            if (value >> (count - 1 - i)) & 1 != 0 {
                self.bytes[byte_idx] |= 1 << (7 - bit_idx);
            }
            self.bit_pos += 1;
        }
    }

    fn to_bytes(self) -> Vec<u8> {
        self.bytes
    }
}

// ============================================================================
// Format constants (matching JS NFASerializer)
// ============================================================================

const FORMAT_PLAIN: u32 = 0;
const FORMAT_PACKED: u32 = 1;
const HEADER_FORMAT_BITS: usize = 2;
const STATE_BITS_FIELD_BITS: usize = 4;
const SYMBOL_COUNT_FIELD_BITS: usize = 4;

/// Number of bits required to represent `n` (0 → 0, 1 → 1, 2–3 → 2, etc.).
fn required_bits(n: u32) -> usize {
    if n == 0 {
        return 0;
    }
    32 - n.leading_zeros() as usize
}

// ============================================================================
// NfaSerializer
// ============================================================================

/// NFA binary serializer/deserializer.
///
/// Mirrors JS `NFASerializer` from `nfa_builder.js`.
pub struct NfaSerializer;

impl NfaSerializer {
    /// Deserialize a Base64-encoded NFA string.
    pub fn deserialize(serialized: &str) -> Result<Nfa, String> {
        if serialized.is_empty() {
            let mut nfa = Nfa::new();
            nfa.seal();
            return Ok(nfa);
        }

        let bytes = base64_decode(serialized);
        if bytes.is_empty() {
            return Err("Serialized NFA is empty".to_string());
        }

        let mut reader = BitReader::new(bytes);

        // Read header.
        let format = reader.read_bits(HEADER_FORMAT_BITS);
        if format != FORMAT_PLAIN && format != FORMAT_PACKED {
            return Err("Serialized NFA uses an unknown format".to_string());
        }

        let state_bits = (reader.read_bits(STATE_BITS_FIELD_BITS) + 1) as usize;
        let symbol_count = (reader.read_bits(SYMBOL_COUNT_FIELD_BITS) + 1) as usize;
        let start_count = reader.read_bits(state_bits) as usize;
        let accept_count = reader.read_bits(state_bits) as usize;
        let start_is_accept = reader.read_bits(start_count);
        let transition_count_bits = if format == FORMAT_PLAIN {
            reader.read_bits(SYMBOL_COUNT_FIELD_BITS) as usize
        } else {
            0
        };

        let symbol_bits = required_bits(symbol_count.saturating_sub(1) as u32);

        let mut nfa = Nfa::new();

        // Read body.
        if format == FORMAT_PACKED {
            Self::read_packed_body(&mut nfa, &mut reader, symbol_count, state_bits);
        } else {
            Self::read_plain_body(
                &mut nfa,
                &mut reader,
                transition_count_bits,
                symbol_bits,
                state_bits,
            )?;
        }

        reader.skip_padding();

        // Set start and accept states.
        for i in 0..start_count {
            nfa.add_start_id(i);
            if (start_is_accept >> i) & 1 != 0 {
                nfa.add_accept_id(i);
            }
        }
        for i in 0..accept_count {
            nfa.add_accept_id(start_count + i);
        }

        nfa.seal();
        Ok(nfa)
    }

    /// Serialize an NFA to a Base64-encoded string.
    #[cfg(test)]
    pub fn serialize(nfa: &mut Nfa) -> String {
        if nfa.num_states() == 0 {
            return String::new();
        }

        Self::normalize_states(nfa);

        let num_states = nfa.num_states();
        let start_count = nfa.start_ids().len();

        // Build startIsAccept bitmask.
        let mut start_is_accept = 0u32;
        let mut accept_count = nfa.accept_ids().len();
        for i in 0..start_count {
            if nfa.is_accepting(i) {
                start_is_accept |= 1 << i;
                accept_count -= 1;
            }
        }

        let symbol_count = nfa.num_symbols().max(1);
        let state_bits = required_bits((num_states - 1) as u32).max(1);
        let symbol_bits = required_bits((symbol_count - 1) as u32);

        let (format, transition_count_bits) =
            Self::choose_format(nfa, symbol_count, symbol_bits, state_bits);

        let mut writer = BitWriter::new();

        // Header.
        writer.write_bits(format, HEADER_FORMAT_BITS);
        writer.write_bits((state_bits - 1) as u32, STATE_BITS_FIELD_BITS);
        writer.write_bits((symbol_count - 1) as u32, SYMBOL_COUNT_FIELD_BITS);
        writer.write_bits(start_count as u32, state_bits);
        writer.write_bits(accept_count as u32, state_bits);
        writer.write_bits(start_is_accept, start_count);
        if format == FORMAT_PLAIN {
            writer.write_bits(transition_count_bits as u32, SYMBOL_COUNT_FIELD_BITS);
        }

        // Body.
        if format == FORMAT_PACKED {
            Self::write_packed_body(&mut writer, nfa, symbol_count, state_bits);
        } else {
            Self::write_plain_body(&mut writer, nfa, transition_count_bits, symbol_bits, state_bits);
        }

        base64_encode(&writer.to_bytes())
    }

    // ================================================================
    // Read helpers
    // ================================================================

    fn read_plain_body(
        nfa: &mut Nfa,
        reader: &mut BitReader,
        transition_count_bits: usize,
        symbol_bits: usize,
        state_bits: usize,
    ) -> Result<(), String> {
        if transition_count_bits == 0 {
            return Ok(());
        }
        let mut state_id = 0;
        while reader.remaining_bits() >= transition_count_bits {
            let tc = reader.read_bits(transition_count_bits) as usize;
            for _ in 0..tc {
                if reader.remaining_bits() < symbol_bits + state_bits {
                    return Err(
                        "Serialized NFA plain state transition data is truncated".to_string(),
                    );
                }
                let symbol_index = reader.read_bits(symbol_bits) as u8;
                let target = reader.read_bits(state_bits) as usize;
                let sym = symbol_index + 1;
                nfa.add_transition(state_id, target, &[sym]);
            }
            state_id += 1;
        }
        Ok(())
    }

    fn read_packed_body(
        nfa: &mut Nfa,
        reader: &mut BitReader,
        symbol_count: usize,
        state_bits: usize,
    ) {
        let mut state_id = 0;
        while reader.remaining_bits() >= symbol_count {
            let active_mask = reader.read_bits(symbol_count);
            let mut mask = active_mask;
            let mut value: u8 = 1;
            while mask != 0 {
                if mask & 1 != 0 {
                    if reader.remaining_bits() >= state_bits {
                        let target = reader.read_bits(state_bits) as usize;
                        nfa.add_transition(state_id, target, &[value]);
                    }
                }
                mask >>= 1;
                value += 1;
            }
            state_id += 1;
        }
    }

    // ================================================================
    // Write helpers
    // ================================================================

    #[cfg(test)]
    fn write_plain_body(
        writer: &mut BitWriter,
        nfa: &Nfa,
        transition_count_bits: usize,
        symbol_bits: usize,
        state_bits: usize,
    ) {
        for state_id in 0..nfa.num_states() {
            let trans = nfa.state_transitions(state_id);
            let mut count = 0u32;
            for targets in trans {
                count += targets.len() as u32;
            }
            writer.write_bits(count, transition_count_bits);
            for (sym_idx, targets) in trans.iter().enumerate() {
                for &target in targets {
                    writer.write_bits(sym_idx as u32, symbol_bits);
                    writer.write_bits(target as u32, state_bits);
                }
            }
        }
    }

    #[cfg(test)]
    fn write_packed_body(
        writer: &mut BitWriter,
        nfa: &Nfa,
        symbol_count: usize,
        state_bits: usize,
    ) {
        for state_id in 0..nfa.num_states() {
            let trans = nfa.state_transitions(state_id);
            let mut symbol_mask = 0u32;
            for (sym_idx, targets) in trans.iter().enumerate() {
                if !targets.is_empty() {
                    symbol_mask |= 1 << sym_idx;
                }
            }
            writer.write_bits(symbol_mask, symbol_count);
            for targets in trans {
                if !targets.is_empty() {
                    writer.write_bits(targets[0] as u32, state_bits);
                }
            }
        }
    }

    // ================================================================
    // Format selection
    // ================================================================

    #[cfg(test)]
    fn choose_format(
        nfa: &Nfa,
        symbol_count: usize,
        symbol_bits: usize,
        state_bits: usize,
    ) -> (u32, usize) {
        let num_states = nfa.num_states();
        let mut max_transitions = 0usize;
        let mut total_transitions = 0usize;
        let mut can_pack = true;

        for state_id in 0..num_states {
            let trans = nfa.state_transitions(state_id);
            let mut count = 0usize;
            for targets in trans {
                if targets.len() > 1 {
                    can_pack = false;
                }
                count += targets.len();
            }
            if count > max_transitions {
                max_transitions = count;
            }
            total_transitions += count;
        }

        let transition_count_bits = required_bits(max_transitions as u32);

        if !can_pack {
            return (FORMAT_PLAIN, transition_count_bits);
        }

        let plain_size =
            num_states * transition_count_bits + total_transitions * (symbol_bits + state_bits);
        let packed_size = num_states * symbol_count + total_transitions * state_bits;

        if packed_size < plain_size {
            (FORMAT_PACKED, transition_count_bits)
        } else {
            (FORMAT_PLAIN, transition_count_bits)
        }
    }

    // ================================================================
    // Normalization
    // ================================================================

    /// Reorder states: start states first, then non-start accepts, then others.
    #[cfg(test)]
    fn normalize_states(nfa: &mut Nfa) {
        let num_states = nfa.num_states();
        let start_set = nfa.start_ids().clone();
        let accept_set = nfa.accept_ids().clone();

        let mut accept_ids: Vec<usize> = Vec::new();
        let mut other_ids: Vec<usize> = Vec::new();

        for i in 0..num_states {
            if start_set.contains(&i) {
                continue;
            }
            if accept_set.contains(&i) {
                accept_ids.push(i);
            } else {
                other_ids.push(i);
            }
        }

        let mut remap = vec![0i32; num_states];
        let mut next_index = 0i32;

        // Start states first (in iteration order — deterministic since HashSet
        // iteration order varies, but the JS version iterates Set in insertion
        // order. We sort for determinism).
        let mut sorted_starts: Vec<usize> = start_set.into_iter().collect();
        sorted_starts.sort_unstable();
        for &id in &sorted_starts {
            remap[id] = next_index;
            next_index += 1;
        }
        for &id in &accept_ids {
            remap[id] = next_index;
            next_index += 1;
        }
        for &id in &other_ids {
            remap[id] = next_index;
            next_index += 1;
        }

        nfa.remap_states(&remap);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_roundtrip_simple() {
        // Build a simple NFA: accepts "12" or "13".
        let mut nfa = Nfa::new();
        let s0 = nfa.add_state();
        let s1 = nfa.add_state();
        let s2 = nfa.add_state();
        nfa.add_start_id(s0);
        nfa.add_accept_id(s2);
        nfa.add_transition(s0, s1, &[1]); // state 0 --1--> state 1
        nfa.add_transition(s1, s2, &[2]); // state 1 --2--> state 2
        nfa.add_transition(s1, s2, &[3]); // state 1 --3--> state 2
        nfa.seal();

        let serialized = NfaSerializer::serialize(&mut nfa);
        assert!(!serialized.is_empty());

        let deserialized = NfaSerializer::deserialize(&serialized).unwrap();
        assert_eq!(deserialized.num_states(), nfa.num_states());
        assert_eq!(deserialized.start_ids().len(), 1);
        assert_eq!(deserialized.accept_ids().len(), 1);
    }

    #[test]
    fn test_empty_nfa() {
        let serialized = NfaSerializer::deserialize("").unwrap();
        assert_eq!(serialized.num_states(), 0);
    }

    #[test]
    fn test_base64_roundtrip() {
        let data = vec![0x48, 0x65, 0x6c, 0x6c, 0x6f];
        let encoded = base64_encode(&data);
        let decoded = base64_decode(&encoded);
        assert_eq!(data, decoded);
    }
}
