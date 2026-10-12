/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Tests of the libSidplayEZ engine itself, which upstream ships without any. They drive
// libsidplayfp::Player and SidTune directly with PSID files assembled here, so a change upstream
// that breaks loading, the emulated C64 or the SID shows up in this build before it reaches a
// listener. Results of 6510 programs are read back through the SID's register file, which the
// emulator exposes (Player::getSidStatus) and which a tune can write without any ROM.
//
// Built by build-libsidplayez.sh in three configurations: plain, AddressSanitizer + UBSan, and
// ThreadSanitizer. Usage: engine_test <tone-ladder.sid>

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <functional>
#include <iterator>
#include <memory>
#include <span>
#include <string>
#include <vector>

#include "MD5/MD5.h"
#include "player.h"
#include "sidplayfp/SidConfig.h"
#include "sidplayfp/SidTune.h"
#include "sidplayfp/SidTuneInfo.h"

namespace {

int failures = 0;
int checks = 0;
const char* currentTest = "";

#define CHECK(condition)                                                                                               \
  do {                                                                                                                 \
    ++checks;                                                                                                          \
    if (!(condition)) {                                                                                                \
      std::fprintf(stderr, "[%s] %s:%d: CHECK failed: %s\n", currentTest, __FILE__, __LINE__, #condition);           \
      ++failures;                                                                                                      \
    }                                                                                                                  \
  } while (0)

#define CHECK_NEAR(value, expected, tolerance)                                                                         \
  do {                                                                                                                 \
    ++checks;                                                                                                          \
    const double v_ = (value), e_ = (expected), t_ = (tolerance);                                                      \
    if (!(std::fabs(v_ - e_) <= t_)) {                                                                                 \
      std::fprintf(stderr, "[%s] %s:%d: %s = %g, expected %g ± %g\n", currentTest, __FILE__, __LINE__, #value, v_, e_, \
                   t_);                                                                                                \
      ++failures;                                                                                                      \
    }                                                                                                                  \
  } while (0)

constexpr double kPalClock = 985248.0;
constexpr double kNtscClock = 1022727.0;
constexpr double kPalFrameRate = kPalClock / 19656.0;
constexpr double kNtscFrameRate = kNtscClock / 17095.0;

// ── PSID assembly ───────────────────────────────────────────────────────────────────────────────

enum Clock : uint16_t { ClockUnknown = 0, ClockPal = 1, ClockNtsc = 2, ClockAny = 3 };
enum Model : uint16_t { ModelUnknown = 0, Model6581 = 1, Model8580 = 2, ModelAny = 3 };

struct Psid {
  std::string magic = "PSID";
  uint16_t version = 2;
  uint16_t load = 0x1000;
  uint16_t init = 0x1000;
  uint16_t play = 0x1100;
  uint16_t songs = 1;
  uint16_t start = 1;
  uint32_t speed = 0;
  Clock clock = ClockPal;
  Model model1 = Model8580;
  Model model2 = ModelUnknown;
  Model model3 = ModelUnknown;
  bool flagBit1 = false; // PSID: PSID-specific, RSID: needs BASIC
  bool mus = false;
  uint8_t sid2 = 0;
  uint8_t sid3 = 0;
  std::string name = "engine test";
  std::string author = "c64commander";
  std::string released = "2026";
  bool loadAddressInData = true;
  /** Code placed at `load`; `play` code at `load + 0x100` when given. */
  std::vector<uint8_t> initCode = {0x60};
  std::vector<uint8_t> playCode = {0x60};

  std::vector<uint8_t> bytes() const {
    std::vector<uint8_t> v(version == 1 ? 0x76 : 0x7c, 0);
    std::memcpy(v.data(), magic.data(), 4);
    auto be16 = [&v](size_t at, uint16_t x) {
      v[at] = uint8_t(x >> 8);
      v[at + 1] = uint8_t(x);
    };
    be16(4, version);
    be16(6, uint16_t(v.size()));
    be16(8, loadAddressInData ? 0 : load);
    be16(0x0a, init);
    be16(0x0c, play);
    be16(0x0e, songs);
    be16(0x10, start);
    v[0x12] = uint8_t(speed >> 24);
    v[0x13] = uint8_t(speed >> 16);
    v[0x14] = uint8_t(speed >> 8);
    v[0x15] = uint8_t(speed);
    std::memcpy(v.data() + 0x16, name.data(), std::min<size_t>(32, name.size()));
    std::memcpy(v.data() + 0x36, author.data(), std::min<size_t>(32, author.size()));
    std::memcpy(v.data() + 0x56, released.data(), std::min<size_t>(32, released.size()));
    if (version >= 2) {
      const uint16_t flags = uint16_t((mus ? 1 : 0) | (flagBit1 ? 2 : 0) | (clock << 2) | (model1 << 4) | (model2 << 6) |
                                      (model3 << 8));
      be16(0x76, flags);
      v[0x7a] = sid2;
      v[0x7b] = sid3;
    }
    const size_t playOffset = std::max<size_t>(0x100, initCode.size());
    std::vector<uint8_t> image(playOffset + playCode.size(), 0xea);
    std::copy(initCode.begin(), initCode.end(), image.begin());
    std::copy(playCode.begin(), playCode.end(), image.begin() + long(playOffset));
    if (loadAddressInData) {
      v.push_back(uint8_t(load));
      v.push_back(uint8_t(load >> 8));
    }
    v.insert(v.end(), image.begin(), image.end());
    return v;
  }
};

/** `STA abs` and friends, written out so each program below reads as assembly. */
std::vector<uint8_t> sta(uint16_t address) { return {0x8d, uint8_t(address), uint8_t(address >> 8)}; }
std::vector<uint8_t> stx(uint16_t address) { return {0x8e, uint8_t(address), uint8_t(address >> 8)}; }
std::vector<uint8_t> lda(uint8_t value) { return {0xa9, value}; }
std::vector<uint8_t> operator+(std::vector<uint8_t> a, const std::vector<uint8_t>& b) {
  a.insert(a.end(), b.begin(), b.end());
  return a;
}

/** Voice 1 of the chip at `base`: frequency, sustain at full, the given control byte, volume 15. */
std::vector<uint8_t> voice(uint16_t base, uint16_t frequency, uint8_t control, uint8_t sustainRelease = 0xf0,
                           uint8_t modeVolume = 0x0f, uint8_t pulseHigh = 0x08) {
  return lda(uint8_t(frequency)) + sta(base) + lda(uint8_t(frequency >> 8)) + sta(base + 1) + lda(pulseHigh) +
         sta(base + 3) + lda(0x00) + sta(base + 5) + lda(sustainRelease) + sta(base + 6) + lda(control) +
         sta(base + 4) + lda(modeVolume) + sta(base + 0x18);
}

// ── running ─────────────────────────────────────────────────────────────────────────────────────

struct Session {
  std::unique_ptr<SidTune> tune;
  std::unique_ptr<libsidplayfp::Player> player;
  bool loaded = false;
  std::string error;
};

std::unique_ptr<Session> open(const std::vector<uint8_t>& file, unsigned song = 0, int rate = 48000,
                              SidConfig::sid_model_t fallback = SidConfig::MOS8580,
                              SidConfig::c64_model_t clock = SidConfig::PAL) {
  auto s = std::make_unique<Session>();
  s->tune = std::make_unique<SidTune>(file.data(), uint32_t(file.size()));
  if (!s->tune->getStatus()) {
    s->error = s->tune->statusString() ? s->tune->statusString() : "";
    return s;
  }
  s->tune->selectSong(song);
  s->player = std::make_unique<libsidplayfp::Player>();
  SidConfig cfg;
  cfg.frequency = uint32_t(rate);
  cfg.defaultSidModel = fallback;
  cfg.defaultC64Model = clock;
  if (!s->player->setConfig(cfg) || !s->player->loadTune(s->tune.get())) {
    s->error = s->player->error();
    return s;
  }
  s->loaded = true;
  return s;
}

struct Stereo {
  std::vector<float> left, right;
};

Stereo render(Session& s, double seconds, int rate = 48000, bool stereo = true) {
  Stereo out;
  const size_t frames = size_t(seconds * rate);
  out.left.resize(frames);
  if (stereo) out.right.resize(frames);
  size_t done = 0;
  while (done < frames) {
    const size_t want = std::min<size_t>(4800, frames - done);
    const auto got = s.player->play(std::span<float>(out.left.data() + done, want),
                                    stereo ? std::span<float>(out.right.data() + done, want) : std::span<float>(), {});
    if (got == 0) break;
    done += got;
  }
  out.left.resize(done);
  if (stereo) out.right.resize(done);
  return out;
}

std::array<uint8_t, 32> regs(Session& s, int chip = 0) {
  std::array<uint8_t, 32> r{};
  s.player->getSidStatus(chip, r.data());
  return r;
}

double rms(const std::vector<float>& x, size_t from = 0, size_t to = SIZE_MAX) {
  to = std::min(to, x.size());
  if (to <= from) return 0;
  double mean = 0;
  for (size_t i = from; i < to; ++i) mean += x[i];
  mean /= double(to - from);
  double sum = 0;
  for (size_t i = from; i < to; ++i) sum += (x[i] - mean) * (x[i] - mean);
  return std::sqrt(sum / double(to - from));
}

/** Fundamental from rising crossings of the mean, over the span given. */
double frequency(const std::vector<float>& x, int rate, size_t from, size_t to) {
  to = std::min(to, x.size());
  double mean = 0;
  for (size_t i = from; i < to; ++i) mean += x[i];
  mean /= double(to - from);
  long first = -1, last = -1, crossings = 0;
  for (size_t i = from + 1; i < to; ++i) {
    if (x[i - 1] < mean && x[i] >= mean) {
      if (first < 0) first = long(i);
      last = long(i);
      ++crossings;
    }
  }
  if (crossings < 2) return 0;
  return double(crossings - 1) * rate / double(last - first);
}

double highFrequencyRatio(const std::vector<float>& x, size_t from, size_t to) {
  double diff = 0, level = 0;
  for (size_t i = from + 1; i < std::min(to, x.size()); ++i) {
    diff += std::fabs(x[i] - x[i - 1]);
    level += std::fabs(x[i]);
  }
  return level > 0 ? diff / level : 0;
}

std::vector<uint8_t> readFile(const char* path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

void test(const char* name, const std::function<void()>& body) {
  currentTest = name;
  const int before = failures;
  body();
  std::printf("%s %s\n", failures == before ? "ok  " : "FAIL", name);
}

// ── the tests ───────────────────────────────────────────────────────────────────────────────────

void loaderTests() {
  test("parses a PSID v2 header: addresses, songs, clock, model, strings", [] {
    Psid p;
    p.songs = 5;
    p.start = 3;
    p.clock = ClockNtsc;
    p.model1 = Model6581;
    p.name = std::string(32, 'N');
    SidTune tune(p.bytes().data(), uint32_t(p.bytes().size()));
    CHECK(tune.getStatus());
    const auto* info = tune.getInfo();
    CHECK(info->loadAddr() == 0x1000);
    CHECK(info->initAddr() == 0x1000);
    CHECK(info->playAddr() == 0x1100);
    CHECK(info->songs() == 5);
    CHECK(info->startSong() == 3);
    CHECK(info->clockSpeed() == SidTuneInfo::CLOCK_NTSC);
    CHECK(info->sidModel(0) == SidTuneInfo::SIDMODEL_6581);
    CHECK(info->sidChips() == 1);
    CHECK(info->compatibility() == SidTuneInfo::COMPATIBILITY_C64);
    CHECK(std::string(info->infoString(0)) == std::string(32, 'N'));
    CHECK(std::string(info->infoString(1)) == "c64commander");
  });

  test("takes the load address from the header when the data does not carry it", [] {
    Psid p;
    p.loadAddressInData = false;
    p.load = 0x2000;
    p.init = 0x2000;
    p.play = 0x2100;
    SidTune tune(p.bytes().data(), uint32_t(p.bytes().size()));
    CHECK(tune.getStatus());
    CHECK(tune.getInfo()->loadAddr() == 0x2000);
  });

  test("a PSID v1 is PSID-specific and has no model or clock flags", [] {
    Psid p;
    p.version = 1;
    SidTune tune(p.bytes().data(), uint32_t(p.bytes().size()));
    CHECK(tune.getStatus());
    CHECK(tune.getInfo()->compatibility() == SidTuneInfo::COMPATIBILITY_PSID);
    CHECK(tune.getInfo()->clockSpeed() == SidTuneInfo::CLOCK_UNKNOWN);
  });

  test("reads the PSID-specific and BASIC flags for the format they belong to", [] {
    Psid psid;
    psid.flagBit1 = true;
    SidTune specific(psid.bytes().data(), uint32_t(psid.bytes().size()));
    CHECK(specific.getInfo()->compatibility() == SidTuneInfo::COMPATIBILITY_PSID);
    Psid rsid;
    rsid.magic = "RSID";
    rsid.play = 0;
    rsid.loadAddressInData = true;
    rsid.flagBit1 = true;
    // A BASIC tune is RUN rather than called, so it must not name an init address.
    rsid.init = 0;
    SidTune basic(rsid.bytes().data(), uint32_t(rsid.bytes().size()));
    CHECK(basic.getStatus());
    CHECK(basic.getStatus() && basic.getInfo()->compatibility() == SidTuneInfo::COMPATIBILITY_BASIC);
    rsid.init = 0x1000;
    SidTune named(rsid.bytes().data(), uint32_t(rsid.bytes().size()));
    CHECK(!named.getStatus());
  });

  test("places a second and third SID from v3 and v4 headers, with their own models", [] {
    Psid p;
    p.version = 4;
    p.sid2 = 0x42;
    p.sid3 = 0x50;
    p.model2 = Model6581;
    p.model3 = Model8580;
    SidTune tune(p.bytes().data(), uint32_t(p.bytes().size()));
    const auto* info = tune.getInfo();
    CHECK(info->sidChips() == 3);
    CHECK(info->sidChipBase(1) == 0xd420);
    CHECK(info->sidChipBase(2) == 0xd500);
    CHECK(info->sidModel(1) == SidTuneInfo::SIDMODEL_6581);
    CHECK(info->sidModel(2) == SidTuneInfo::SIDMODEL_8580);
  });

  test("ignores an extra SID at an invalid address, or a third at the second's address", [] {
    for (uint8_t bad : {uint8_t(0x43), uint8_t(0x40), uint8_t(0x90)}) {
      Psid p;
      p.version = 3;
      p.sid2 = bad;
      SidTune tune(p.bytes().data(), uint32_t(p.bytes().size()));
      CHECK(tune.getInfo()->sidChips() == 1);
    }
    Psid same;
    same.version = 4;
    same.sid2 = 0x42;
    same.sid3 = 0x42;
    SidTune tune(same.bytes().data(), uint32_t(same.bytes().size()));
    CHECK(tune.getInfo()->sidChips() == 2);
  });

  test("rejects what is not a valid SID file", [] {
    auto rejects = [](std::vector<uint8_t> bytes) {
      SidTune tune(bytes.data(), uint32_t(bytes.size()));
      return !tune.getStatus() && tune.statusString() != nullptr;
    };
    CHECK(rejects({}));
    CHECK(rejects({'P', 'S', 'I'}));
    Psid magic;
    magic.magic = "XSID";
    CHECK(rejects(magic.bytes()));
    Psid v5;
    v5.version = 5;
    CHECK(rejects(v5.bytes()));
    Psid rsidV1;
    rsidV1.magic = "RSID";
    rsidV1.version = 1;
    rsidV1.play = 0;
    CHECK(rejects(rsidV1.bytes()));
    Psid rsidPlay;
    rsidPlay.magic = "RSID";
    CHECK(rejects(rsidPlay.bytes()));
    Psid rsidSpeed;
    rsidSpeed.magic = "RSID";
    rsidSpeed.play = 0;
    rsidSpeed.speed = 1;
    CHECK(rejects(rsidSpeed.bytes()));
    Psid mus;
    mus.mus = true;
    CHECK(rejects(mus.bytes()));
    auto truncated = Psid().bytes();
    truncated.resize(0x40);
    CHECK(rejects(truncated));
  });

  test("refuses a tune that does not fit in the C64's 64 KiB", [] {
    Psid p;
    p.load = 0xff00;
    p.init = 0xff00;
    p.play = 0xff00;
    p.initCode = std::vector<uint8_t>(0x400, 0xea);
    auto s = open(p.bytes());
    CHECK(!s->loaded);
  });

  test("selects the start song for song 0 and for a song past the last", [] {
    Psid p;
    p.songs = 5;
    p.start = 3;
    SidTune tune(p.bytes().data(), uint32_t(p.bytes().size()));
    CHECK(tune.selectSong(0) == 3);
    CHECK(tune.selectSong(2) == 2);
    CHECK(tune.selectSong(9) == 3);
  });

  test("computes the HVSC MD5 fingerprints, old and new, the way the song-length database does", [] {
    const auto file = readFile(std::getenv("ENGINE_TEST_TONE_LADDER"));
    SidTune tune(file.data(), uint32_t(file.size()));
    CHECK(std::string(tune.createMD5New()) == "81df56c5ed0ce7fc87136461b3f3817f");
    CHECK(std::string(tune.createMD5()) == "b838a0ace6a4b10f7c88392525f9d1f5");
  });

  test("hashes RFC 1321's test vectors correctly", [] {
    auto md5 = [](const std::string& text) {
      MD5 m;
      m.append(reinterpret_cast<const uint8_t*>(text.data()), int(text.size()));
      m.finish();
      return std::string(m.getAscIIDigest());
    };
    CHECK(md5("") == "d41d8cd98f00b204e9800998ecf8427e");
    CHECK(md5("abc") == "900150983cd24fb0d6963f7d28e17f72");
    CHECK(md5("message digest") == "f96b697d7cb7938d525a2f31aaf161d0");
    CHECK(md5(std::string(1000, 'a')).size() == 32);
  });
}

void cpuTests() {
  test("init is called with the selected song in A", [] {
    Psid p;
    p.songs = 8;
    p.initCode = sta(0xd400) + std::vector<uint8_t>{0x60};
    for (unsigned song = 1; song <= 8; ++song) {
      auto s = open(p.bytes(), song);
      CHECK(s->loaded);
      render(*s, 0.05);
      CHECK(regs(*s)[0] == song - 1);
    }
  });

  test("runs 6510 arithmetic, addressing modes, the stack and an illegal opcode correctly", [] {
    Psid p;
    // $D400 decimal ADC $19+$28, $D401 decimal SBC $50-$01, $D402 binary ADC carry out, $D403
    // LDA ($FB),Y, $D405 LAX zp (illegal, used by real players), $D406 PHA/JSR/RTS/PLA, $D407 ASL/ROR.
    p.initCode = std::vector<uint8_t>{0xf8, 0x18, 0xa9, 0x19, 0x69, 0x28} + sta(0xd400) +
                 std::vector<uint8_t>{0x38, 0xa9, 0x50, 0xe9, 0x01, 0xd8} + sta(0xd401) +
                 std::vector<uint8_t>{0x18, 0xa9, 0xf0, 0x69, 0x20, 0xa9, 0x00, 0x2a} + sta(0xd402) +
                 std::vector<uint8_t>{0xa9, 0x80, 0x85, 0xfb, 0xa9, 0x10, 0x85, 0xfc, 0xa0, 0x03, 0xb1, 0xfb} +
                 sta(0xd403) + std::vector<uint8_t>{0xa9, 0x5a, 0x85, 0xfd, 0xa7, 0xfd} + stx(0xd405) +
                 std::vector<uint8_t>{0xa9, 0x33, 0x48, 0x20, 0x70, 0x10, 0x68} + sta(0xd406) +
                 std::vector<uint8_t>{0xa9, 0x81, 0x0a, 0x6a} + sta(0xd407) + std::vector<uint8_t>{0x60};
    p.initCode.resize(0x70, 0xea);
    p.initCode = p.initCode + std::vector<uint8_t>{0xa9, 0x44, 0x60}; // $1070: LDA #$44, RTS
    p.initCode.resize(0x80, 0xea);
    p.initCode = p.initCode + std::vector<uint8_t>{0x00, 0x00, 0x00, 0x77}; // $1080: the table
    auto s = open(p.bytes());
    CHECK(s->loaded);
    render(*s, 0.05);
    const auto r = regs(*s);
    CHECK(r[0] == 0x47);
    CHECK(r[1] == 0x49);
    CHECK(r[2] == 0x01);
    CHECK(r[3] == 0x77);
    CHECK(r[5] == 0x5a);
    CHECK(r[6] == 0x33);
    CHECK(r[7] == 0x81);
  });

  test("jams on an illegal KIL opcode, and stops producing audio", [] {
    Psid p;
    p.playCode = {0x02};
    auto s = open(p.bytes());
    CHECK(s->loaded);
    const auto out = render(*s, 1.0);
    CHECK(s->player->isJammed());
    CHECK(out.left.size() < 48000);
  });
}

/** Play routine that counts its calls in zero page and mirrors the count to $D401/$D402. */
const std::vector<uint8_t> kCountingPlay = {0xe6, 0xfb, 0xd0, 0x02, 0xe6, 0xfc, 0xa5, 0xfb, 0x8d, 0x01,
                                            0xd4, 0xa5, 0xfc, 0x8d, 0x02, 0xd4, 0x60};
const std::vector<uint8_t> kClearCounter = {0xa9, 0x00, 0x85, 0xfb, 0x85, 0xfc};

int playCalls(Session& s) {
  const auto r = regs(s);
  return r[1] | (r[2] << 8);
}

void timingTests() {
  test("calls play at the PAL frame rate", [] {
    Psid p;
    p.initCode = kClearCounter + std::vector<uint8_t>{0x60};
    p.playCode = kCountingPlay;
    auto s = open(p.bytes());
    render(*s, 4.0);
    CHECK_NEAR(playCalls(*s), 4.0 * kPalFrameRate, 2);
  });

  test("calls play at the NTSC frame rate for an NTSC tune", [] {
    Psid p;
    p.clock = ClockNtsc;
    p.initCode = kClearCounter + std::vector<uint8_t>{0x60};
    p.playCode = kCountingPlay;
    auto s = open(p.bytes());
    render(*s, 4.0);
    CHECK_NEAR(playCalls(*s), 4.0 * kNtscFrameRate, 2);
  });

  test("uses the configured C64 for a tune whose clock is unknown", [] {
    Psid p;
    p.clock = ClockUnknown;
    p.initCode = kClearCounter + std::vector<uint8_t>{0x60};
    p.playCode = kCountingPlay;
    auto ntsc = open(p.bytes(), 0, 48000, SidConfig::MOS8580, SidConfig::NTSC);
    render(*ntsc, 4.0);
    CHECK_NEAR(playCalls(*ntsc), 4.0 * kNtscFrameRate, 2);
  });

  test("calls play from CIA 1 timer A at 60 Hz for a song with the speed bit set", [] {
    Psid p;
    p.songs = 2;
    p.speed = 0x2; // song 2 on the CIA, song 1 on the VIC
    p.initCode = kClearCounter + std::vector<uint8_t>{0x60};
    p.playCode = kCountingPlay;
    auto vbi = open(p.bytes(), 1);
    auto cia = open(p.bytes(), 2);
    render(*vbi, 4.0);
    render(*cia, 4.0);
    CHECK_NEAR(playCalls(*vbi), 4.0 * kPalFrameRate, 2);
    CHECK_NEAR(playCalls(*cia), 4.0 * 60.0, 3);
  });

  test("follows a CIA timer the tune programs itself, as multispeed tunes do", [] {
    Psid p;
    p.speed = 0x1;
    constexpr uint16_t kLatch = 9852; // 100 Hz on PAL
    p.initCode = kClearCounter + lda(uint8_t(kLatch)) + sta(0xdc04) + lda(uint8_t(kLatch >> 8)) + sta(0xdc05) +
                 std::vector<uint8_t>{0x60};
    p.playCode = kCountingPlay;
    auto s = open(p.bytes());
    render(*s, 4.0);
    CHECK_NEAR(playCalls(*s), 4.0 * kPalClock / (kLatch + 1), 3);
  });
}

void sidTests() {
  constexpr uint16_t k440 = 7493; // 440 Hz on PAL: f = F · clock / 2^24

  test("plays the pitch the frequency register names, on PAL and NTSC, at any output rate", [] {
    for (const int rate : {22050, 44100, 48000, 96000}) {
      for (const auto clock : {ClockPal, ClockNtsc}) {
        Psid p;
        p.clock = clock;
        p.initCode = voice(0xd400, k440, 0x21) + std::vector<uint8_t>{0x60};
        auto s = open(p.bytes(), 0, rate);
        const auto out = render(*s, 1.0, rate);
        CHECK(out.left.size() == size_t(rate));
        const double expected = k440 * (clock == ClockPal ? kPalClock : kNtscClock) / 16777216.0;
        CHECK_NEAR(frequency(out.left, rate, rate / 4, out.left.size()), expected, expected * 0.003);
      }
    }
  });

  test("is silent at volume 0 and with the oscillator held by the test bit", [] {
    Psid loud;
    loud.initCode = voice(0xd400, k440, 0x21) + std::vector<uint8_t>{0x60};
    Psid muted;
    muted.initCode = voice(0xd400, k440, 0x21, 0xf0, 0x00) + std::vector<uint8_t>{0x60};
    Psid held;
    held.initCode = voice(0xd400, k440, 0x29) + std::vector<uint8_t>{0x60};
    auto a = open(loud.bytes());
    auto b = open(muted.bytes());
    auto c = open(held.bytes());
    const double reference = rms(render(*a, 1.0).left, 12000);
    CHECK(reference > 0.02);
    CHECK(rms(render(*b, 1.0).left, 12000) < reference * 0.01);
    CHECK(rms(render(*c, 1.0).left, 12000) < reference * 0.01);
  });

  test("holds a note at full sustain and lets it die with no sustain", [] {
    Psid held;
    held.initCode = voice(0xd400, k440, 0x21, 0xf0) + std::vector<uint8_t>{0x60};
    Psid decayed;
    decayed.initCode = voice(0xd400, k440, 0x21, 0x00) + std::vector<uint8_t>{0x60};
    auto a = open(held.bytes());
    auto b = open(decayed.bytes());
    const double sustain = rms(render(*a, 1.0).left, 24000);
    const double gone = rms(render(*b, 1.0).left, 24000);
    CHECK(sustain > 0.02);
    CHECK(gone < sustain * 0.02);
    CHECK(regs(*a)[0x1d] > 200);
    CHECK(regs(*b)[0x1d] < 10);
  });

  test("lets the low-pass filter take the top off noise, and only when the voice is routed to it", [] {
    auto noise = [](uint8_t routing, uint8_t modeVolume) {
      Psid p;
      p.model1 = Model8580;
      p.initCode = voice(0xd400, 0xffff, 0x81, 0xf0, modeVolume) + lda(0x00) + sta(0xd415) + lda(0x08) +
                   sta(0xd416) + lda(routing) + sta(0xd417) + std::vector<uint8_t>{0x60};
      return p.bytes();
    };
    auto dry = open(noise(0x00, 0x1f));
    auto wet = open(noise(0x01, 0x1f));
    const auto a = render(*dry, 1.0).left;
    const auto b = render(*wet, 1.0).left;
    CHECK(highFrequencyRatio(b, 12000, a.size()) < highFrequencyRatio(a, 12000, a.size()) * 0.5);
  });

  test("renders the same tune differently on a 6581 and an 8580, and each chip as its header says", [] {
    auto tone = [](Model model) {
      Psid p;
      p.model1 = model;
      p.initCode = voice(0xd400, 0x1000, 0x41) + std::vector<uint8_t>{0x60};
      return p.bytes();
    };
    auto a = open(tone(Model6581));
    auto b = open(tone(Model8580));
    CHECK(render(*a, 0.5).left != render(*b, 0.5).left);
    auto c = open(tone(ModelUnknown), 0, 48000, SidConfig::MOS6581);
    auto d = open(tone(Model6581), 0, 48000, SidConfig::MOS8580);
    CHECK(render(*c, 0.5).left == render(*d, 0.5).left);
  });
}

void mixerTests() {
  constexpr uint16_t k440 = 7493;

  test("puts the first SID on the left and the second on the right", [] {
    Psid p;
    p.version = 3;
    p.sid2 = 0x42;
    p.initCode = voice(0xd400, k440, 0x21) + std::vector<uint8_t>{0x60};
    auto s = open(p.bytes());
    CHECK(s->player->getNumChips() == 2);
    const auto out = render(*s, 1.0);
    CHECK(rms(out.left, 12000) > 0.02);
    CHECK(rms(out.right, 12000) < rms(out.left, 12000) * 0.01);
  });

  test("centres a third SID at -3 dB on both sides", [] {
    Psid single;
    single.initCode = voice(0xd400, k440, 0x21) + std::vector<uint8_t>{0x60};
    Psid three;
    three.version = 4;
    three.sid2 = 0x42;
    three.sid3 = 0x44;
    three.model2 = Model8580;
    three.model3 = Model8580;
    three.initCode = voice(0xd440, k440, 0x21) + lda(0x0f) + sta(0xd418) + lda(0x0f) + sta(0xd438) +
                     std::vector<uint8_t>{0x60};
    auto a = open(single.bytes());
    auto b = open(three.bytes());
    const double reference = rms(render(*a, 1.0).left, 12000);
    const auto out = render(*b, 1.0);
    CHECK_NEAR(rms(out.left, 12000) / reference, 0.708, 0.05);
    CHECK_NEAR(rms(out.right, 12000) / reference, 0.708, 0.05);
  });

  test("mirrors a single SID onto both channels, and sums chips into one for mono output", [] {
    Psid p;
    p.initCode = voice(0xd400, k440, 0x21) + std::vector<uint8_t>{0x60};
    auto s = open(p.bytes());
    const auto out = render(*s, 0.5);
    CHECK(out.left == out.right);
    Psid two;
    two.version = 3;
    two.sid2 = 0x42;
    two.initCode = voice(0xd400, k440, 0x21) + voice(0xd420, k440, 0x21) + std::vector<uint8_t>{0x60};
    auto m = open(two.bytes());
    const auto mono = render(*m, 1.0, 48000, false);
    CHECK(mono.right.empty());
    CHECK(rms(mono.left, 12000) > 1.5 * rms(render(*open(p.bytes()), 1.0).left, 12000));
  });
}

void lifecycleTests(const std::vector<uint8_t>& ladder) {
  test("renders deterministically: two players, and one player reloaded", [&] {
    auto a = open(ladder);
    auto b = open(ladder);
    const auto first = render(*a, 2.0).left;
    CHECK(render(*b, 2.0).left == first);
    a->player->loadTune(a->tune.get());
    CHECK(render(*a, 2.0).left == first);
  });

  test("restores a saved state into a freshly loaded player and carries on identically", [&] {
    auto a = open(ladder);
    render(*a, 1.0);
    std::vector<uint8_t> state;
    CHECK(a->player->saveState(state));
    CHECK(!state.empty());
    const auto expected = render(*a, 1.0).left;
    auto b = open(ladder);
    CHECK(b->player->restoreState(state));
    CHECK(render(*b, 1.0).left == expected);
    CHECK(!b->player->restoreState(std::span<const uint8_t>(state.data(), 8)));
  });

  test("refuses an output rate it cannot produce", [] {
    libsidplayfp::Player player;
    SidConfig cfg;
    cfg.frequency = 8000;
    CHECK(!player.setConfig(cfg));
    cfg.frequency = 200000;
    CHECK(!player.setConfig(cfg));
  });

  test("survives many players being created, used and destroyed", [&] {
    for (int i = 0; i < 30; ++i) {
      auto s = open(ladder, 0, i % 2 ? 44100 : 48000, i % 3 ? SidConfig::MOS8580 : SidConfig::MOS6581);
      CHECK(s->loaded);
      CHECK(render(*s, 0.02).left.size() > 0);
    }
  });
}

} // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: %s <tone-ladder.sid>\n", argv[0]);
    return 2;
  }
  std::setvbuf(stdout, nullptr, _IONBF, 0);
  setenv("ENGINE_TEST_TONE_LADDER", argv[1], 1);
  const auto ladder = readFile(argv[1]);
  if (ladder.empty()) return 2;
  loaderTests();
  cpuTests();
  timingTests();
  sidTests();
  mixerTests();
  lifecycleTests(ladder);
  std::printf("engine_test: %d checks, %d failed\n", checks, failures);
  return failures ? 1 : 0;
}
