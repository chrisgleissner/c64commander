#!/bin/bash
# Clean up old flat-format evidence directories
# Only keep the canonical format: testId/deviceId/

set -e

EVIDENCE_ROOT="test-results/evidence"

if [ ! -d "$EVIDENCE_ROOT" ]; then
    echo "No evidence directory found"
    exit 0
fi

echo "Cleaning up old flat-format evidence directories..."

# Find directories with device prefix pattern (e.g., android-phone__*)
# These are the old flat format that should be removed
find "$EVIDENCE_ROOT" -maxdepth 1 -type d -name '*__*' -print0 | while IFS= read -r -d '' dir; do
    echo "Removing old format: $(basename "$dir")"
    rm -rf "$dir"
done

echo "Cleanup complete. Only canonical format (testId/deviceId/) remains."
