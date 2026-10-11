"""The probe tunes do what make_probe_sids.py says they do, and the committed copies are current."""

from __future__ import annotations

import struct
import sys
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))

import make_probe_sids as probes  # noqa: E402
from mini6502 import Cpu  # noqa: E402

REPO = HERE.parents[2]
COMMITTED = REPO / "tests/fixtures/sid-engines"


def load(tune: probes.Tune) -> tuple[Cpu, bytes]:
    image = probes.build_sid(tune)
    memory = bytearray(0x10000)
    data_offset = struct.unpack(">H", image[6:8])[0]
    load_address = struct.unpack("<H", image[data_offset : data_offset + 2])[0]
    code = image[data_offset + 2 :]
    memory[load_address : load_address + len(code)] = code
    return Cpu(memory), image


def tune_named(name: str) -> probes.Tune:
    return next(tune for tune in probes.tunes() if tune.name == name)


def test_the_committed_tunes_are_what_the_generator_writes():
    generated = {f"{tune.name}.sid": probes.build_sid(tune) for tune in probes.tunes()}
    committed = {path.name: path.read_bytes() for path in COMMITTED.glob("*.sid")}
    assert committed.keys() == generated.keys()
    for name, image in generated.items():
        assert committed[name] == image, f"{name} is stale: run tools/sid-engines/make_probe_sids.py"


@pytest.mark.parametrize("tune", probes.tunes(), ids=lambda tune: tune.name)
def test_headers_declare_the_format_chips_and_speed(tune):
    image = probes.build_sid(tune)
    assert image[:4] == (b"RSID" if tune.rsid else b"PSID")
    version = struct.unpack(">H", image[4:6])[0]
    assert version == (4 if tune.third_sid else 3 if tune.second_sid else 2)
    assert struct.unpack(">I", image[0x12:0x16])[0] == (1 if tune.cia_speed else 0)
    assert struct.unpack(">H", image[0x76:0x78])[0] == tune.flags
    assert (image[0x7A], image[0x7B]) == (tune.second_sid, tune.third_sid)
    if tune.rsid:
        assert struct.unpack(">H", image[0x0C:0x0E])[0] == 0  # an RSID has no play address


@pytest.mark.parametrize(
    "name, frames",
    [
        ("waveforms-6581", probes.waveform_frames()),
        ("filter-8580", probes.filter_frames()),
        ("envelopes", probes.envelope_frames()),
        ("ntsc", probes.waveform_frames(probes.NTSC_CLOCK_HZ)),
        ("two-sid", probes.combine(probes.waveform_frames(), probes.filter_frames(0xD420))),
    ],
)
def test_the_script_player_writes_each_frame_once_per_call_and_loops(name, frames):
    tune = tune_named(name)
    cpu, _ = load(tune)
    cpu.call(tune.init)
    # The call that finds the end of the script restarts it and writes nothing, so a loop is one
    # silent call longer than the script.
    expected = [[w for w in frame if w[0] >= 0xD000] for frame in frames]
    for want in expected + [[]] + expected[:3]:
        cpu.writes.clear()
        cpu.call(tune.play)
        assert cpu.writes == want


def test_three_sid_writes_reach_all_three_chips():
    tune = tune_named("three-sid")
    cpu, _ = load(tune)
    cpu.call(tune.init)
    chips = set()
    for _ in range(400):
        cpu.call(tune.play)
    for address, _ in cpu.writes:
        chips.add(address & 0xFFE0)
    assert {0xD400, 0xD420, 0xD440} <= chips


def test_multispeed_init_programs_a_200_hz_cia_timer():
    tune = tune_named("multispeed")
    cpu, _ = load(tune)
    cpu.call(tune.init)
    timer = cpu.read(0xDC04) | (cpu.read(0xDC05) << 8)
    assert timer == int(probes.PAL_CLOCK_HZ / 200)


@pytest.mark.parametrize("name", ["digi-6581", "digi-8580"])
def test_digi_steps_through_every_sample_page_and_wraps(name):
    tune = tune_named(name)
    cpu, _ = load(tune)
    cpu.call(tune.init)
    total = 64 * 256
    levels = []
    for _ in range(total + 300):
        cpu.writes.clear()
        cpu.call(tune.play)
        assert len(cpu.writes) == 1 and cpu.writes[0][0] == 0xD418
        levels.append(cpu.writes[0][1])
    assert all(0 <= level <= 15 for level in levels)
    assert levels[total : total + 300] == levels[:300], "the sample loop does not wrap to its first page"
    page_peaks = {max(levels[page * 256 : (page + 1) * 256]) for page in range(64)}
    assert len(page_peaks) == 8, "the pages do not carry eight different amplitudes"


def test_rsid_installs_its_handler_and_plays_the_script_from_the_interrupt():
    tune = tune_named("rsid-irq")
    cpu, _ = load(tune)
    cpu.push(0xFF)
    cpu.push(0xFE)
    cpu.pc = tune.init
    for _ in range(2000):
        if cpu.read(cpu.pc) == 0x4C and cpu.word(cpu.pc + 1) == cpu.pc:
            break
        cpu.step()
    else:
        raise AssertionError("init never reached its idle loop")
    assert cpu.read(0x01) == 0x35
    writes = dict(cpu.writes)
    assert writes[0xD01A] == 0x00, "raster interrupts are left enabled"
    assert writes[0xDC0D] == 0x81 and writes[0xDC0E] == 0x11
    assert (cpu.read(0xDC04) | (cpu.read(0xDC05) << 8)) == 19656
    idle = cpu.pc
    frames = probes.waveform_frames()
    for frame in frames[:50]:
        cpu.writes.clear()
        cpu.interrupt()
        cpu.run_until(lambda: cpu.pc == idle, 5000)
        sid = [w for w in cpu.writes if 0xD400 <= w[0] < 0xD800]
        assert sid == [w for w in frame if w[0] >= 0xD400]


def test_a_frame_cannot_hold_more_writes_than_the_player_can_index():
    a = probes.Asm(probes.LOAD_ADDR)
    with pytest.raises(ValueError):
        probes.emit_script(a, "script", [[(0xD400, 0)] * 81])
    with pytest.raises(ValueError):
        probes.emit_script(a, "other", [[]])
