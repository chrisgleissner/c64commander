/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

#include "ez_session.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <span>

#include "player.h"
#include "sidplayfp/SidConfig.h"
#include "sidplayfp/SidTune.h"
#include "sidplayfp/SidTuneInfo.h"
#include "stringutils.h"

namespace c64commander {

namespace {

// libSidplayEZ's own defaults for a tune no chip profile matches (ChipProfileSelector::settings),
// applied in the order the facade applies them in libsidplayEZ::Player::setTuneNumber.
constexpr double kNeutralUCox = 20.0;
constexpr bool kNeutralOldCap = false;
constexpr double kNeutralFilterCurve = 0.4;
constexpr double kNeutralFilterGain = 0.92;
constexpr double kNeutralSaturation = 1.0;
constexpr double kNeutralResonance = 1.0;
constexpr double kNeutralWaveDC = 0.5;
constexpr double kNeutralExtInDC = 1.0;
constexpr double kNeutralVoiceBias = 0.0;
constexpr double kNeutralLeakageRate = 1.0;
constexpr double kNeutralVoiceDrift = 0.0;
constexpr float kNeutralCombinedThreshold = 1.0f;

/** Frames rendered per play() call while skipping; small enough to check for cancellation often. */
constexpr int kSkipBlockFrames = 4800;

void appendJsonString(std::string& out, const std::string& value) {
  out += '"';
  for (const unsigned char c : value) {
    switch (c) {
    case '"':
      out += "\\\"";
      break;
    case '\\':
      out += "\\\\";
      break;
    case '\n':
      out += "\\n";
      break;
    case '\r':
      out += "\\r";
      break;
    case '\t':
      out += "\\t";
      break;
    default:
      if (c < 0x20) {
        char escaped[8];
        std::snprintf(escaped, sizeof(escaped), "\\u%04x", c);
        out += escaped;
      } else {
        out += static_cast<char>(c);
      }
    }
  }
  out += '"';
}

const char* clockName(SidTuneInfo::clock_t clock) {
  switch (clock) {
  case SidTuneInfo::CLOCK_PAL:
    return "PAL";
  case SidTuneInfo::CLOCK_NTSC:
    return "NTSC";
  case SidTuneInfo::CLOCK_ANY:
    return "ANY";
  default:
    return "UNKNOWN";
  }
}

const char* modelName(SidTuneInfo::model_t model) {
  switch (model) {
  case SidTuneInfo::SIDMODEL_6581:
    return "MOS6581";
  case SidTuneInfo::SIDMODEL_8580:
    return "MOS8580";
  case SidTuneInfo::SIDMODEL_ANY:
    return "ANY";
  default:
    return "UNKNOWN";
  }
}

const char* compatibilityName(SidTuneInfo::compatibility_t compatibility) {
  switch (compatibility) {
  case SidTuneInfo::COMPATIBILITY_PSID:
    return "PSID";
  case SidTuneInfo::COMPATIBILITY_R64:
    return "R64";
  case SidTuneInfo::COMPATIBILITY_BASIC:
    return "BASIC";
  default:
    return "C64";
  }
}

void assignRom(std::vector<uint8_t>& target, const uint8_t* data, size_t length, size_t expected) {
  if (data && length == expected) {
    target.assign(data, data + length);
  } else {
    target.clear();
  }
}

const uint8_t* romOrNull(const std::vector<uint8_t>& rom) { return rom.empty() ? nullptr : rom.data(); }

} // namespace

int16_t floatToS16(float value) {
  const float scaled = value * 32768.0f;
  if (!(scaled > -32768.0f)) return -32768;
  if (scaled >= 32767.0f) return 32767;
  return static_cast<int16_t>(std::lrintf(scaled));
}

EzSession::EzSession(int sampleRate)
    : sampleRate_(std::clamp(sampleRate, kMinSampleRate, kMaxSampleRate)),
      player_(std::make_unique<libsidplayfp::Player>()) {}

EzSession::~EzSession() = default;

void EzSession::setRoms(const uint8_t* kernal, size_t kernalLen, const uint8_t* basic, size_t basicLen,
                        const uint8_t* chargen, size_t chargenLen) {
  assignRom(kernal_, kernal, kernalLen, kKernalBytes);
  assignRom(basic_, basic, basicLen, kBasicBytes);
  assignRom(chargen_, chargen, chargenLen, kChargenBytes);
}

bool EzSession::load(const uint8_t* data, size_t length, int songIndex, EzSidModel fallbackModel, std::string& error) {
  ready_ = false;
  if (!data || length < 4 || length > kMaxSidBytes) {
    error = "Not a SID file (size " + std::to_string(length) + " bytes)";
    return false;
  }
  sidBytes_.assign(data, data + length);
  fallbackModel_ = fallbackModel;
  songIndex_ = std::max(0, songIndex);
  return reload(error);
}

bool EzSession::reload(std::string& error) {
  ready_ = false;
  if (sidBytes_.empty()) {
    error = "No tune has been loaded";
    return false;
  }
  // The player keeps a pointer to the tune, so it is detached before the old tune is destroyed.
  player_->loadTune(nullptr);
  tune_ = std::make_unique<SidTune>(sidBytes_.data(), static_cast<uint32_t>(sidBytes_.size()));
  if (!tune_->getStatus()) {
    error = tune_->statusString() ? tune_->statusString() : "The SID file could not be parsed";
    tune_.reset();
    return false;
  }
  const SidTuneInfo* info = tune_->getInfo();
  const unsigned songs = info ? std::max(1u, info->songs()) : 1u;
  const unsigned song = std::min<unsigned>(static_cast<unsigned>(songIndex_) + 1u, songs);
  songIndex_ = static_cast<int>(song) - 1;
  tune_->selectSong(song);

  player_->setKernal(romOrNull(kernal_));
  player_->setBasic(romOrNull(basic_));
  player_->setChargen(romOrNull(chargen_));

  SidConfig config;
  config.frequency = static_cast<uint32_t>(sampleRate_);
  config.defaultC64Model = SidConfig::PAL;
  config.forceC64Model = false;
  config.defaultSidModel = fallbackModel_ == EzSidModel::Mos6581 ? SidConfig::MOS6581 : SidConfig::MOS8580;
  config.forceSidModel = false;
  config.useFilter = true;
  if (!player_->setConfig(config)) {
    error = player_->error();
    return false;
  }
  if (!player_->loadTune(tune_.get())) {
    error = player_->error();
    player_->loadTune(nullptr);
    tune_.reset();
    return false;
  }
  applyNeutralProfile();
  ready_ = true;
  return true;
}

void EzSession::applyNeutralProfile() {
  player_->set6581Filter_uCoxAndCap(kNeutralUCox, kNeutralOldCap);
  player_->set6581FilterCurve(kNeutralFilterCurve);
  player_->set6581FilterGain(kNeutralFilterGain);
  player_->set6581FilterSaturation(kNeutralSaturation);
  player_->set6581FilterResonance(kNeutralResonance);
  player_->set6581WaveDCOffset(kNeutralWaveDC);
  player_->set6581ExtInDC(kNeutralExtInDC);
  player_->set6581VoiceDCBias(kNeutralVoiceBias);
  player_->set6581LeakageRate(kNeutralLeakageRate);
  player_->set6581VoiceDCDrift(kNeutralVoiceDrift);
  player_->set6581CombinedWaveforms(reSIDfp::CombinedWaveforms::AVERAGE, kNeutralCombinedThreshold);
  player_->set6581SawPulseUltra(false);
}

int EzSession::render(int16_t* out, int frames) {
  if (!ready_ || !out || frames <= 0 || player_->isJammed()) return 0;
  if (left_.size() < static_cast<size_t>(frames)) {
    left_.resize(frames);
    right_.resize(frames);
  }
  const auto produced = static_cast<int>(player_->play(std::span<float>(left_.data(), frames),
                                                       std::span<float>(right_.data(), frames), {}));
  const int count = std::clamp(produced, 0, frames);
  for (int i = 0; i < count; ++i) {
    out[i * 2] = floatToS16(left_[i]);
    out[i * 2 + 1] = floatToS16(right_[i]);
  }
  return count;
}

int64_t EzSession::skip(int64_t frames, const std::atomic<bool>* cancel) {
  if (!ready_ || frames <= 0) return 0;
  std::vector<int16_t> scratch(static_cast<size_t>(kSkipBlockFrames) * kChannels);
  int64_t skipped = 0;
  while (skipped < frames) {
    if (cancel && cancel->load(std::memory_order_relaxed)) break;
    const int want = static_cast<int>(std::min<int64_t>(kSkipBlockFrames, frames - skipped));
    const int got = render(scratch.data(), want);
    if (got <= 0) break;
    skipped += got;
  }
  return skipped;
}

int EzSession::chips() const { return ready_ ? player_->getNumChips() : 0; }

std::string EzSession::tuneInfoJson() const {
  if (!ready_ || !tune_) return "null";
  const SidTuneInfo* info = tune_->getInfo();
  if (!info) return "null";
  std::string out = "{";
  auto number = [&out](const char* key, long long value, bool comma = true) {
    out += '"';
    out += key;
    out += "\":";
    out += std::to_string(value);
    if (comma) out += ',';
  };
  auto text = [&out](const char* key, const std::string& value) {
    out += '"';
    out += key;
    out += "\":";
    appendJsonString(out, value);
    out += ',';
  };
  number("songs", info->songs());
  number("startSong", info->startSong());
  number("currentSong", info->currentSong());
  number("loadAddress", info->loadAddr());
  number("initAddress", info->initAddr());
  number("playAddress", info->playAddr());
  number("c64dataLen", info->c64dataLen());
  number("songSpeed", info->songSpeed());
  number("sidChips", info->sidChips());
  text("clock", clockName(info->clockSpeed()));
  text("format", info->formatString() ? info->formatString() : "");
  text("compatibility", compatibilityName(info->compatibility()));
  out += "\"sidChipBases\":[";
  for (int i = 0; i < info->sidChips(); ++i) {
    if (i) out += ',';
    out += std::to_string(info->sidChipBase(static_cast<unsigned>(i)));
  }
  out += "],\"sidModels\":[";
  for (int i = 0; i < info->sidChips(); ++i) {
    if (i) out += ',';
    appendJsonString(out, modelName(info->sidModel(static_cast<unsigned>(i))));
  }
  out += "],\"infoStrings\":[";
  for (unsigned i = 0; i < info->numberOfInfoStrings(); ++i) {
    if (i) out += ',';
    const char* raw = info->infoString(i);
    appendJsonString(out, raw ? stringutils::extendedASCIItoUTF8(raw) : std::string());
  }
  out += "],\"engine\":\"libSidplayEZ\",\"revision\":";
  appendJsonString(out, libraryRevision());
  out += '}';
  return out;
}

} // namespace c64commander
