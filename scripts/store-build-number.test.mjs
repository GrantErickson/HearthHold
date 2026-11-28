import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stampStoreBuildNumber, storeBuildNumber } from "./store-build-number.mjs";

const script = join(import.meta.dirname, "store-build-number.mjs");
const phase = join(import.meta.dirname, "../ios/set-store-build-number.sh");

function plistBuddy(dir) {
  const buddy = join(dir, "plistbuddy");
  writeFileSync(
    buddy,
    [
      "#!/bin/sh",
      "set -eu",
      "cmd=$2",
      "file=$3",
      'case "$cmd" in',
      '  "Set :CFBundleVersion "*)',
      '    val=${cmd#"Set :CFBundleVersion "}',
      '    if [ -z "$val" ]; then',
      '      echo "refusing empty CFBundleVersion" >&2',
      "      exit 1",
      "    fi",
      "    printf '%s\\n' \"$val\" > \"$file\"",
      "    ;;",
      '  "Print :CFBundleVersion")',
      '    cat "$file"',
      "    ;;",
      "  *)",
      '    echo "unknown command: $cmd" >&2',
      "    exit 1",
      "    ;;",
      "esac",
      "",
    ].join("\n"),
  );
  chmodSync(buddy, 0o755);
  return buddy;
}

function runPhase(env) {
  const clean = { PATH: "/usr/bin:/bin" };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) clean[key] = value;
  }
  return spawnSync("sh", [phase], { env: clean, encoding: "utf8" });
}

describe("store build number", () => {
  it("stays at 10000 when Capawesome did not set a number", () => {
    assert.equal(storeBuildNumber(undefined), 10000);
    assert.equal(storeBuildNumber(""), 10000);
    assert.equal(storeBuildNumber("  "), 10000);
    assert.equal(storeBuildNumber("nope"), 10000);
    assert.equal(storeBuildNumber("1.5"), 10000);
  });

  it("adds Capawesome's build number to 10000", () => {
    assert.equal(storeBuildNumber("1"), 10001);
    assert.equal(storeBuildNumber("42"), 10042);
    assert.equal(storeBuildNumber(" 7 "), 10007);
  });

  it("prints only the number", () => {
    const out = execFileSync("node", [script], {
      env: { ...process.env, CI_BUILD_NUMBER: "3" },
      encoding: "utf8",
    });
    assert.equal(out, "10003\n");
  });

  it("prints the number when node is started through a symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "hearthhold-build-"));
    const link = join(dir, "store-build-number.mjs");
    symlinkSync(script, link);
    const out = execFileSync("node", [link], {
      env: { ...process.env, CI_BUILD_NUMBER: "3" },
      encoding: "utf8",
    });
    assert.equal(out, "10003\n");
  });

  it("writes the same number into the iOS project and the Android build", () => {
    const dir = mkdtempSync(join(tmpdir(), "hearthhold-build-"));
    const pbxproj = join(dir, "project.pbxproj");
    const gradle = join(dir, "build.gradle");
    writeFileSync(pbxproj, "CURRENT_PROJECT_VERSION = 10000;\nCURRENT_PROJECT_VERSION = 10000;\n");
    writeFileSync(gradle, 'versionCode 10000\n        versionName "1.0.0"\n');
    stampStoreBuildNumber(10007, { pbxproj, gradle });
    assert.equal(readFileSync(pbxproj, "utf8"), "CURRENT_PROJECT_VERSION = 10007;\nCURRENT_PROJECT_VERSION = 10007;\n");
    const written = readFileSync(gradle, "utf8");
    assert.match(written, /versionCode 10007/);
    assert.match(written, /versionName "1.0.0"/);
  });

  it("refuses to write a blank or too-small store build number", () => {
    const dir = mkdtempSync(join(tmpdir(), "hearthhold-build-"));
    const pbxproj = join(dir, "project.pbxproj");
    const gradle = join(dir, "build.gradle");
    const ios = "CURRENT_PROJECT_VERSION = 10000;\n";
    const android = "versionCode 10000\n";
    writeFileSync(pbxproj, ios);
    writeFileSync(gradle, android);
    assert.throws(() => stampStoreBuildNumber(Number.NaN, { pbxproj, gradle }), /whole number/);
    assert.throws(() => stampStoreBuildNumber(0, { pbxproj, gradle }), /whole number/);
    assert.equal(readFileSync(pbxproj, "utf8"), ios);
    assert.equal(readFileSync(gradle, "utf8"), android);
  });

  it("keeps Android versionCode a plain number, with no second computation", () => {
    const gradle = readFileSync(join(import.meta.dirname, "../android/app/build.gradle"), "utf8");
    assert.match(gradle, /versionCode \d+/);
    assert.doesNotMatch(gradle, /\bnode\b/);
    assert.doesNotMatch(gradle, /System\.getenv/);
  });
});

describe("iOS store build phase", () => {
  function phaseDir() {
    const dir = mkdtempSync(join(tmpdir(), "hearthhold-phase-"));
    const plist = join(dir, "Info.plist");
    writeFileSync(plist, "10000\n");
    return {
      dir,
      plist,
      env: {
        PLISTBUDDY: plistBuddy(dir),
        TARGET_BUILD_DIR: dir,
        INFOPLIST_PATH: "Info.plist",
      },
    };
  }

  it("sets CFBundleVersion to 10000 plus CI_BUILD_NUMBER without node on PATH", () => {
    const { plist, env } = phaseDir();
    const result = runPhase({ ...env, CI_BUILD_NUMBER: "3" });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /store build number 10003 \(CI_BUILD_NUMBER=3\)/);
    assert.match(result.stdout, /set CFBundleVersion 10003/);
    assert.equal(readFileSync(plist, "utf8"), "10003\n");
  });

  it("trims the build number and treats leading zeros as decimal", () => {
    const padded = phaseDir();
    assert.equal(runPhase({ ...padded.env, CI_BUILD_NUMBER: " 7 " }).status, 0);
    assert.equal(readFileSync(padded.plist, "utf8"), "10007\n");

    const octal = phaseDir();
    assert.equal(runPhase({ ...octal.env, CI_BUILD_NUMBER: "08" }).status, 0);
    assert.equal(readFileSync(octal.plist, "utf8"), "10008\n");
  });

  it("leaves the existing version alone when there is no CI build number", () => {
    const { plist, env } = phaseDir();
    const unset = runPhase(env);
    assert.equal(unset.status, 0);
    assert.match(unset.stdout, /leaving CFBundleVersion/);
    assert.equal(readFileSync(plist, "utf8"), "10000\n");

    const blank = runPhase({ ...env, CI_BUILD_NUMBER: "   " });
    assert.equal(blank.status, 0);
    assert.equal(readFileSync(plist, "utf8"), "10000\n");
  });

  it("fails the build instead of writing a blank version", () => {
    const { plist, env } = phaseDir();
    const bad = runPhase({ ...env, CI_BUILD_NUMBER: "nope" });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /whole number/);
    assert.equal(readFileSync(plist, "utf8"), "10000\n");

    const huge = runPhase({ ...env, CI_BUILD_NUMBER: "9".repeat(20) });
    assert.equal(huge.status, 1);
    assert.equal(readFileSync(plist, "utf8"), "10000\n");

    const nowhere = runPhase({ CI_BUILD_NUMBER: "3" });
    assert.equal(nowhere.status, 1);
    assert.match(nowhere.stderr, /TARGET_BUILD_DIR/);
    assert.doesNotMatch(nowhere.stdout, /set CFBundleVersion/);
  });

  it("keeps the project version when the built Info.plist is not written yet", () => {
    const dir = mkdtempSync(join(tmpdir(), "hearthhold-phase-"));
    const result = runPhase({
      PLISTBUDDY: plistBuddy(dir),
      TARGET_BUILD_DIR: dir,
      INFOPLIST_PATH: "Missing.plist",
      CI_BUILD_NUMBER: "3",
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /store build number 10003/);
    assert.match(result.stdout, /not written yet/);
  });

  it("does not call node", () => {
    const source = readFileSync(phase, "utf8");
    const commands = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    assert.doesNotMatch(commands, /\bnode\b/);
  });
});
