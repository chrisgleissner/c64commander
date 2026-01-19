# Third-Party Notices

This project includes third-party components. The notices below are provided to comply with their license requirements.

## AndroidP7zip (P7ZipApi)

Project: <https://github.com/hzy3774/AndroidP7zip>
License: See project repository (AAR distributed via JitPack). AndroidP7zip wraps the 7-Zip/p7zip libraries.

## 7-Zip / p7zip

7-Zip Copyright (C) 1999-2020 Igor Pavlov.

The licenses for files are:

1) 7z.dll:
   - The “GNU LGPL” as main license for most of the code
   - The “GNU LGPL” with “unRAR license restriction” for some code
   - The “BSD 3-clause License” for some code
2) All other files: the “GNU LGPL”.

Redistributions in binary form must reproduce related license information from this file.

## GNU LGPL information

This library is free software; you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation; either version 2.1 of the License, or (at your option) any later version.

This library is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.

You can receive a copy of the GNU Lesser General Public License from <https://www.gnu.org/>.

## BSD 3-clause License

The “BSD 3-clause License” is used for the code in 7z.dll that implements LZFSE data decompression. That code was derived from the “LZFSE compression library” developed by Apple Inc, which also uses the “BSD 3-clause License”.

## unRAR license restriction

The decompression engine for RAR archives was developed using source code of unRAR program. All copyrights to original unRAR code are owned by Alexander Roshal.

The license for original unRAR code has the following restriction:
The unRAR sources cannot be used to re-create the RAR compression algorithm, which is proprietary. Distribution of modified unRAR sources in separate form or as a part of other software is permitted, provided that it is clearly stated in the documentation and source comments that the code may not be used to develop a RAR (WinRAR) compatible archiver.

## Other bundled dependencies

The Android APK bundles additional open-source components. Notable runtime components include:

- Capacitor Android runtime and Cordova bridge (MIT) via `@capacitor/android` and `:capacitor-cordova-android-plugins`.
- AndroidX libraries (Apache-2.0): `appcompat`, `coordinatorlayout`, `core-splashscreen`, `documentfile`.
- Kotlin standard library (Apache-2.0) via the Kotlin Android plugin.
- React + React DOM (MIT) and other npm dependencies compiled into the web bundle.

The full list of JavaScript dependencies is tracked in package.json and package-lock.json. Android runtime dependencies are declared in android/app/build.gradle.
