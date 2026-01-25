#!/bin/bash
# run-bisect.sh - Run git bisect with the bisect-test.js script
#
# This script copies bisect-test.js to /tmp before starting bisect,
# so it remains available when checking out old commits.
#
# Usage:
#   ./tests/bisect/run-bisect.sh [good_commit] [bad_commit]
#
# Environment variables for configuration:
#   BISECT_PUZZLE            - The puzzle constraint string
#   BISECT_EXPECTED_GUESSES  - Expected number of guesses (baseline)
#   BISECT_TOLERANCE         - Tolerance multiplier (default: 1.5)
#
# Examples:
#   # Basic usage (defaults: HEAD as bad, f703259 as good)
#   BISECT_PUZZLE=".Diagonal~1" BISECT_EXPECTED_GUESSES=1000 \
#     ./tests/bisect/run-bisect.sh
#
#   # Specify commits
#   BISECT_PUZZLE=".Diagonal~1" BISECT_EXPECTED_GUESSES=1000 \
#     ./tests/bisect/run-bisect.sh abc123 def456

set -eu

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMP_SCRIPT="$(mktemp /tmp/bisect-test.XXXXXX.js)"

# Default commits
GOOD_COMMIT="${1:-f703259}" # This is the oldest commit this script has been tested with
BAD_COMMIT="${2:-HEAD}"

# Validate required environment variables
if [ -z "$BISECT_PUZZLE" ]; then
  echo "ERROR: BISECT_PUZZLE environment variable is required"
  exit 1
fi
if [ -z "$BISECT_EXPECTED_GUESSES" ]; then
  echo "ERROR: BISECT_EXPECTED_GUESSES environment variable is required"
  exit 1
fi

echo "=== Bisect Setup ==="
PUZZLE_DISPLAY="${BISECT_PUZZLE:0:60}"
if [ ${#BISECT_PUZZLE} -gt 60 ]; then
  PUZZLE_DISPLAY="${PUZZLE_DISPLAY}..."
fi
echo "Puzzle: $PUZZLE_DISPLAY"
echo "Expected guesses: $BISECT_EXPECTED_GUESSES"
echo "Tolerance: ${BISECT_TOLERANCE:-1.5}x"
echo ""
echo "Good commit: $GOOD_COMMIT"
echo "Bad commit: $BAD_COMMIT"
echo "Temp script: $TEMP_SCRIPT"
echo ""

# Copy script to temp location
cp "$SCRIPT_DIR/bisect-test.js" "$TEMP_SCRIPT"
echo "Copied bisect-test.js to $TEMP_SCRIPT"

# Cleanup on exit
cleanup() {
  rm -f "$TEMP_SCRIPT"
}
trap cleanup EXIT

# Start bisect
cd "$REPO_ROOT"
git bisect start "$BAD_COMMIT" "$GOOD_COMMIT"

echo ""
echo "=== Starting Bisect ==="
echo "Running: git bisect run node --experimental-vm-modules $TEMP_SCRIPT $REPO_ROOT"
echo ""

# Run bisect
git bisect run node --experimental-vm-modules "$TEMP_SCRIPT" "$REPO_ROOT"

# Reset bisect
echo ""
echo "=== Bisect Complete ==="
git bisect reset
