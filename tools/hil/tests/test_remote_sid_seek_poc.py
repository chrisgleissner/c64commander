"""Pure helpers of the remote SID seek proof of concept: screen and clock decoding, the PSID it
generates, and the speed and rewind schedules the app mirrors."""

import struct
import sys
from pathlib import Path

HIL_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HIL_DIR))

import remote_sid_seek_poc as poc  # noqa: E402

SPEEDS_C64U = [" 1", " 2", " 3", " 4", " 6", " 8", "10", "12", "14", "16", "20", "24", "32", "40", "48", "64"]
SPEEDS_U64 = [" 1", " 2", " 3", " 4", " 5", " 6", " 8", "10", "12", "14", "16", "20", "24", "32", "40", "48"]


def test_screen_address_follows_the_vic_bank_and_matrix():
    assert poc.screen_address(0x97, 0x25) == 0x0800
    assert poc.screen_address(0x95, 0x35) == 0x8C00
    assert poc.screen_address(0x97, 0x15) == 0x0400


def test_parse_clock_reads_the_players_screen_codes():
    assert poc.parse_clock(b"01:05") == 65
    assert poc.parse_clock(b"99:59") == 99 * 60 + 59


def test_parse_clock_rejects_cells_that_are_not_a_clock():
    assert poc.parse_clock(b"\x00\x00\x00\x00\x00") is None
    assert poc.parse_clock(b"01:75") is None
    assert poc.parse_clock(b"0105 ") is None


def test_option_for_mhz_returns_the_devices_padded_spelling():
    assert poc.option_for_mhz(SPEEDS_C64U, 4) == " 4"
    assert poc.option_for_mhz(SPEEDS_C64U, 16) == "16"
    assert poc.option_for_mhz(SPEEDS_C64U, 5) is None


def test_ramp_steps_double_then_end_at_the_machines_maximum():
    assert poc.ramp_options(SPEEDS_C64U, 1) == [" 2", " 4", " 8", "16", "32", "64"]
    assert poc.ramp_options(SPEEDS_U64, 1) == [" 2", " 4", " 8", "16", "32", "48"]


def test_ramp_starts_above_a_speed_the_user_already_runs_at():
    assert poc.ramp_options(SPEEDS_C64U, 8) == ["16", "32", "64"]
    assert poc.ramp_options(SPEEDS_C64U, 64) == []


def test_rewind_offsets_grow_10_20_40_then_80_per_step():
    assert [poc.rewind_offset_s(n) for n in range(7)] == [0, 10, 30, 70, 150, 230, 310]


def test_counter_psid_header_and_entry_points():
    sid = poc.build_counter_psid("NTSC", busy_loops=3, cia_timer=0x1331)
    assert sid[:4] == b"PSID"
    init, play = struct.unpack(">HH", sid[10:14])
    speed = struct.unpack(">I", sid[18:22])[0]
    flags = struct.unpack(">H", sid[0x76:0x78])[0]
    assert (init, speed, flags) == (poc.TUNE_LOAD, 1, poc.NTSC_FLAGS)
    body = sid[0x7C + 2:]
    assert body[play - poc.TUNE_LOAD] == 0xEE
    assert bytes([0xA9, 0x31, 0x8D, 0x04, 0xDC]) in body
    assert body.endswith(bytes([0xA2, 3, 0xCA, 0xD0, 0xFD, 0x60]))


def test_counter_value_is_little_endian_24_bit():
    assert poc.counter_value(bytes([0x34, 0x12, 0x01])) == 0x011234


def test_snap_call_rate_corrects_the_upward_bias_of_the_sampled_latch():
    assert poc.snap_call_rate(52.7) == 50.0
    assert poc.snap_call_rate(61.1) == 60.0
    assert poc.snap_call_rate(202.4) == 200.0
    assert poc.snap_call_rate(75.0) == 75.0


def test_planner_waits_for_a_measurement_then_bounds_faster_speeds_by_the_clock_ratio():
    planner = poc.JumpSpeedPlanner(SPEEDS_C64U, " 1")
    assert planner.tiers == ["64", " 4", " 1"]
    assert planner.choose(1000, 0.05) == " 1"
    planner.measured[" 1"] = 10
    assert round(planner.rate_bound("64")) == 832
    assert planner.choose(200, 0.05) == "64"
    assert planner.choose(100, 0.05) == " 4"
    assert planner.choose(5, 0.05) == " 1"


def test_planner_never_lowers_a_bound_with_a_measurement():
    planner = poc.JumpSpeedPlanner(SPEEDS_C64U, " 1")
    planner.measured[" 1"] = 10
    planner.measured["64"] = 89
    assert round(planner.rate_bound("64")) == 832


def test_rate_between_counts_through_the_clock_wrapping_after_99_59():
    assert poc.rate_between((0.0, 10.0), (2.0, 30.0)) == 10.0
    assert poc.rate_between((0.0, 5990.0), (1.0, 10.0)) == 20.0
