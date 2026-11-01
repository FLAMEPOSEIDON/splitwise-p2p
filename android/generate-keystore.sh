#!/bin/bash
# generate-keystore.sh — Generate a trusted Android release certificate keystore
# This certificate signs your Android APK so anyone can install it without "Corrupt Package" errors.

KEYSTORE_NAME="splitwise-p2p-release.keystore"
ALIAS_NAME="splitwise"
VALIDITY_DAYS=10000

echo "=== Generating Android Release Signing Keystore ==="

keytool -genkeypair -v \
  -keystore "$KEYSTORE_NAME" \
  -alias "$ALIAS_NAME" \
  -keyalg RSA \
  -keysize 2048 \
  -validity $VALIDITY_DAYS \
  -dname "CN=Splitwise P2P, OU=Mesh Network, O=Splitwise P2P, C=US" \
  -storepass splitwise123 \
  -keypass splitwise123

echo ""
echo "Keystore created: $KEYSTORE_NAME"
echo "Alias: $ALIAS_NAME"
echo "Password: splitwise123"
echo "Use this to sign your APK using apksigner:"
echo "apksigner sign --ks $KEYSTORE_NAME --ks-key-alias $ALIAS_NAME app-release-unsigned.apk"
