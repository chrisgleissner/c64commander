/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

#pragma once

#include <atomic>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

class SidTune;

namespace libsidplayfp {
class Player;
}

namespace c64commander {

/** Fallback chip for a tune whose header says UNKNOWN or ANY; never forced over a declared model. */
enum class EzSidModel : int { Mos6581 = 0, Mos8580 = 1 };

/**
 * One libSidplayEZ player and the tune it has open.
 *
 * Built on `libsidplayfp::Player` rather than the `libsidplayEZ::Player` facade. The facade forces
 * a 6581 default for undeclared chips and picks chip profiles from the tune's file path, so its
 * output depends on host-supplied CSV data. Here the fallback chip comes from the app's setting and
 * the 6581 analogue parameters are the facade's own defaults for an unprofiled tune.
 *
 * Not thread-safe. The JNI layer gives every session its own lock and the Kotlin layer runs each
 * session on one thread.
 */
class EzSession final {
public:
  static constexpr int kChannels = 2;
  static constexpr int kMinSampleRate = 11025;
  static constexpr int kMaxSampleRate = 192000;
  static constexpr size_t kKernalBytes = 8192;
  static constexpr size_t kBasicBytes = 8192;
  static constexpr size_t kChargenBytes = 4096;
  /** PSID/RSID files are at most a 64 KiB C64 image plus a header; anything bigger is not a tune. */
  static constexpr size_t kMaxSidBytes = 0x10000 + 0x7c + 2;

  explicit EzSession(int sampleRate);
  ~EzSession();

  EzSession(const EzSession&) = delete;
  EzSession& operator=(const EzSession&) = delete;

  int sampleRate() const { return sampleRate_; }

  /** Copy the ROM images; null or wrongly sized images clear that ROM. Takes effect on the next load. */
  void setRoms(const uint8_t* kernal, size_t kernalLen, const uint8_t* basic, size_t basicLen, const uint8_t* chargen,
               size_t chargenLen);

  /**
   * Parse a PSID/RSID and initialise `songIndex` (zero-based, clamped to the tune's song count).
   * Returns false with `error` set; the session then has no tune.
   */
  bool load(const uint8_t* data, size_t length, int songIndex, EzSidModel fallbackModel, std::string& error);

  /** Reload the current tune at its start, as a seek back to zero needs. */
  bool reload(std::string& error);

  bool hasTune() const { return ready_; }

  /**
   * Render up to `frames` interleaved stereo S16 frames into `out`. Returns the frames produced:
   * fewer than asked only when the CPU has jammed, zero once it has.
   */
  int render(int16_t* out, int frames);

  /** Render and discard `frames`, checking `cancel` between blocks. Returns the frames skipped. */
  int64_t skip(int64_t frames, const std::atomic<bool>* cancel);

  /** The open tune's metadata as a JSON object, or "null". */
  std::string tuneInfoJson() const;

  int songIndex() const { return songIndex_; }
  int chips() const;

private:
  void applyNeutralProfile();

  const int sampleRate_;
  std::unique_ptr<libsidplayfp::Player> player_;
  std::unique_ptr<SidTune> tune_;
  std::vector<uint8_t> sidBytes_;
  std::vector<uint8_t> kernal_;
  std::vector<uint8_t> basic_;
  std::vector<uint8_t> chargen_;
  std::vector<float> left_;
  std::vector<float> right_;
  EzSidModel fallbackModel_ = EzSidModel::Mos8580;
  int songIndex_ = 0;
  bool ready_ = false;
};

/** Saturating float-to-S16 conversion, matching libSidplayEZ's own 1/32768 scale. */
int16_t floatToS16(float value);

/** Whether this CPU can run the library as compiled; false only on x86 without SSE4.1. */
bool cpuSupported();

/** The pinned libSidplayEZ commit, injected by the build script. */
const char* libraryRevision();

} // namespace c64commander
