#!/usr/bin/env bash
# Runs ONLY on a disposable Android emulator against the debug QA APK.
# It never logs in to a real ERP or alters company/customer data.
set -euo pipefail

apk="android-driver/app/build/outputs/apk/debug/app-debug.apk"
package="com.temo.aquaflow.driver.nativeapp"
activity="com.temo.aquaflow.driver.MainActivity"
test -s "$apk"

adb install -r "$apk"
adb shell am start -W -n "$package/$activity"
sleep 4
adb shell pidof "$package" >/dev/null
adb shell uiautomator dump /sdcard/temo-ui.xml >/dev/null
adb shell cat /sdcard/temo-ui.xml | grep -F 'TEMO DRIVER' >/dev/null
adb shell cat /sdcard/temo-ui.xml | grep -F 'Driver Login' >/dev/null
echo "PASS: native Driver-only login UI launched on emulator"

restore_network() {
  adb shell svc wifi enable || true
  adb shell svc data enable || true
}
trap restore_network EXIT
adb shell svc wifi disable
adb shell svc data disable
adb shell am force-stop "$package"
adb shell am start -W -n "$package/$activity"
sleep 3
adb shell pidof "$package" >/dev/null
adb shell uiautomator dump /sdcard/temo-ui-offline.xml >/dev/null
adb shell cat /sdcard/temo-ui-offline.xml | grep -F 'Driver Login' >/dev/null
echo "PASS: cold restart opens native Driver login without network"
echo "NOT TESTED: authenticated offline session, real assigned deliveries, OTP, signatures, ERP ledger posting"
