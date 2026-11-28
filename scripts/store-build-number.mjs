/**
 * The number TestFlight and Play see.
 *
 * Nothing of HearthHold has shipped yet, so the floor is 10000. A local build,
 * and a cloud build that forgot CI_BUILD_NUMBER, stay there. Capawesome sets
 * CI_BUILD_NUMBER for each cloud build. The number that reaches the stores is
 * 10000 plus that, so every upload is higher than the last.
 *
 * A value that is not a whole number stays at 10000 too.
 *
 * `npm run version:ci` (`--write`) puts the number into the Xcode project and
 * the Android build before those tools read them. The Xcode run script does
 * its own arithmetic (`ios/set-store-build-number.sh`) and does not call this
 * file: a symlinked path used to make the main-module check miss, so node
 * printed nothing and the phase wrote an empty CFBundleVersion.
 */
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = 10000;

/** @param {string | undefined} raw Capawesome's CI_BUILD_NUMBER, or nothing. */
export function storeBuildNumber(raw) {
  const value = String(raw ?? "").trim();
  if (!/^[0-9]+$/.test(value)) return BASE;
  return BASE + Number(value);
}

const nativeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function projectFiles() {
  return {
    pbxproj: resolve(nativeRoot, "ios/App/App.xcodeproj/project.pbxproj"),
    gradle: resolve(nativeRoot, "android/app/build.gradle"),
  };
}

/**
 * @param {number} code
 * @param {{ pbxproj: string, gradle: string }} [files]
 */
export function stampStoreBuildNumber(code, files = projectFiles()) {
  if (!Number.isInteger(code) || code < BASE) {
    throw new Error(`Refusing to write store build number "${code}". It has to be a whole number of at least ${BASE}.`);
  }
  const ios = readFileSync(files.pbxproj, "utf8").replace(
    /CURRENT_PROJECT_VERSION = \d+;/g,
    `CURRENT_PROJECT_VERSION = ${code};`,
  );
  if (!ios.includes(`CURRENT_PROJECT_VERSION = ${code};`)) {
    throw new Error("CURRENT_PROJECT_VERSION was not found in the Xcode project.");
  }
  writeFileSync(files.pbxproj, ios);

  const android = readFileSync(files.gradle, "utf8").replace(/versionCode \d+/, `versionCode ${code}`);
  if (!android.includes(`versionCode ${code}`)) {
    throw new Error("versionCode was not found in the Android build.");
  }
  writeFileSync(files.gradle, android);
}

function canonical(path) {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

// realpath, not resolve: import.meta.url is the real path, and a symlink
// (Xcode's SRCROOT often is) would miss and this file would print nothing.
const isMain =
  process.argv[1] !== undefined && canonical(process.argv[1]) === canonical(fileURLToPath(import.meta.url));
if (isMain) {
  const code = storeBuildNumber(process.env.CI_BUILD_NUMBER);
  if (process.argv.includes("--write")) {
    stampStoreBuildNumber(code);
    console.error(`store build number ${code}`);
  }
  process.stdout.write(`${code}\n`);
}
