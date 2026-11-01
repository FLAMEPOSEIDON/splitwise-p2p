#!/bin/bash
# build-apk-termux.sh — Build Splitwise P2P standalone APK in Termux or Linux
set -e

echo "=========================================================="
echo "       Building Splitwise P2P Standalone Android APK      "
echo "=========================================================="

# 1. Check for Java / keytool
if ! command -v keytool >/dev/null 2>&1; then
    echo ""
    echo "❌ Java (keytool) is not installed in Termux."
    echo ""
    echo "👉 Run this command in Termux to install Java:"
    echo "   pkg install openjdk-17"
    echo ""
    echo "Then rerun this script:"
    echo "   bash build-apk-termux.sh"
    echo ""
    echo "💡 Note: You can also push this project to GitHub,"
    echo "   and GitHub Actions will build the .apk in 2 minutes automatically!"
    echo "=========================================================="
    exit 1
fi

# 2. Check for Gradle
if ! command -v gradle >/dev/null 2>&1 && [ ! -f "android-app/gradlew" ]; then
    echo ""
    echo "❌ Gradle is not installed in Termux."
    echo ""
    echo "👉 Run this command in Termux to install Gradle:"
    echo "   pkg install gradle"
    echo ""
    echo "Then rerun this script:"
    echo "   bash build-apk-termux.sh"
    echo "=========================================================="
    exit 1
fi

cd "$(dirname "$0")/android-app"

# 3. Generate release keystore if not already present
if [ ! -f "app/splitwise-release.keystore" ]; then
    echo "Generating release signing keystore..."
    keytool -genkeypair -v \
        -keystore app/splitwise-release.keystore \
        -alias splitwise \
        -keyalg RSA \
        -keysize 2048 \
        -validity 10000 \
        -dname "CN=Splitwise P2P, OU=Mesh Network, O=Splitwise P2P, C=US" \
        -storepass splitwise123 \
        -keypass splitwise123
fi

# 4. Run Gradle build
if command -v gradle >/dev/null 2>&1; then
    echo "Running Gradle build..."
    gradle assembleRelease
elif [ -f "./gradlew" ]; then
    chmod +x ./gradlew
    ./gradlew assembleRelease
fi

echo "=========================================================="
echo " ✅ Build successful! APK location:"
ls -lh app/build/outputs/apk/release/*.apk 2>/dev/null || true
echo "=========================================================="
