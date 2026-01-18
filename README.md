# C64 Commander

> [!NOTE]
> Experimental: this project is under active development and may change rapidly.

## What This Is

C64 Commander is an Android app that connects to a C64 Ultimate device on your local network:

- Browse and edit the entire C64U config
- Quick access to key settings (SID, VIC, CPU, drives) and device actions.

## Run it in Android Emulator

```sh
./scripts/android-emulator.sh
```

This command installs missing prerequisites, builds the app, starts an emulator, installs the APK, and launches it.

## Build the Android APK

```sh
npm run android:apk
```

You can then find the APK at

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Screenshots

![Home](doc/img/app-home.png)
![Quick Settings](doc/img/app-quick-settings.png)
![Configuration](doc/img/app-configuration.png)
![U64 Specific](doc/img/app-configuration-u64-specific.png)
![Documentation](doc/img/app-documentation.png)
![Settings](doc/img/app-settings.png)
