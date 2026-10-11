/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Compiled with the ABI's baseline flags, unlike the engine: on 32-bit x86 the engine is built with
// SSE4.1, so the check that decides whether it may run at all must not itself need SSE4.1.

#include "ez_session.h"

#if defined(__i386__)
#include <cpuid.h>
#endif

#define C64C_STRINGIFY_(value) #value
#define C64C_STRINGIFY(value) C64C_STRINGIFY_(value)
#ifdef C64C_SIDPLAYEZ_REVISION
#define C64C_SIDPLAYEZ_REVISION_TEXT C64C_STRINGIFY(C64C_SIDPLAYEZ_REVISION)
#else
#define C64C_SIDPLAYEZ_REVISION_TEXT "unknown"
#endif

namespace c64commander {

bool cpuSupported() {
#if defined(__i386__)
  unsigned eax = 0, ebx = 0, ecx = 0, edx = 0;
  if (!__get_cpuid(1, &eax, &ebx, &ecx, &edx)) return false;
  return (ecx & bit_SSE4_1) != 0;
#else
  return true;
#endif
}

const char* libraryRevision() { return C64C_SIDPLAYEZ_REVISION_TEXT; }

} // namespace c64commander
