# Shipping HearthHold: Ember Siege to the App Store and Google Play

HearthHold runs as a native iPhone, iPad and Android app through
[Capacitor](https://capacitorjs.com/) 8. [Capawesome Cloud](https://cloud.capawesome.io/)
builds and signs it, so nothing here needs a Mac, Xcode or Android Studio.

The setup follows Sawmill Calculator Pro and Lumen: Capacitor 8, the
`net.micapeak.*` id, signing files kept in the Capawesome console. Like Sawmill,
the Capacitor project is the whole repository (no `baseDir`).

## What is in the repo

| Path | What it is |
| --- | --- |
| `capacitor.config.json` | App id `net.micapeak.HearthHold`, home-screen name `HearthHold`, web folder `dist`, full-screen splash and status bar settings |
| `capawesome.config.json` | What Capawesome runs: `npm ci`, then `npm run app:sync && npm run version:ci` |
| `ios/`, `android/` | The native projects (committed). The bundled web game (`ios/App/App/public`, `android/app/src/main/assets/public`) is not committed; `cap sync` copies it in |
| `src/native.ts` | In the app only: hides the status bar, keeps the screen on, pauses when the app goes to the background, Android back button (pause / resume, leave from the menu) |
| `scripts/app-version.mjs` | Writes the version numbers into both projects (below) |
| `resources/` | `keep.svg` (the drawing), `icon.png` 1024², `splash.png` and `splash-dark.png` 2732² |

The game is the same build as the website (`npm run build`). Asset paths are
relative, the Lilita One font is bundled (no Google Fonts call), and the app
makes no network requests at all. Saves live in the app's own storage.

## Version numbers

- **The version people see** (1.0.0) is `version` in `package.json`. Bump it,
  commit and push before a release build:

  ```sh
  npm version patch --no-git-tag-version   # 1.0.0 → 1.0.1 (or minor / major)
  ```

- **The store build number** is Capawesome's `CI_BUILD_NUMBER`, which goes up
  with every cloud build, so each upload to TestFlight and Play is higher than
  the last.

`npm run version:ci` writes both into the projects at the end of the cloud web
build, before Xcode and Gradle read them: `MARKETING_VERSION` and
`CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj`, and
`versionName` and `versionCode` in `android/app/build.gradle`. Without a
`CI_BUILD_NUMBER` (a local run) the build number is 1. Run
`node scripts/app-version.mjs` to see what it would write.

This replaces capver here: capver needs a local Java install to edit the
Android project, and the version only lives in one place this way.

## Icons and splash

Already generated into both projects. To change them, edit
`resources/keep.svg`, render new PNGs over `resources/icon.png` (1024×1024, no
transparency) and `resources/splash.png` / `splash-dark.png` (2732×2732, keep
the artwork in the middle 1200 px), then:

```sh
npm run icons     # @capacitor/assets: every iOS and Android size, adaptive icons, splashes
```

## Signing files stay out of the repo

Never commit a keystore, a certificate or a provisioning profile. These are
gitignored: `*.keystore`, `*.jks`, `*.p12`, `*.mobileprovision`, `private.pem`.
Upload them in the Capawesome console; the build injects them.

## 1. Create the app in Capawesome Cloud

In [Capawesome Cloud](https://cloud.capawesome.io/), create an app:

- Name: `HearthHold: Ember Siege`
- App ID / bundle id: `net.micapeak.HearthHold`

Copy the Capawesome app id (a UUID) into `capawesome.config.json` in place of
`YOUR_CAPAWESOME_APP_ID`, commit and push.

## 2. Link the repository

In the app's settings, connect GitHub and choose `GrantErickson/HearthHold`,
branch `main`. Don't set a subdirectory. In the app's environment set
`NODE_VERSION` to `22` or `24` (Capacitor 8 needs 22+).

## 3. Android keystore

Once, on any machine with a JDK. Don't commit it.

```sh
keytool -genkey -v -keystore hearthold-release.keystore -alias hearthold -keyalg RSA -keysize 2048 -validity 10000
```

In the console, Signing certificates: Android, the keystore file, its
password, the alias (`hearthold`) and the key password. Keep the file and the
passwords somewhere safe: a lost keystore can't update the Play listing.

## 4. iOS certificate and provisioning profile

1. On [developer.apple.com](https://developer.apple.com/account/resources),
   Identifiers: register the App ID `net.micapeak.HearthHold`. No capabilities
   are needed.
2. Certificate: the Apple Distribution certificate you use for Lumen and
   Sawmill works here too (export it as a `.p12`). Or make a new one with the
   [iOS Certificate Generator](https://capawesome.io/tools/ios-certificate-generator/).
3. Profiles: an **App Store** provisioning profile for `net.micapeak.HearthHold`
   with that certificate. Download the `.mobileprovision`.

In the console, Signing certificates: iOS, the `.p12` (with its password) and
the `.mobileprovision`.

## 5. Build

From the console: the app, New build, iOS, Android or both.

Or from a terminal, with a token from the console (don't commit it):

```sh
npx @capawesome/cli login --token YOUR_TOKEN
npx @capawesome/cli apps:builds:create --appId YOUR_CAPAWESOME_APP_ID --platform android
npx @capawesome/cli apps:builds:create --appId YOUR_CAPAWESOME_APP_ID --platform ios
```

Turn on auto-build for `main` in the console if every push should build.

## 6. Publish

Download the `.aab` / `.ipa` from the build, or turn on store publishing in the
console to send builds to Play Console and App Store Connect / TestFlight.

Both stores still need the listing, screenshots and privacy answers. The store
name is **HearthHold: Ember Siege** (23 characters; both stores allow 30). On
the home screen the app is just **HearthHold** (`appName` in
`capacitor.config.json`, `CFBundleDisplayName` in `ios/App/App/Info.plist`,
`app_name` in `android/app/src/main/res/values/strings.xml`), because iOS cuts
longer names short under the icon. For the privacy questions: HearthHold has no account, no ads, no analytics and no
network access. It keeps its save on the device and collects nothing. The public privacy policy for the store listing is
<https://granterickson.github.io/HearthHold/privacy.html>. Category:
Games / Strategy. It plays in portrait and landscape, with touch controls (drag
anywhere to move, buttons for the abilities).

## Locally (optional)

```sh
npm run app:sync      # build the game and copy it into ios/ and android/
npm run app:android   # open Android Studio (needs it installed)
npm run app:ios       # open Xcode (Mac only)
```
