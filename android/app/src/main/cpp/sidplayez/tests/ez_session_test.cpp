/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Host tests for the libSidplayEZ session wrapper, built three times by build-libsidplayez.sh:
// plain, with AddressSanitizer + UBSan, and with ThreadSanitizer. Usage: ez_session_test <tone-ladder.sid>

#include <algorithm>
#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iterator>
#include <limits>
#include <string>
#include <thread>
#include <vector>

#include "ez_session.h"

using c64commander::EzSession;
using c64commander::EzSidModel;

namespace {

int failures = 0;

#define CHECK(condition)                                                                                               \
  do {                                                                                                                 \
    if (!(condition)) {                                                                                                \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #condition);                             \
      ++failures;                                                                                                      \
    }                                                                                                                  \
  } while (0)

constexpr int kRate = 48000;

std::vector<uint8_t> readFile(const char* path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

void put16(std::vector<uint8_t>& v, size_t at, uint16_t value) {
  v[at] = static_cast<uint8_t>(value >> 8);
  v[at + 1] = static_cast<uint8_t>(value & 0xff);
}

enum class Model { Unknown = 0, M6581 = 1, M8580 = 2 };

/**
 * A minimal PSID: init plays a sawtooth on voice 1 whose pitch depends on the song number in A, on
 * the first SID and (when `secondSid` is set) a square wave on the second SID; play does nothing.
 */
std::vector<uint8_t> makePsid(uint16_t songs, Model model, uint8_t secondSid = 0, bool rsid = false) {
  std::vector<uint8_t> v(0x7c, 0);
  std::memcpy(v.data(), rsid ? "RSID" : "PSID", 4);
  put16(v, 4, secondSid ? 3 : 2);
  put16(v, 6, 0x7c);
  put16(v, 8, 0);       // load address comes from the data
  put16(v, 10, 0x1000); // init
  put16(v, 12, rsid ? 0 : 0x1040); // play
  put16(v, 14, songs);
  put16(v, 16, 1);
  std::memcpy(v.data() + 0x16, "ez session test", 15);
  v[0x77] = static_cast<uint8_t>((static_cast<int>(model) << 4) | 0x04); // PAL
  v[0x7a] = secondSid;
  std::vector<uint8_t> code = {
      0x00, 0x10,             // load address $1000
      0x18, 0x69, 0x10,       // CLC; ADC #$10      pitch high byte from the song number
      0x8d, 0x01, 0xd4,       // STA $D401
      0xa9, 0x00, 0x8d, 0x00, 0xd4, // LDA #0; STA $D400
      0xa9, 0x00, 0x8d, 0x05, 0xd4, // AD
      0xa9, 0xf0, 0x8d, 0x06, 0xd4, // SR
      0xa9, 0x21, 0x8d, 0x04, 0xd4, // saw + gate
      0xa9, 0x0f, 0x8d, 0x18, 0xd4, // volume
  };
  if (secondSid) {
    const uint8_t hi = static_cast<uint8_t>(0xd0 | (secondSid >> 4));
    const uint8_t lo = static_cast<uint8_t>(secondSid << 4);
    const std::vector<uint8_t> second = {
        0xa9, 0x08, 0x8d, static_cast<uint8_t>(lo + 0x03), hi, // pulse width high
        0xa9, 0x30, 0x8d, static_cast<uint8_t>(lo + 0x01), hi, // pitch
        0xa9, 0x00, 0x8d, static_cast<uint8_t>(lo + 0x05), hi,
        0xa9, 0xf0, 0x8d, static_cast<uint8_t>(lo + 0x06), hi,
        0xa9, 0x41, 0x8d, static_cast<uint8_t>(lo + 0x04), hi, // pulse + gate
        0xa9, 0x0f, 0x8d, static_cast<uint8_t>(lo + 0x18), hi,
    };
    code.insert(code.end(), second.begin(), second.end());
  }
  if (rsid) {
    code.push_back(0x4c); // JMP * : an RSID whose init never returns is legal
    const uint16_t self = static_cast<uint16_t>(0x1000 + code.size() - 3);
    code.push_back(static_cast<uint8_t>(self & 0xff));
    code.push_back(static_cast<uint8_t>(self >> 8));
  } else {
    code.push_back(0x60); // RTS
  }
  while (code.size() < 2 + 0x40) code.push_back(0xea);
  code.push_back(0x60); // play at $1040: RTS
  v.insert(v.end(), code.begin(), code.end());
  return v;
}

std::vector<int16_t> renderSeconds(EzSession& session, double seconds) {
  const int frames = static_cast<int>(seconds * session.sampleRate());
  std::vector<int16_t> out(static_cast<size_t>(frames) * EzSession::kChannels);
  int done = 0;
  while (done < frames) {
    const int got = session.render(out.data() + static_cast<size_t>(done) * 2, std::min(4800, frames - done));
    if (got <= 0) break;
    done += got;
  }
  out.resize(static_cast<size_t>(done) * 2);
  return out;
}

int peakToPeak(const std::vector<int16_t>& pcm, size_t channel) {
  int lo = 0, hi = 0;
  for (size_t i = channel; i < pcm.size(); i += 2) {
    lo = std::min<int>(lo, pcm[i]);
    hi = std::max<int>(hi, pcm[i]);
  }
  return hi - lo;
}

void testConversion() {
  CHECK(c64commander::floatToS16(0.0f) == 0);
  CHECK(c64commander::floatToS16(1.0f) == 32767);
  CHECK(c64commander::floatToS16(-1.0f) == -32768);
  CHECK(c64commander::floatToS16(4.0f) == 32767);
  CHECK(c64commander::floatToS16(-4.0f) == -32768);
  CHECK(c64commander::floatToS16(0.5f) == 16384);
  CHECK(c64commander::floatToS16(1000.0f / 32768.0f) == 1000);
  CHECK(c64commander::floatToS16(std::numeric_limits<float>::quiet_NaN()) == -32768 ||
        c64commander::floatToS16(std::numeric_limits<float>::quiet_NaN()) == 0);
}

void testRejectsInvalidInput() {
  EzSession session(kRate);
  std::string error;
  CHECK(!session.load(nullptr, 0, 0, EzSidModel::Mos8580, error));
  CHECK(!error.empty());
  const uint8_t garbage[64] = {1, 2, 3, 4};
  error.clear();
  CHECK(!session.load(garbage, sizeof garbage, 0, EzSidModel::Mos8580, error));
  CHECK(!error.empty());
  std::vector<uint8_t> huge(EzSession::kMaxSidBytes + 1, 0);
  CHECK(!session.load(huge.data(), huge.size(), 0, EzSidModel::Mos8580, error));
  CHECK(!session.hasTune());
  int16_t out[16] = {};
  CHECK(session.render(out, 8) == 0);
  CHECK(session.render(nullptr, 8) == 0);
  CHECK(session.skip(1000, nullptr) == 0);
  CHECK(session.tuneInfoJson() == "null");
  std::string reloadError;
  CHECK(!session.reload(reloadError));
}

void testToneLadder(const std::vector<uint8_t>& ladder) {
  EzSession session(kRate);
  std::string error;
  CHECK(session.load(ladder.data(), ladder.size(), 0, EzSidModel::Mos8580, error));
  CHECK(session.chips() == 1);
  const auto pcm = renderSeconds(session, 2.0);
  CHECK(pcm.size() == static_cast<size_t>(2 * kRate * 2));
  CHECK(peakToPeak(pcm, 0) > 1000);
  // One SID in a stereo output is mirrored onto both channels.
  bool same = true;
  for (size_t i = 0; i < pcm.size(); i += 2) same = same && pcm[i] == pcm[i + 1];
  CHECK(same);
  const auto info = session.tuneInfoJson();
  CHECK(info.find("\"songs\":1") != std::string::npos);
  CHECK(info.find("\"engine\":\"libSidplayEZ\"") != std::string::npos);

  // Deterministic: a second session and a reload both reproduce the same samples.
  EzSession other(kRate);
  CHECK(other.load(ladder.data(), ladder.size(), 0, EzSidModel::Mos8580, error));
  CHECK(renderSeconds(other, 2.0) == pcm);
  CHECK(session.reload(error));
  CHECK(renderSeconds(session, 2.0) == pcm);

  // Skipping is rendering with the output thrown away, so a skip followed by a render matches
  // the same span of a straight render.
  CHECK(session.reload(error));
  CHECK(session.skip(kRate, nullptr) == kRate);
  const auto tail = renderSeconds(session, 1.0);
  CHECK(std::equal(tail.begin(), tail.end(), pcm.begin() + kRate * 2));

  std::atomic<bool> cancel{true};
  CHECK(session.skip(kRate, &cancel) == 0);
}

void testSubsongsAndClamp() {
  const auto tune = makePsid(3, Model::M8580);
  std::string error;
  EzSession a(kRate), b(kRate), c(kRate);
  CHECK(a.load(tune.data(), tune.size(), 0, EzSidModel::Mos8580, error));
  CHECK(b.load(tune.data(), tune.size(), 2, EzSidModel::Mos8580, error));
  CHECK(c.load(tune.data(), tune.size(), 99, EzSidModel::Mos8580, error));
  CHECK(a.songIndex() == 0);
  CHECK(b.songIndex() == 2);
  CHECK(c.songIndex() == 2);
  const auto first = renderSeconds(a, 0.5);
  const auto third = renderSeconds(b, 0.5);
  CHECK(peakToPeak(first, 0) > 1000);
  CHECK(first != third);
  CHECK(renderSeconds(c, 0.5) == third);
  CHECK(a.tuneInfoJson().find("\"currentSong\":1") != std::string::npos);
  CHECK(b.tuneInfoJson().find("\"currentSong\":3") != std::string::npos);
}

void testFallbackModelIsNotForced() {
  std::string error;
  const auto undeclared = makePsid(1, Model::Unknown);
  EzSession u6581(kRate), u8580(kRate);
  CHECK(u6581.load(undeclared.data(), undeclared.size(), 0, EzSidModel::Mos6581, error));
  CHECK(u8580.load(undeclared.data(), undeclared.size(), 0, EzSidModel::Mos8580, error));
  CHECK(renderSeconds(u6581, 0.5) != renderSeconds(u8580, 0.5));

  const auto declared = makePsid(1, Model::M8580);
  EzSession d6581(kRate), d8580(kRate);
  CHECK(d6581.load(declared.data(), declared.size(), 0, EzSidModel::Mos6581, error));
  CHECK(d8580.load(declared.data(), declared.size(), 0, EzSidModel::Mos8580, error));
  CHECK(renderSeconds(d6581, 0.5) == renderSeconds(d8580, 0.5));
}

void testTwoSids() {
  const auto tune = makePsid(1, Model::M8580, 0x42);
  EzSession session(kRate);
  std::string error;
  CHECK(session.load(tune.data(), tune.size(), 0, EzSidModel::Mos8580, error));
  CHECK(session.chips() == 2);
  const auto pcm = renderSeconds(session, 0.5);
  CHECK(peakToPeak(pcm, 0) > 1000);
  CHECK(peakToPeak(pcm, 1) > 1000);
  bool differs = false;
  for (size_t i = 0; i < pcm.size() && !differs; i += 2) differs = pcm[i] != pcm[i + 1];
  CHECK(differs);
  CHECK(session.tuneInfoJson().find("\"sidChipBases\":[54272,54304]") != std::string::npos);
}

void testRsidWithEndlessInit() {
  const auto tune = makePsid(1, Model::M6581, 0, true);
  EzSession session(kRate);
  std::string error;
  CHECK(session.load(tune.data(), tune.size(), 0, EzSidModel::Mos8580, error));
  CHECK(peakToPeak(renderSeconds(session, 0.5), 0) > 1000);
}

void testRomsAreValidatedBySize() {
  EzSession session(kRate);
  std::vector<uint8_t> kernal(EzSession::kKernalBytes, 0xea), shortBasic(100, 0);
  session.setRoms(kernal.data(), kernal.size(), shortBasic.data(), shortBasic.size(), nullptr, 0);
  const auto tune = makePsid(1, Model::M8580);
  std::string error;
  CHECK(session.load(tune.data(), tune.size(), 0, EzSidModel::Mos8580, error));
}

void testConcurrentIndependentSessions(const std::vector<uint8_t>& ladder) {
  EzSession reference(kRate);
  std::string error;
  CHECK(reference.load(ladder.data(), ladder.size(), 0, EzSidModel::Mos8580, error));
  const auto expected = renderSeconds(reference, 1.0);
  constexpr int kThreads = 4;
  std::vector<std::vector<int16_t>> results(kThreads);
  std::vector<std::thread> threads;
  for (int t = 0; t < kThreads; ++t) {
    threads.emplace_back([&, t] {
      for (int round = 0; round < 3; ++round) {
        EzSession session(kRate);
        std::string threadError;
        if (!session.load(ladder.data(), ladder.size(), 0, EzSidModel::Mos8580, threadError)) return;
        results[t] = renderSeconds(session, 1.0);
      }
    });
  }
  for (auto& thread : threads) thread.join();
  for (const auto& result : results) CHECK(result == expected);
}

void testRepeatedCreateAndDestroy(const std::vector<uint8_t>& ladder) {
  for (int i = 0; i < 20; ++i) {
    EzSession session(i % 2 ? 44100 : kRate);
    std::string error;
    CHECK(session.load(ladder.data(), ladder.size(), 0, EzSidModel::Mos6581, error));
    int16_t out[2 * 256];
    CHECK(session.render(out, 256) == 256);
  }
}

void testSampleRateIsClamped() {
  EzSession low(100), high(1'000'000);
  CHECK(low.sampleRate() == EzSession::kMinSampleRate);
  CHECK(high.sampleRate() == EzSession::kMaxSampleRate);
}

} // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::fprintf(stderr, "usage: %s <tone-ladder.sid>\n", argv[0]);
    return 2;
  }
  const auto ladder = readFile(argv[1]);
  if (ladder.empty()) {
    std::fprintf(stderr, "could not read %s\n", argv[1]);
    return 2;
  }
  testConversion();
  testRejectsInvalidInput();
  testToneLadder(ladder);
  testSubsongsAndClamp();
  testFallbackModelIsNotForced();
  testTwoSids();
  testRsidWithEndlessInit();
  testRomsAreValidatedBySize();
  testConcurrentIndependentSessions(ladder);
  testRepeatedCreateAndDestroy(ladder);
  testSampleRateIsClamped();
  if (failures) {
    std::fprintf(stderr, "%d check(s) failed\n", failures);
    return 1;
  }
  std::printf("ez_session_test: all checks passed (revision %s)\n", c64commander::libraryRevision());
  return 0;
}
