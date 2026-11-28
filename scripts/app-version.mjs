/**
 * Writes the app's two version numbers into the iOS and Android projects,
 * before Xcode and Gradle read them.
 *
 *  - The version people see (1.0.0) is `version` in package.json. Bump it with
 *    `npm version patch|minor|major --no-git-tag-version` and commit.
 *  - The store build number is Capawesome's CI_BUILD_NUMBER, which goes up with
 *    every cloud build, so every upload to TestFlight and Play is higher than
 *    the last. Without one (a local run) it is 1.
 *
 * Capawesome runs this at the end of the web build (`npm run version:ci`).
 * `node scripts/app-version.mjs` alone just prints what it would write.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  pkg: resolve(root, 'package.json'),
  pbxproj: resolve(root, 'ios/App/App.xcodeproj/project.pbxproj'),
  gradle: resolve(root, 'android/app/build.gradle'),
};

/** @param {string | undefined} raw */
export function buildNumber(raw) {
  const v = String(raw ?? '').trim();
  return /^[0-9]+$/.test(v) && Number(v) >= 1 ? Number(v) : 1;
}

/** @param {string} file @param {RegExp} re @param {string} to */
function replaceAll(file, re, to) {
  const src = readFileSync(file, 'utf8');
  if (!re.test(src)) throw new Error(`${re} was not found in ${file}`);
  writeFileSync(file, src.replace(new RegExp(re.source, 'g'), to));
}

const version = JSON.parse(readFileSync(files.pkg, 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package.json version "${version}" is not x.y.z`);
const build = buildNumber(process.env.CI_BUILD_NUMBER);

if (process.argv.includes('--write')) {
  replaceAll(files.pbxproj, /MARKETING_VERSION = [^;]+;/, `MARKETING_VERSION = ${version};`);
  replaceAll(files.pbxproj, /CURRENT_PROJECT_VERSION = [^;]+;/, `CURRENT_PROJECT_VERSION = ${build};`);
  replaceAll(files.gradle, /versionName "[^"]*"/, `versionName "${version}"`);
  replaceAll(files.gradle, /versionCode \d+/, `versionCode ${build}`);
  console.error(`app version ${version} (${build}) written to the iOS and Android projects`);
}
process.stdout.write(`${version} (${build})\n`);
