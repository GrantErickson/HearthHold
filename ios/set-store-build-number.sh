#!/bin/sh
# Sets CFBundleVersion on the built app to 10000 + CI_BUILD_NUMBER.
#
# Capawesome's web build also runs `npm run version:ci`, which writes the same
# number into the Xcode project before xcodebuild reads it. This phase covers
# an xcodebuild that already has CI_BUILD_NUMBER and a processed Info.plist.
#
# The number is shell arithmetic. Asking node from this phase printed nothing
# when the project path was a symlink (node exited 0, so the empty string was
# written into CFBundleVersion and App Store Connect rejected the IPA). Xcode's
# PATH often has no node either. A blank value is never written: no
# CI_BUILD_NUMBER leaves the project's version alone, and anything else we
# cannot turn into a whole number fails the build.
set -eu

trimmed=$(printf '%s' "${CI_BUILD_NUMBER-}" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
if [ -z "$trimmed" ]; then
  echo "note: no CI_BUILD_NUMBER; leaving CFBundleVersion as the project has it"
  exit 0
fi

case "$trimmed" in
  *[!0-9]*)
    echo "error: CI_BUILD_NUMBER must be a whole number, got '${CI_BUILD_NUMBER}'" >&2
    exit 1
    ;;
esac

# Leading zeros would make $(( )) read the value as octal (and reject 08).
decimal=$(printf '%s' "$trimmed" | sed 's/^0*//')
if [ -z "$decimal" ]; then
  decimal=0
fi
# A huge value wraps in 64-bit shell arithmetic and can come out positive and
# wrong. Capawesome's build numbers are small; refuse one that cannot be added
# to 10000 exactly.
if [ "${#decimal}" -gt 15 ]; then
  echo "error: CI_BUILD_NUMBER is too long to be a store build number ('${CI_BUILD_NUMBER}')" >&2
  exit 1
fi

code=$((10000 + decimal))
case "$code" in
  ""|*[!0-9]*)
    echo "error: refusing to set CFBundleVersion to '${code}' (CI_BUILD_NUMBER=${CI_BUILD_NUMBER})" >&2
    exit 1
    ;;
esac
if [ "$code" -lt 10000 ]; then
  echo "error: refusing to set CFBundleVersion to '${code}' (CI_BUILD_NUMBER=${CI_BUILD_NUMBER})" >&2
  exit 1
fi

echo "note: store build number ${code} (CI_BUILD_NUMBER=${CI_BUILD_NUMBER})"

if [ -z "${TARGET_BUILD_DIR-}" ] || [ -z "${INFOPLIST_PATH-}" ]; then
  echo "error: TARGET_BUILD_DIR or INFOPLIST_PATH is unset; not writing CFBundleVersion ${code}" >&2
  exit 1
fi

plist="${TARGET_BUILD_DIR}/${INFOPLIST_PATH}"
if [ ! -f "$plist" ]; then
  echo "note: ${plist} is not written yet; the project version from version:ci is used"
  exit 0
fi

plistbuddy="${PLISTBUDDY:-/usr/libexec/PlistBuddy}"
"$plistbuddy" -c "Set :CFBundleVersion ${code}" "$plist"
written=$("$plistbuddy" -c "Print :CFBundleVersion" "$plist")
case "$written" in
  "$code")
    ;;
  *)
    echo "error: CFBundleVersion is '${written}', expected ${code}" >&2
    exit 1
    ;;
esac
echo "note: set CFBundleVersion ${code} in ${plist}"
