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

/** How the session places a tune's chips in stereo; see `chooseStereoPlacement`. */
enum class StereoPlacement { AsRendered, BlendTwo, CentreThree };

/**
 * reSIDfp's placement for two or three chips, unless the tune names a side for each chip itself.
 * Four chips or more are a libSidplayEZ extension reSIDfp cannot play, so they keep its placement.
 */
StereoPlacement chooseStereoPlacement(int chips, bool tunePlacesChips);

/**
 * libSidplayEZ's analogue model settings. The defaults bring its output closest to reSIDfp's in
 * libsidplayfp-wasm, the app's "Accurate" renderer: they were chosen by a parameter sweep against
 * reSIDfp renders of the 6581 probe tunes, the demo tunes and eight HVSC tunes (see "Equivalence
 * of the renderers" in docs/internals/sid-playback-architecture.md). Where a parameter made no
 * measurable difference it keeps libSidplayEZ's neutral value.
 */
struct AnalogueProfile {
  double uCox = 20.0;
  bool oldCap = false;
  double filter6581Curve = 0.5;
  double filter6581Gain = 1.0;
  double filter6581Saturation = 1.0;
  double filter6581Resonance = 1.0;
  double waveDCOffset = 1.5;
  double extInDC = 1.0;
  double voiceDCBias = 0.0;
  double leakageRate = 1.0;
  double voiceDCDrift = 0.0;
  double dacLeakage = 0.01;
  double externalFilterOhms = 10e3;
  /**
   * The 8580's EXT IN level, which makes volume-register samples audible. reSIDfp in
   * libsidplayfp-wasm turns this on (digiBoost, -32768); libSidplayEZ scales the input
   * differently, and -16700 gives the same loudness on the digi-8580 probe tune.
   */
  int externalInput8580 = -16700;
  /**
   * libSidplayEZ's start-up declick, which until a tune's first note silences the steps its volume
   * and filter writes make. Off: reSIDfp and the C64 play those steps, and the declick also
   * silences a slow volume-register effect for up to 15 s when a tune never gates a voice.
   */
  bool startupDeclick = false;
};

/**
 * One libSidplayEZ player and the tune it has open.
 *
 * Built on `libsidplayfp::Player` rather than the `libsidplayEZ::Player` facade. The facade forces
 * a 6581 default for undeclared chips and picks chip profiles from the tune's file path, so its
 * output depends on host-supplied CSV data. Here the fallback chip comes from the app's setting and
 * the analogue parameters come from `AnalogueProfile`, chosen to match reSIDfp.
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

  /** Analogue settings for the tunes loaded from now on, and for the open one. */
  void setProfile(const AnalogueProfile& profile);
  const AnalogueProfile& profile() const { return profile_; }
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
  void applyProfile();

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
  StereoPlacement stereoPlacement_ = StereoPlacement::AsRendered;
  AnalogueProfile profile_;
  bool ready_ = false;
};

/**
 * Place two chips in stereo the way reSIDfp's libsidplayfp mixer does, in place: each side carries
 * its own chip and half of the other, scaled by 1/sqrt(2). libSidplayEZ pans them hard left and
 * right, which made a 2SID tune sound different depending on the renderer chosen. Expects the left
 * buffer to hold the first chip and the right one the second, as libSidplayEZ renders them.
 */
void blendTwoChipStereo(float* left, float* right, int frames);

/**
 * Three chips from libSidplayEZ's mono mix, the same on both sides at the level of reSIDfp's mix.
 * reSIDfp puts the chips left, centre and right with half of each outer one on the far side, so its
 * two sides correlate at about 0.97; libSidplayEZ puts the first two hard left and right with the
 * third in the middle, and its sides cannot be remixed into reSIDfp's. The gain of 0.5 gives three
 * uncorrelated chips the power reSIDfp gives each side.
 */
void centreThreeChipMix(float* mono, float* right, int frames);

/** Saturating float-to-S16 conversion, matching libSidplayEZ's own 1/32768 scale. */
int16_t floatToS16(float value);

/** Whether this CPU can run the library as compiled; false only on x86 without SSE4.1. */
bool cpuSupported();

/** The pinned libSidplayEZ commit, injected by the build script. */
const char* libraryRevision();

} // namespace c64commander
