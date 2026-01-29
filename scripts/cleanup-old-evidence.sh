#!/bin/bash
# Clean up old flat-format evidence directories
# Only keep the canonical format: testId/deviceId/

set -e

EVIDENCE_ROOTS=("test-results/evidence/playwright")

found_root=false
for root in "${EVIDENCE_ROOTS[@]}"; do
    if [ ! -d "$root" ]; then
        continue
    fi
    found_root=true
    echo "Cleaning up old flat-format evidence directories in $root..."
    # Find directories with device prefix pattern (e.g., android-phone__*)
    # These are the old flat format that should be removed
    find "$root" -maxdepth 1 -type d -name '*__*' -print0 | while IFS= read -r -d '' dir; do
            echo "Removing old format: $(basename "$dir")"
            rm -rf "$dir"
    done
done

if [ "$found_root" = false ]; then
    echo "No evidence directory found"
    exit 0
fi

echo "Cleanup complete. Only canonical format (testId/deviceId/) remains."
