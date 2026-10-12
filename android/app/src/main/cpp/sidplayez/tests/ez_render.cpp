/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Renders a tune through the same EzSession the app uses, for the cross-engine comparison in
// tools/sid-engines. Writes interleaved stereo S16LE to <out.raw> and a JSON summary to stdout.
//
//   ez_render <tune.sid> <songIndex> <seconds> <sampleRate> <6581|8580> <out.raw> [kernal basic chargen]
//
// EZ_PROFILE overrides analogue settings for parameter studies, e.g.
// EZ_PROFILE="filter6581Curve=0.5,filter6581Gain=1.0".

#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <algorithm>
#include <fstream>
#include <iterator>
#include <string>
#include <vector>

#include "ez_session.h"

using c64commander::AnalogueProfile;
using c64commander::EzSession;
using c64commander::EzSidModel;

static bool applyOverride(AnalogueProfile& p, const std::string& key, double v) {
  struct Field {
    const char* name;
    double AnalogueProfile::*member;
  };
  static const Field fields[] = {
      {"uCox", &AnalogueProfile::uCox},
      {"filter6581Curve", &AnalogueProfile::filter6581Curve},
      {"filter6581Gain", &AnalogueProfile::filter6581Gain},
      {"filter6581Saturation", &AnalogueProfile::filter6581Saturation},
      {"filter6581Resonance", &AnalogueProfile::filter6581Resonance},
      {"waveDCOffset", &AnalogueProfile::waveDCOffset},
      {"extInDC", &AnalogueProfile::extInDC},
      {"voiceDCBias", &AnalogueProfile::voiceDCBias},
      {"leakageRate", &AnalogueProfile::leakageRate},
      {"voiceDCDrift", &AnalogueProfile::voiceDCDrift},
      {"dacLeakage", &AnalogueProfile::dacLeakage},
      {"externalFilterOhms", &AnalogueProfile::externalFilterOhms},
  };
  if (key == "oldCap") {
    p.oldCap = v != 0;
    return true;
  }
  if (key == "startupDeclick") {
    p.startupDeclick = v != 0;
    return true;
  }
  if (key == "externalInput8580") {
    p.externalInput8580 = static_cast<int>(v);
    return true;
  }
  for (const auto& field : fields) {
    if (key == field.name) {
      p.*field.member = v;
      return true;
    }
  }
  return false;
}

static bool parseProfile(const char* text, AnalogueProfile& profile) {
  std::string spec(text);
  size_t start = 0;
  while (start < spec.size()) {
    const size_t end = std::min(spec.find(',', start), spec.size());
    const std::string item = spec.substr(start, end - start);
    const size_t eq = item.find('=');
    if (eq == std::string::npos || !applyOverride(profile, item.substr(0, eq), std::atof(item.c_str() + eq + 1))) {
      std::fprintf(stderr, "bad EZ_PROFILE item: %s\n", item.c_str());
      return false;
    }
    start = end + 1;
  }
  return true;
}

static std::vector<uint8_t> readFile(const char* path) {
  std::ifstream in(path, std::ios::binary);
  return {std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>()};
}

int main(int argc, char** argv) {
  if (argc != 7 && argc != 10) {
    std::fprintf(stderr, "usage: %s <tune.sid> <songIndex> <seconds> <sampleRate> <6581|8580> <out.raw> "
                         "[kernal basic chargen]\n",
                 argv[0]);
    return 2;
  }
  const auto tune = readFile(argv[1]);
  const int song = std::atoi(argv[2]);
  const double seconds = std::atof(argv[3]);
  const int rate = std::atoi(argv[4]);
  const auto model = std::string(argv[5]) == "6581" ? EzSidModel::Mos6581 : EzSidModel::Mos8580;

  const auto created = std::chrono::steady_clock::now();
  EzSession session(rate);
  if (const char* spec = std::getenv("EZ_PROFILE")) {
    AnalogueProfile profile = session.profile();
    if (!parseProfile(spec, profile)) return 2;
    session.setProfile(profile);
  }
  const auto constructed = std::chrono::steady_clock::now();
  if (argc == 10) {
    const auto k = readFile(argv[7]), b = readFile(argv[8]), c = readFile(argv[9]);
    session.setRoms(k.data(), k.size(), b.data(), b.size(), c.data(), c.size());
  }
  std::string error;
  if (!session.load(tune.data(), tune.size(), song, model, error)) {
    std::fprintf(stderr, "load failed: %s\n", error.c_str());
    return 1;
  }
  const auto loaded = std::chrono::steady_clock::now();
  const int frames = static_cast<int>(seconds * session.sampleRate());
  std::vector<int16_t> pcm(static_cast<size_t>(frames) * 2);
  int done = 0;
  while (done < frames) {
    const int got = session.render(pcm.data() + static_cast<size_t>(done) * 2, std::min(24000, frames - done));
    if (got <= 0) break;
    done += got;
  }
  const auto rendered = std::chrono::steady_clock::now();
  std::ofstream out(argv[6], std::ios::binary);
  out.write(reinterpret_cast<const char*>(pcm.data()), static_cast<std::streamsize>(done) * 4);
  auto ms = [](auto a, auto b) { return std::chrono::duration<double, std::milli>(b - a).count(); };
  std::printf("{\"engine\":\"sidplayez\",\"frames\":%d,\"sampleRate\":%d,\"channels\":2,\"constructMs\":%.3f,"
              "\"loadMs\":%.3f,\"renderMs\":%.3f,\"chips\":%d,\"tuneInfo\":%s}\n",
              done, session.sampleRate(), ms(created, constructed), ms(constructed, loaded), ms(loaded, rendered),
              session.chips(), session.tuneInfoJson().c_str());
  return 0;
}
