# Shipping HearthHold with Capawesome Cloud

The iPhone, iPad, and Android app is this repository. Capawesome Cloud builds and signs it. Nothing in this path needs a Mac or Android Studio on your machine.

This follows [Lumen](https://github.com/GrantErickson/lumen) and [Sawmill Calculator Pro](https://github.com/GrantErickson/SawmillCalculator2): Capacitor 8, `@capawesome/capver`, and Capawesome Cloud for the store binaries. Sawmill's Capacitor project is the whole repository, and so is HearthHold. Lumen's is one package in a pnpm workspace, so Lumen sets `baseDir` and installs with pnpm. This repo does not.

## What the cloud build runs

Capawesome reads [`capawesome.config.json`](../capawesome.config.json) from the **git root**, the same place Sawmill keeps it. There is no `baseDir`. Install and the web build run here:

- install: `npm ci` (the lockfile is committed; Sawmill's config says `npm install`, Lumen uses `pnpm install --frozen-lockfile`)
- web build: `npm run cap:sync && npm run version:ci`. `cap:sync` type-checks, runs `vite build` into `dist/`, and runs `cap sync`. `version:ci` then writes the store build number (below) before the iOS and Android compiles

`dist` is `webDir` in [`capacitor.config.json`](../capacitor.config.json). It is gitignored. The cloud build produces it, then `cap sync` copies it into the native projects. Those copies (`ios/App/App/public`, `android/app/src/main/assets/public`) are gitignored too.

Node 24 is the default on Capawesome's current stack and is what this repo requires (`.nvmrc`, `engines` in `package.json`). In the app's environment in the console, set `NODE_VERSION` to `24` so a different stack cannot pick 22. There is no `packageManager` field. The install command is npm, same as Sawmill. The GitHub Pages workflow also uses Node 24. That workflow only publishes the website. It does not build the native apps.

There is no GitHub Actions workflow for the native build. Lumen and Sawmill have none either. Capawesome builds when you start one.

The Android project keeps native libraries uncompressed and page-aligned (`useLegacyPackaging = false` in `android/app/build.gradle`), the same as Lumen and Sawmill, so 16 KB page devices can load them. HearthHold has no extra native plugins, so it does not add the Kotlin Gradle plugin Lumen needs for Bonjour.

## Version

The marketing version (what people read: 1.0.0) is what you commit. That is the version already in `package.json`. Capawesome does not bump it. The store build number is different. Nothing of HearthHold has shipped yet, so the floor is 10000. Capawesome sets `CI_BUILD_NUMBER` for each cloud build. The number that reaches TestFlight and Play is **10000 + CI_BUILD_NUMBER**. A build with no number stays at 10000. That is the local fallback too: Xcode or Gradle on a machine with the variable unset still produces 10000. A value that is not a whole number stays at 10000 in the project files, and the iOS build then stops rather than writing a blank `CFBundleVersion`.

`version:ci` is the step that writes it. Capawesome runs it at the end of the web build, before `xcodebuild` and Gradle read the projects:

- iOS: every `CURRENT_PROJECT_VERSION` in `ios/App/App.xcodeproj/project.pbxproj` (that is `CFBundleVersion`)
- Android: `versionCode` in `android/app/build.gradle`

The same script is `scripts/store-build-number.mjs`. It refuses to write a number that is not a whole number of at least 10000, so a blank cannot land in either project. An Xcode run script phase, "Set store build number" (`ios/set-store-build-number.sh`), adds `CI_BUILD_NUMBER` to 10000 in the shell and sets `CFBundleVersion` on the built Info.plist when that file is already there. The phase is shell arithmetic, so the number still exists when Xcode's PATH has no node. With no `CI_BUILD_NUMBER` it leaves the project's version alone. Android has no second step: Gradle reads the `versionCode` `version:ci` wrote. The write in `version:ci` is what the compile itself reads when the plist is not there yet. `versionName` and `MARKETING_VERSION` stay on the marketing version.

From the repo root:

```bash
npm run version:ci        # write 10000 + CI_BUILD_NUMBER into the iOS project and the Android build
npm run version:get       # marketing version. With the 10000 floor committed, capver reports package.json; it decodes iOS and Android once a version bump has written its own build numbers
npm run version:patch     # 1.0.0 → 1.0.1, and capver's own build numbers
npm run version:minor
npm run version:major
npm run version:set -- 1.1.0
npm run version:sync      # write the highest version back into every platform
npm test                  # the store-build-number checks
```

Commit a marketing-version bump and push before starting a build. `version:patch` also writes capver's build numbers into the project. The cloud build's `version:ci` replaces those with 10000 + `CI_BUILD_NUMBER` in the build workspace only, so the uploaded number stays above 10000. These are the same capver commands Sawmill uses, plus `version:ci`.

## The game inside the WebView

`vite.config.ts` already sets `base: './'`, so the built script, stylesheet, and the bundled font are relative. That works on GitHub Pages and under `capacitor://localhost` (iOS) and `https://localhost` (Android). The display font is Lilita One, bundled with `@fontsource/lilita-one` (SIL Open Font License). The page does not request Google Fonts.

Movement is a pointer drag on the canvas (`touch-action: none`), the same joystick as in the browser. Ability buttons, the pause button, and the menus are HTML and sit above the canvas. Sound starts on the first tap, which is the gesture WebKit requires.

The HUD already padded for `env(safe-area-inset-*)`. Capacitor on Android writes the same insets as `--safe-area-inset-*` custom properties, because older WebViews leave `env()` at zero while the page draws under the status bar. The stylesheet uses the property when it is set, and `env()` otherwise. `ios.contentInset` is `never`, and the System Bars plugin is told the viewport fit is `cover`, matching the viewport meta tag. Menus use the same insets, so a notch or the home indicator does not cover the panel.

The game has no locked orientation. iPhone allows portrait and both landscapes. iPad allows all four. Android does not set `screenOrientation`, and the activity keeps its WebView across rotation. The camera zooms for a narrow screen, and the HUD stacks under 720px wide.

Progress stays in `localStorage` on the device. There is no account, no analytics, and no ads.

## Icons and splash

There is no source image in the repo (the browser tab icon is an emoji). The iOS and Android projects keep Capacitor's default icon and splash. A cloud build does not regenerate them. To replace them later, add `resources/icon.png` (1024×1024, no transparency) and optionally `resources/splash.png`, then from the repo root:

```bash
npx @capacitor/assets generate --ios --android --iconBackgroundColor '#2b4f3a' --iconBackgroundColorDark '#2b4f3a' --splashBackgroundColor '#9fd3f0' --splashBackgroundColorDark '#9fd3f0'
```

Commit the generated images. The home-screen name is **HearthHold**. The wordmark inside the game is still "Hearthold", which is what the page already said.

## Signing files stay out of the repo

Do not commit a keystore, a certificate, or a provisioning profile. These names are gitignored:

- `*.keystore`
- `*.jks`
- `*.p12`
- `*.mobileprovision`
- `private.pem`

Upload them in the Capawesome console. The build injects them. That is the same as Lumen and Sawmill.

## Live updates

Live updates are not set up. Sawmill's plan can ship them, but the Sawmill repo does not install `@capawesome/capacitor-live-update` or set a `LiveUpdate` block. Lumen matches that, and so does HearthHold. The game in the binary is the game that was built.

## 1. Create the app

In [Capawesome Cloud](https://cloud.capawesome.io/), create an app:

- Name: `HearthHold` (the App Store and home-screen name)
- App ID: `net.micapeak.HearthHold` (the bundle id and application id, the same id in `capacitor.config.json`, the Xcode project, and `android/app/build.gradle`)

The repo does not already define a bundle id, so `net.micapeak.HearthHold` follows Lumen's `net.micapeak.Lumen`. Change it in those three places before the first store upload if you want a different id. The Capawesome App ID in the root [`capawesome.config.json`](../capawesome.config.json) is the placeholder `YOUR_CAPAWESOME_APP_ID`. Replace it with the UUID the console shows after you create the app. Sawmill still has that same placeholder. Lumen's is filled in.

## 2. Link the repository

In the app's settings, connect GitHub and choose this repository. Leave the branch as `main` once this work is merged, or point a build at another branch from the new-build screen. Do not set a subdirectory in the console. There is no `baseDir`.

In the app's environment, set `NODE_VERSION` to `24`.

## 3. Android keystore

Create a keystore once, on any machine with a JDK. Do not commit it.

```bash
keytool -genkey -v -keystore hearthhold-release.keystore -alias hearthhold -keyalg RSA -keysize 2048 -validity 10000
```

In the console, Signing certificates, add one:

- Platform: Android
- Keystore file: `hearthhold-release.keystore`
- Keystore password, key alias (`hearthhold`), and key password

Keep the file and the passwords. A lost keystore cannot update the Play listing.

## 4. iOS certificate and provisioning profile

An Apple Developer account. No Mac.

1. Identifiers, on [developer.apple.com](https://developer.apple.com/account/resources): App ID `net.micapeak.HearthHold`. The game does not use the local network, Bonjour, the camera, or the microphone, so it adds no usage strings.
2. Certificate: open the [iOS Certificate Generator](https://capawesome.io/tools/ios-certificate-generator/). It makes the CSR and the `.p12` in the browser. The private key stays on that machine. Upload the CSR under Certificates in the Apple portal, choose Apple Distribution, download the `.cer`, and bring it back to the generator to get the `.p12`. If you can still export the Sawmill or Lumen distribution certificate as a `.p12`, that file works here too. This App ID still needs its own provisioning profile.
3. Profiles: an App Store profile for `net.micapeak.HearthHold` that includes that certificate. Download the `.mobileprovision`.

In the console, Signing certificates, add the `.p12` (with its password) and the `.mobileprovision`. The profile's bundle id must be `net.micapeak.HearthHold`.

`ITSAppUsesNonExemptEncryption` is false. The game does not implement its own encryption.

## 5. Trigger a build

Commit the version and the Capawesome app id, and push.

From the console: the app, New build, pick iOS, Android, or both, and start it.

Or, from anywhere, with a token from the console (do not commit the token):

```bash
npx @capawesome/cli login --token YOUR_TOKEN
npx @capawesome/cli apps:builds:create --appId YOUR_CAPAWESOME_APP_ID --platform android
npx @capawesome/cli apps:builds:create --appId YOUR_CAPAWESOME_APP_ID --platform ios
```

`YOUR_CAPAWESOME_APP_ID` is the UUID from the console, the same value as `appId` in `capawesome.config.json`. It is not the bundle id.

Turn on auto-build for `main` in the console if a push should start a build, the same switch Sawmill documents.

The build installs with npm, runs `npm run cap:sync` and `npm run version:ci`, then compiles and signs on Capawesome's Macs.

## 6. Publish

Download the `.aab` or `.ipa` from the build, or turn on store publishing in the console to send it to Play Console or App Store Connect / TestFlight.

Play Console and App Store Connect still need the listing, screenshots, and privacy answers. The app has no account, no analytics, and no ads. It does not use the camera or microphone. Progress (the wave, the base, and the sound settings) is stored on the device. The display font is in the binary. Say that in the privacy answers. The Android manifest still declares `INTERNET`, which is what the Capacitor project starts with; the game does not call a server.
