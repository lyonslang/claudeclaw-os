#!/bin/bash

# Phase 1B Test Runner
# Validates: God's Eye caching, anti-slop checks, mission logging
# Usage: ./scripts/run-phase-1b-test.sh

set -e

PROJECT_ROOT=$(git rev-parse --show-toplevel)
cd "$PROJECT_ROOT"

echo "🚀 Phase 1B Test: Single Script Mission"
echo "═════════════════════════════════════"
echo ""

# Ensure build is up to date
echo "📦 Building TypeScript..."
npm run build > /dev/null 2>&1

# Run the test
echo "▶️  Running test runner..."
echo ""

npx ts-node test/phase-1b-runner.ts

# Query results
echo ""
echo "📊 Querying mission_post_mortem..."
echo ""

sqlite3 "$PROJECT_ROOT/store/claudeclaw.db" << 'EOF'
.mode column
.headers on
.width 12 12 12 12 12 12 12

SELECT
  mission_id,
  total_cost_usd,
  duration_seconds,
  god_s_eye_calls_total,
  god_s_eye_calls_cached,
  anti_slop_rejections,
  anti_slop_flags,
  escalations_to_ava
FROM mission_post_mortem
WHERE mission_id = 'phase_1b_test_001';
EOF

echo ""
echo "✅ Test complete. Next steps:"
echo "   1. Review metrics above"
echo "   2. If all green, Phase 1B validation passes"
echo "   3. Ready for Phase 2 implementation (Visual Director + Skinwalker)"
