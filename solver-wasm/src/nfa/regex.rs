//! Regex → NFA compilation via Thompson's construction.
//!
//! Mirrors JS `RegexParser` and `RegexToNFABuilder` from `nfa_builder.js`.
//!
//! Supported syntax:
//! - Literals: `1`–`9`, `A`–`Z`/`a`–`z` (case-insensitive, mapped to values)
//! - `.` — wildcard (any symbol)
//! - `[abc]`, `[^abc]`, `[a-z]` — character classes
//! - `()` — grouping
//! - `|` — alternation
//! - `*`, `+`, `?` — quantifiers
//! - `{n}`, `{n,}`, `{n,m}` — counted repetition

use super::nfa_core::{optimize_nfa, Nfa};
use crate::api::types::Value;

// ============================================================================
// AST
// ============================================================================

enum AstNode {
    /// Character set (literal, wildcard, or char class).
    Charset { chars: Vec<u8>, negated: bool },
    /// Sequence of nodes.
    Concat(Vec<AstNode>),
    /// Alternation (a|b|c).
    Alternate(Vec<AstNode>),
    /// Quantifier (child, min, max). `max == None` means unbounded.
    Quantifier {
        child: Box<AstNode>,
        min: usize,
        max: Option<usize>,
    },
}

// ============================================================================
// Character ↔ value mapping
// ============================================================================

/// Map a character to a 1-based value.
/// '1'–'9' → 1–9, 'A'–'Z'/'a'–'z' → 10–35.
fn char_to_value(ch: u8) -> Result<Value, String> {
    match ch {
        b'1'..=b'9' => Ok(ch - b'0'),
        b'A'..=b'Z' => Ok(ch - b'A' + 10),
        b'a'..=b'z' => Ok(ch - b'a' + 10),
        _ => Err(format!(
            "Unsupported character '{}' in regex constraint",
            ch as char
        )),
    }
}

/// Convert a character to a symbol value, checking against num_values.
fn char_to_symbol(ch: u8, num_values: u8) -> Result<u8, String> {
    let value = char_to_value(ch)?;
    if value < 1 || value > num_values {
        return Err(format!(
            "Character '{}' exceeds shape value count ({})",
            ch as char, num_values
        ));
    }
    Ok(value)
}

// ============================================================================
// RegexParser — recursive descent
// ============================================================================

struct RegexParser<'a> {
    pattern: &'a [u8],
    pos: usize,
}

impl<'a> RegexParser<'a> {
    fn new(pattern: &'a str) -> Self {
        Self {
            pattern: pattern.as_bytes(),
            pos: 0,
        }
    }

    fn parse(&mut self) -> Result<AstNode, String> {
        let expr = self.parse_expression()?;
        if !self.is_eof() {
            return Err(format!(
                "Unexpected token at position {}",
                self.pos
            ));
        }
        Ok(expr)
    }

    fn parse_expression(&mut self) -> Result<AstNode, String> {
        let node = self.parse_sequence()?;
        let mut alternatives = vec![node];
        while self.peek() == Some(b'|') {
            self.next();
            alternatives.push(self.parse_sequence()?);
        }
        if alternatives.len() == 1 {
            Ok(alternatives.into_iter().next().unwrap())
        } else {
            Ok(AstNode::Alternate(alternatives))
        }
    }

    fn parse_sequence(&mut self) -> Result<AstNode, String> {
        let mut parts = Vec::new();
        while !self.is_eof() {
            let ch = self.peek().unwrap();
            if ch == b'|' || ch == b')' {
                break;
            }
            parts.push(self.parse_quantified()?);
        }
        if parts.len() == 1 {
            Ok(parts.into_iter().next().unwrap())
        } else {
            Ok(AstNode::Concat(parts))
        }
    }

    fn parse_quantified(&mut self) -> Result<AstNode, String> {
        let mut node = self.parse_primary()?;
        loop {
            match self.peek() {
                Some(b'*') => {
                    self.next();
                    node = AstNode::Quantifier {
                        child: Box::new(node),
                        min: 0,
                        max: None,
                    };
                }
                Some(b'+') => {
                    self.next();
                    node = AstNode::Quantifier {
                        child: Box::new(node),
                        min: 1,
                        max: None,
                    };
                }
                Some(b'?') => {
                    self.next();
                    node = AstNode::Quantifier {
                        child: Box::new(node),
                        min: 0,
                        max: Some(1),
                    };
                }
                Some(b'{') => {
                    node = self.parse_brace_quantifier(node)?;
                }
                _ => break,
            }
        }
        Ok(node)
    }

    fn parse_brace_quantifier(&mut self, node: AstNode) -> Result<AstNode, String> {
        let start_pos = self.pos;
        self.expect(b'{')?;

        let min = self.parse_number().ok_or_else(|| {
            format!("Expected number after '{{' at position {}", start_pos)
        })?;

        let max;
        if self.peek() == Some(b',') {
            self.next();
            if self.peek() == Some(b'}') {
                max = None; // unbounded
            } else {
                let m = self.parse_number().ok_or_else(|| {
                    format!(
                        "Expected number or '}}' after ',' at position {}",
                        self.pos
                    )
                })?;
                if m < min {
                    return Err(format!(
                        "Invalid quantifier: max ({}) < min ({}) at position {}",
                        m, min, start_pos
                    ));
                }
                max = Some(m);
            }
        } else {
            max = Some(min); // exact
        }

        self.expect(b'}')?;

        Ok(AstNode::Quantifier {
            child: Box::new(node),
            min,
            max,
        })
    }

    fn parse_number(&mut self) -> Option<usize> {
        let mut num_str = String::new();
        while let Some(ch) = self.peek() {
            if ch.is_ascii_digit() {
                num_str.push(ch as char);
                self.next();
            } else {
                break;
            }
        }
        if num_str.is_empty() {
            None
        } else {
            num_str.parse().ok()
        }
    }

    fn parse_primary(&mut self) -> Result<AstNode, String> {
        match self.peek() {
            Some(b'(') => {
                self.next();
                let expr = self.parse_expression()?;
                if self.peek() != Some(b')') {
                    return Err(format!("Unclosed group at position {}", self.pos));
                }
                self.next();
                Ok(expr)
            }
            Some(b'[') => self.parse_char_class(),
            Some(b'.') => {
                self.next();
                // Negated empty = all symbols (wildcard).
                Ok(AstNode::Charset {
                    chars: Vec::new(),
                    negated: true,
                })
            }
            None => Err("Unexpected end of pattern".to_string()),
            Some(ch) if b"*+?{|)".contains(&ch) => {
                Err(format!(
                    "Unexpected token '{}' at position {}",
                    ch as char, self.pos
                ))
            }
            Some(ch) => {
                self.next();
                Ok(AstNode::Charset {
                    chars: vec![ch],
                    negated: false,
                })
            }
        }
    }

    fn parse_char_class(&mut self) -> Result<AstNode, String> {
        self.expect(b'[')?;
        let negated = self.peek() == Some(b'^');
        if negated {
            self.next();
        }

        let mut chars = Vec::new();
        while !self.is_eof() && self.peek() != Some(b']') {
            let start = self.next().unwrap();
            if self.peek() == Some(b'-') {
                self.next();
                let end = self.next().ok_or("Invalid character range")?;
                if end < start {
                    return Err("Invalid character range in class".to_string());
                }
                for code in start..=end {
                    if !chars.contains(&code) {
                        chars.push(code);
                    }
                }
            } else if !chars.contains(&start) {
                chars.push(start);
            }
        }
        self.expect(b']')?;
        if chars.is_empty() {
            return Err("Empty character class".to_string());
        }
        Ok(AstNode::Charset { chars, negated })
    }

    fn expect(&mut self, expected: u8) -> Result<(), String> {
        match self.next() {
            Some(ch) if ch == expected => Ok(()),
            _ => Err(format!(
                "Expected '{}' at position {}",
                expected as char,
                self.pos.saturating_sub(1)
            )),
        }
    }

    fn peek(&self) -> Option<u8> {
        self.pattern.get(self.pos).copied()
    }

    fn next(&mut self) -> Option<u8> {
        if self.pos >= self.pattern.len() {
            None
        } else {
            let ch = self.pattern[self.pos];
            self.pos += 1;
            Some(ch)
        }
    }

    fn is_eof(&self) -> bool {
        self.pos >= self.pattern.len()
    }
}

// ============================================================================
// RegexToNFABuilder — Thompson's construction
// ============================================================================

struct Fragment {
    start_id: usize,
    accept_id: usize,
}

struct RegexToNfaBuilder {
    nfa: Nfa,
    num_values: u8,
}

impl RegexToNfaBuilder {
    fn new(num_values: u8) -> Self {
        Self {
            nfa: Nfa::with_state_limit(super::nfa_core::MAX_STATE_COUNT_PUB),
            num_values,
        }
    }

    fn build(mut self, ast: AstNode) -> Nfa {
        let frag = self.build_node(&ast);
        self.nfa.add_start_id(frag.start_id);
        self.nfa.add_accept_id(frag.accept_id);
        self.nfa.seal();
        self.nfa
    }

    fn build_node(&mut self, node: &AstNode) -> Fragment {
        match node {
            AstNode::Charset { chars, negated } => self.build_charset(chars, *negated),
            AstNode::Concat(parts) => self.build_concat(parts),
            AstNode::Alternate(options) => self.build_alternate(options),
            AstNode::Quantifier { child, min, max } => {
                self.build_quantifier(child, *min, *max)
            }
        }
    }

    fn build_empty(&mut self) -> Fragment {
        let id = self.nfa.add_state();
        Fragment {
            start_id: id,
            accept_id: id,
        }
    }

    fn build_charset(&mut self, chars: &[u8], negated: bool) -> Fragment {
        let start_id = self.nfa.add_state();
        let accept_id = self.nfa.add_state();

        let symbols: Vec<u8> = if negated {
            let exclude: std::collections::HashSet<u8> = chars
                .iter()
                .filter_map(|&ch| char_to_symbol(ch, self.num_values).ok())
                .collect();
            (1..=self.num_values)
                .filter(|v| !exclude.contains(v))
                .collect()
        } else {
            chars
                .iter()
                .filter_map(|&ch| char_to_symbol(ch, self.num_values).ok())
                .collect()
        };

        self.nfa.add_transition(start_id, accept_id, &symbols);
        Fragment {
            start_id,
            accept_id,
        }
    }

    fn build_concat(&mut self, parts: &[AstNode]) -> Fragment {
        if parts.is_empty() {
            return self.build_empty();
        }
        let first = self.build_node(&parts[0]);
        let mut accept_id = first.accept_id;
        for part in &parts[1..] {
            let next = self.build_node(part);
            self.nfa.add_epsilon(accept_id, next.start_id);
            accept_id = next.accept_id;
        }
        Fragment {
            start_id: first.start_id,
            accept_id,
        }
    }

    fn build_alternate(&mut self, options: &[AstNode]) -> Fragment {
        let start_id = self.nfa.add_state();
        let accept_id = self.nfa.add_state();
        for option in options {
            let frag = self.build_node(option);
            self.nfa.add_epsilon(start_id, frag.start_id);
            self.nfa.add_epsilon(frag.accept_id, accept_id);
        }
        Fragment {
            start_id,
            accept_id,
        }
    }

    fn build_quantifier(
        &mut self,
        child: &AstNode,
        min: usize,
        max: Option<usize>,
    ) -> Fragment {
        // Start with empty if min is 0, otherwise build first required copy.
        let mut result = if min == 0 {
            self.build_empty()
        } else {
            self.build_node(child)
        };

        // Build remaining required copies (1..min-1).
        for _ in 1..min {
            let next = self.build_node(child);
            self.nfa.add_epsilon(result.accept_id, next.start_id);
            result = Fragment {
                start_id: result.start_id,
                accept_id: next.accept_id,
            };
        }

        match max {
            None => {
                // Unbounded: self-loop.
                let inner = self.build_node(child);
                self.nfa.add_epsilon(result.accept_id, inner.start_id);
                self.nfa.add_epsilon(inner.accept_id, inner.start_id);
                self.nfa.add_epsilon(inner.accept_id, result.accept_id);
            }
            Some(max_val) => {
                // Bounded: append optional copies.
                for _ in min..max_val {
                    let inner = self.build_node(child);
                    self.nfa.add_epsilon(result.accept_id, inner.start_id);
                    self.nfa.add_epsilon(result.accept_id, inner.accept_id); // skip
                    result = Fragment {
                        start_id: result.start_id,
                        accept_id: inner.accept_id,
                    };
                }
            }
        }

        result
    }
}

// ============================================================================
// Public API
// ============================================================================

/// Compile a regex pattern into an optimized NFA.
///
/// Mirrors JS `regexToNFA(pattern, numSymbols)` from `nfa_builder.js`.
pub fn regex_to_nfa(pattern: &str, num_values: u8) -> Result<Nfa, String> {
    let mut parser = RegexParser::new(pattern);
    let ast = parser.parse().map_err(|e| {
        format!("Regex \"{}\" could not be compiled: {}", pattern, e)
    })?;
    let builder = RegexToNfaBuilder::new(num_values);
    let mut nfa = builder.build(ast);
    optimize_nfa(&mut nfa, usize::MAX, false);
    Ok(nfa)
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::compress::compress_nfa;

    #[test]
    fn test_literal_pattern() {
        let mut nfa = regex_to_nfa("123", 9).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        assert!(cnfa.num_states > 0);
    }

    #[test]
    fn test_wildcard_pattern() {
        let mut nfa = regex_to_nfa("1.3", 9).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        assert!(cnfa.num_states > 0);
    }

    #[test]
    fn test_alternation() {
        let mut nfa = regex_to_nfa("1|2|3", 9).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        assert!(cnfa.num_states > 0);
    }

    #[test]
    fn test_quantifiers() {
        let mut nfa = regex_to_nfa("1*2+3?", 9).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        assert!(cnfa.num_states > 0);
    }

    #[test]
    fn test_char_class() {
        let mut nfa = regex_to_nfa("[123][^45]", 9).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        assert!(cnfa.num_states > 0);
    }

    #[test]
    fn test_brace_quantifier() {
        let mut nfa = regex_to_nfa("[1-9]{3}", 9).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        assert!(cnfa.num_states > 0);
    }

    #[test]
    fn test_complex_pattern() {
        let mut nfa = regex_to_nfa("(1|2)(3|4){2,4}[5-9]+", 9).unwrap();
        let cnfa = compress_nfa(&mut nfa);
        assert!(cnfa.num_states > 0);
    }
}
