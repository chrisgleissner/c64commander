"""The stimulus half of audio_e2e_probe.py must run where numpy is not installed.

The unit-test CI job runs `audio_e2e_probe.py build-sid` from tests/unit/hil/audioProbeStimulus.test.ts
without numpy. Only the grading needs numpy, so building the SID must not import it.
"""

import subprocess
import sys
from pathlib import Path

PROBE = Path(__file__).resolve().parents[1] / "audio_e2e_probe.py"

BLOCK_NUMPY_AND_RUN = """
import runpy, sys
sys.modules["numpy"] = None
out = sys.argv[1]
sys.argv = ["audio_e2e_probe.py", "build-sid", "--out", out]
runpy.run_path({probe!r}, run_name="__main__")
"""


def test_build_sid_runs_without_numpy(tmp_path: Path) -> None:
    out = tmp_path / "barcode.sid"
    script = BLOCK_NUMPY_AND_RUN.format(probe=str(PROBE))
    result = subprocess.run(
        [sys.executable, "-c", script, str(out)], capture_output=True, text=True, check=False
    )
    assert result.returncode == 0, result.stderr
    assert out.read_bytes()[:4] == b"PSID"
