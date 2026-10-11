/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

#include <jni.h>

#include <atomic>
#include <cstdint>
#include <exception>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <vector>

#include "ez_session.h"
#include "session_handle.h"

using c64commander::EzSession;
using c64commander::SessionHandle;
using c64commander::EzSidModel;

namespace {

// Ids, not pointers, cross JNI: an id that has been destroyed is simply not found, where a stale
// pointer would be a use-after-free. The registry hands out shared ownership; see runLocked for
// what makes a call that races a destroy safe.
using Handle = SessionHandle;

std::mutex registryLock;
std::unordered_map<jlong, std::shared_ptr<Handle>> registry;
std::atomic<jlong> nextId{1};

std::shared_ptr<Handle> find(jlong id) {
  std::lock_guard<std::mutex> guard(registryLock);
  const auto it = registry.find(id);
  return it == registry.end() ? nullptr : it->second;
}

jstring toJString(JNIEnv* env, const std::string& value) { return env->NewStringUTF(value.c_str()); }

std::vector<uint8_t> copyBytes(JNIEnv* env, jbyteArray array) {
  std::vector<uint8_t> out;
  if (!array) return out;
  const jsize length = env->GetArrayLength(array);
  out.resize(static_cast<size_t>(length));
  if (length > 0) env->GetByteArrayRegion(array, 0, length, reinterpret_cast<jbyte*>(out.data()));
  return out;
}

void throwIllegalState(JNIEnv* env, const char* message) {
  jclass type = env->FindClass("java/lang/IllegalStateException");
  if (type) env->ThrowNew(type, message);
}

/** Run `body` against a live session, translating every C++ failure into a Java exception. */
template <typename Result, typename Body>
Result withSession(JNIEnv* env, jlong id, Result fallback, Body body) {
  const auto handle = find(id);
  if (!handle) {
    throwIllegalState(env, "libSidplayEZ session has been destroyed");
    return fallback;
  }
  try {
    return c64commander::runLocked(
        *handle,
        [&] {
          throwIllegalState(env, "libSidplayEZ session has been destroyed");
          return fallback;
        },
        [&](EzSession& session) -> Result { return body(session); });
  } catch (const std::exception& error) {
    throwIllegalState(env, error.what());
  } catch (...) {
    throwIllegalState(env, "libSidplayEZ raised a non-standard exception");
  }
  return fallback;
}

} // namespace

#define JNI_FN(name) Java_uk_gleissner_c64commander_sidplayez_SidplayEzNative_##name

extern "C" {

JNIEXPORT jboolean JNICALL JNI_FN(nativeCpuSupported)(JNIEnv*, jobject) {
  return c64commander::cpuSupported() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jstring JNICALL JNI_FN(nativeAbi)(JNIEnv* env, jobject) {
  return toJString(env, c64commander::libraryAbi());
}

JNIEXPORT jstring JNICALL JNI_FN(nativeRevision)(JNIEnv* env, jobject) {
  return toJString(env, c64commander::libraryRevision());
}

JNIEXPORT jlong JNICALL JNI_FN(nativeCreate)(JNIEnv* env, jobject, jint sampleRate) {
  if (!c64commander::cpuSupported()) {
    throwIllegalState(env, "This CPU lacks SSE4.1, which the x86 libSidplayEZ build requires");
    return 0;
  }
  try {
    auto handle = std::make_shared<Handle>();
    handle->session = std::make_unique<EzSession>(sampleRate);
    const jlong id = nextId.fetch_add(1);
    std::lock_guard<std::mutex> guard(registryLock);
    registry.emplace(id, std::move(handle));
    return id;
  } catch (const std::exception& error) {
    throwIllegalState(env, error.what());
  } catch (...) {
    throwIllegalState(env, "libSidplayEZ session could not be created");
  }
  return 0;
}

JNIEXPORT void JNICALL JNI_FN(nativeDestroy)(JNIEnv*, jobject, jlong id) {
  std::shared_ptr<Handle> handle;
  {
    std::lock_guard<std::mutex> guard(registryLock);
    const auto it = registry.find(id);
    if (it == registry.end()) return;
    handle = std::move(it->second);
    registry.erase(it);
  }
  // Waits for a call already inside the session, then frees it with nobody else able to reach it.
  std::lock_guard<std::mutex> guard(handle->lock);
  handle->session.reset();
}

JNIEXPORT jint JNICALL JNI_FN(nativeLiveSessions)(JNIEnv*, jobject) {
  std::lock_guard<std::mutex> guard(registryLock);
  return static_cast<jint>(registry.size());
}

JNIEXPORT void JNICALL JNI_FN(nativeSetRoms)(JNIEnv* env, jobject, jlong id, jbyteArray kernal, jbyteArray basic,
                                            jbyteArray chargen) {
  withSession<int>(env, id, 0, [&](EzSession& session) {
    const auto k = copyBytes(env, kernal);
    const auto b = copyBytes(env, basic);
    const auto c = copyBytes(env, chargen);
    session.setRoms(k.empty() ? nullptr : k.data(), k.size(), b.empty() ? nullptr : b.data(), b.size(),
                    c.empty() ? nullptr : c.data(), c.size());
    return 0;
  });
}

JNIEXPORT jstring JNICALL JNI_FN(nativeLoad)(JNIEnv* env, jobject, jlong id, jbyteArray sid, jint songIndex,
                                            jint fallbackModel) {
  return withSession<jstring>(env, id, nullptr, [&](EzSession& session) -> jstring {
    const auto bytes = copyBytes(env, sid);
    std::string error;
    const auto model = fallbackModel == 0 ? EzSidModel::Mos6581 : EzSidModel::Mos8580;
    if (session.load(bytes.data(), bytes.size(), songIndex, model, error)) return nullptr;
    return toJString(env, error.empty() ? "libSidplayEZ could not load the tune" : error);
  });
}

JNIEXPORT jstring JNICALL JNI_FN(nativeReload)(JNIEnv* env, jobject, jlong id) {
  return withSession<jstring>(env, id, nullptr, [&](EzSession& session) -> jstring {
    std::string error;
    if (session.reload(error)) return nullptr;
    return toJString(env, error.empty() ? "libSidplayEZ could not reload the tune" : error);
  });
}

/**
 * Render into `out` (interleaved stereo S16LE) at `offsetBytes`.
 *
 * Rendered into the session's own scratch and copied out with one SetByteArrayRegion, rather than
 * written through GetPrimitiveArrayCritical: a render takes tens of milliseconds, and holding a
 * critical section that long stalls the garbage collector for the whole app.
 */
JNIEXPORT jint JNICALL JNI_FN(nativeRender)(JNIEnv* env, jobject, jlong id, jbyteArray out, jint offsetBytes,
                                           jint frames) {
  if (!out || frames <= 0 || offsetBytes < 0) {
    throwIllegalState(env, "Invalid render target");
    return 0;
  }
  const jlong capacity = env->GetArrayLength(out);
  const jlong needed = static_cast<jlong>(offsetBytes) + static_cast<jlong>(frames) * EzSession::kChannels * 2;
  if (needed > capacity) {
    throwIllegalState(env, "Render target is too small for the request");
    return 0;
  }
  return withSession<jint>(env, id, 0, [&](EzSession& session) {
    std::vector<int16_t> scratch(static_cast<size_t>(frames) * EzSession::kChannels);
    const jint produced = session.render(scratch.data(), frames);
    if (produced > 0) {
      env->SetByteArrayRegion(out, offsetBytes, produced * EzSession::kChannels * 2,
                              reinterpret_cast<const jbyte*>(scratch.data()));
    }
    return produced;
  });
}

/**
 * Render straight into a direct ByteBuffer (interleaved stereo S16LE) at `offsetBytes`.
 *
 * The PCM store keeps its blocks off the Java heap, so this writes them in place: no scratch and no
 * copy, where `nativeRender` needs both.
 */
JNIEXPORT jint JNICALL JNI_FN(nativeRenderDirect)(JNIEnv* env, jobject, jlong id, jobject out, jint offsetBytes,
                                                 jint frames) {
  auto* base = out ? static_cast<uint8_t*>(env->GetDirectBufferAddress(out)) : nullptr;
  if (!base || frames <= 0 || offsetBytes < 0 || offsetBytes % (EzSession::kChannels * 2) != 0) {
    throwIllegalState(env, "Invalid direct render target");
    return 0;
  }
  const jlong capacity = env->GetDirectBufferCapacity(out);
  const jlong needed = static_cast<jlong>(offsetBytes) + static_cast<jlong>(frames) * EzSession::kChannels * 2;
  if (capacity < 0 || needed > capacity) {
    throwIllegalState(env, "Direct render target is too small for the request");
    return 0;
  }
  auto* target = reinterpret_cast<int16_t*>(base + offsetBytes);
  return withSession<jint>(env, id, 0, [&](EzSession& session) { return session.render(target, frames); });
}

JNIEXPORT jlong JNICALL JNI_FN(nativeSkip)(JNIEnv* env, jobject, jlong id, jlong frames) {
  return withSession<jlong>(env, id, 0, [&](EzSession& session) { return session.skip(frames, nullptr); });
}

JNIEXPORT jstring JNICALL JNI_FN(nativeTuneInfo)(JNIEnv* env, jobject, jlong id) {
  return withSession<jstring>(env, id, nullptr,
                              [&](EzSession& session) { return toJString(env, session.tuneInfoJson()); });
}

JNIEXPORT jint JNICALL JNI_FN(nativeChips)(JNIEnv* env, jobject, jlong id) {
  return withSession<jint>(env, id, 0, [&](EzSession& session) { return session.chips(); });
}

JNIEXPORT jint JNICALL JNI_FN(nativeSampleRate)(JNIEnv* env, jobject, jlong id) {
  return withSession<jint>(env, id, 0, [&](EzSession& session) { return session.sampleRate(); });
}

JNIEXPORT jint JNICALL JNI_FN(nativeSongIndex)(JNIEnv* env, jobject, jlong id) {
  return withSession<jint>(env, id, 0, [&](EzSession& session) { return session.songIndex(); });
}

} // extern "C"
