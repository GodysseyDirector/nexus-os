#!/usr/bin/env bash
# NEXUS OS — Full Electron build pipeline
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UI_SRC="/Users/godysseydirector/Documents/ OPENCLAW OS/OpenClaw-V5/openclawV3/openclaw-dashboard"

echo "🏗️  NEXUS OS Build Pipeline"
echo "=============================="

# 1. Build the UI
echo ""
echo "Step 1: Building UI (Vite)..."
cd "$UI_SRC"
npm run build
echo "✓ UI built"

# 2. Copy UI dist to nexus-os/ui/dist
echo ""
echo "Step 2: Copying UI dist..."
rm -rf "$ROOT/ui/dist"
cp -r "$UI_SRC/dist" "$ROOT/ui/dist"
echo "✓ UI dist copied"

# 3. Install nexus-os dependencies
echo ""
echo "Step 3: Installing dependencies..."
cd "$ROOT"
npm install
echo "✓ Dependencies installed"

# 4. Build Electron DMG
echo ""
echo "Step 4: Building Electron app..."
npx electron-builder --mac dmg
echo "✓ Electron app built"

# 5. Copy to Desktop
echo ""
echo "Step 5: Copying to Desktop..."
cp release/NEXUS-*.dmg ~/Desktop/ 2>/dev/null && echo "✓ DMG on Desktop" || true
cp -R "release/mac-arm64/NEXUS.app" ~/Desktop/ 2>/dev/null && echo "✓ .app on Desktop" || true

echo ""
echo "=============================="
echo "✅ Build complete!"
echo "   DMG: ~/Desktop/NEXUS-*.dmg"
echo "   App: ~/Desktop/NEXUS.app"
