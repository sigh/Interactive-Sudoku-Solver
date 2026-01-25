# Git Bisect Performance Testing

Tools for bisecting performance regressions in the solver.

## Quick Start

```bash
# Run with defaults (tests current HEAD vs f703259 from Dec 2023)
./tests/bisect/run-bisect.sh

# Specify good and bad commits
./tests/bisect/run-bisect.sh <good_commit> <bad_commit>

# Test a specific puzzle with custom expected guesses
BISECT_PUZZLE=".Diagonal~1.Diagonal~-1" \
BISECT_EXPECTED_GUESSES=82000000 \
./tests/bisect/run-bisect.sh abc123 def456
```

## How It Works

1. `run-bisect.sh` copies `bisect-test.js` to `/tmp` before starting bisect
2. This ensures the script remains available when checking out old commits
3. The script handles both old-style global scripts and modern ES modules

## Configuration

Set these environment variables before running:

| Variable | Description | Default |
|----------|-------------|---------|
| `BISECT_PUZZLE` | Constraint string for the puzzle | Test puzzle with cages/diagonals |
| `BISECT_EXPECTED_GUESSES` | Baseline guess count | 14000 |
| `BISECT_TOLERANCE` | Multiplier for acceptable range | 1.5 |

The script marks a commit as "changed" if guesses are outside the range
`[expected/tolerance, expected*tolerance]`.

## Exit Codes

- `0` - Within tolerance (commit is "good")
- `1` - Outside tolerance (commit is "bad")
- `125` - Skip (script failed, e.g., missing dependencies)

## Manual Usage

You can also run the test script directly:

```bash
# Test current checkout
node --experimental-vm-modules tests/bisect/bisect-test.js

# Test with explicit repo root (for when script is in /tmp)
node --experimental-vm-modules /tmp/bisect-test.js /path/to/repo
```
