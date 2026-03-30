#!/bin/bash
set -e

# ── OpenDraft Release Script ─────────────────────────────────────────────────
# Handles the full release process:
#   1. Updates version in all source files
#   2. Commits and pushes
#   3. Creates git tag (triggers CI for Windows + Linux)
#   4. Builds macOS .dmg locally
#   5. Waits for GitHub Release to be created by CI
#   6. Uploads .dmg to the GitHub Release

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="Proteus-Technologies-Private-Limited/OpenDraft"

# ── Parse arguments ──────────────────────────────────────────────────────────
if [ -z "$1" ]; then
  echo "Usage: ./release.sh <version>"
  echo "Example: ./release.sh 0.4.0"
  exit 1
fi

NEW_VERSION="$1"
TAG="v${NEW_VERSION}"

echo ""
echo "=== OpenDraft Release ${TAG} ==="
echo ""

# ── Preflight checks ────────────────────────────────────────────────────────
if ! command -v gh &> /dev/null; then
  echo "Error: GitHub CLI (gh) is required. Install with: brew install gh"
  exit 1
fi

if ! gh auth status &> /dev/null 2>&1; then
  echo "Error: Not authenticated with GitHub CLI. Run: gh auth login"
  exit 1
fi

if git rev-parse "$TAG" &> /dev/null 2>&1; then
  echo "Error: Tag ${TAG} already exists."
  exit 1
fi

# Check for uncommitted changes (other than what this script will make)
if ! git diff --quiet HEAD 2>/dev/null; then
  echo "Error: You have uncommitted changes. Commit or stash them first."
  exit 1
fi

OLD_VERSION=$(grep '"version"' "$PROJECT_ROOT/src-tauri/tauri.conf.json" | head -1 | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
echo "Current version: ${OLD_VERSION}"
echo "New version:     ${NEW_VERSION}"
echo ""

# ── Step 1: Update version in all files ──────────────────────────────────────
echo "=== Step 1/6: Updating version numbers ==="

# src-tauri/tauri.conf.json
sed -i '' "s/\"version\": \"${OLD_VERSION}\"/\"version\": \"${NEW_VERSION}\"/" \
  "$PROJECT_ROOT/src-tauri/tauri.conf.json"
echo "  ✓ src-tauri/tauri.conf.json"

# src-tauri/Cargo.toml
sed -i '' "s/^version = \"${OLD_VERSION}\"/version = \"${NEW_VERSION}\"/" \
  "$PROJECT_ROOT/src-tauri/Cargo.toml"
echo "  ✓ src-tauri/Cargo.toml"

# backend/app/main.py
sed -i '' "s/version=\"${OLD_VERSION}\"/version=\"${NEW_VERSION}\"/g" \
  "$PROJECT_ROOT/backend/app/main.py"
echo "  ✓ backend/app/main.py"

# frontend/src/components/MenuBar.tsx
sed -i '' "s/Version ${OLD_VERSION}/Version ${NEW_VERSION}/g" \
  "$PROJECT_ROOT/frontend/src/components/MenuBar.tsx"
sed -i '' "s/What's New in ${OLD_VERSION}/What's New in ${NEW_VERSION}/g" \
  "$PROJECT_ROOT/frontend/src/components/MenuBar.tsx"
echo "  ✓ frontend/src/components/MenuBar.tsx"

# README.md - download link filenames
sed -i '' "s/${OLD_VERSION}/${NEW_VERSION}/g" \
  "$PROJECT_ROOT/README.md"
echo "  ✓ README.md"

# .github/workflows/release.yml - release body filenames
sed -i '' "s/${OLD_VERSION}/${NEW_VERSION}/g" \
  "$PROJECT_ROOT/.github/workflows/release.yml"
echo "  ✓ .github/workflows/release.yml"

# user-manual - footer version in all HTML files
for f in "$PROJECT_ROOT"/user-manual/*.html; do
  sed -i '' "s/v${OLD_VERSION}/v${NEW_VERSION}/g" "$f"
done
echo "  ✓ user-manual/*.html (footers)"

# user-manual/search.js
sed -i '' "s/v${OLD_VERSION}/v${NEW_VERSION}/g" \
  "$PROJECT_ROOT/user-manual/search.js"
echo "  ✓ user-manual/search.js"

# Update Cargo.lock
echo ""
echo "  Updating Cargo.lock..."
cd "$PROJECT_ROOT/src-tauri"
cargo generate-lockfile 2>/dev/null
echo "  ✓ src-tauri/Cargo.lock"
cd "$PROJECT_ROOT"

echo ""

# ── Step 2: Commit version bump ─────────────────────────────────────────────
echo "=== Step 2/6: Committing version bump ==="
git add -A
git commit -m "Bump version to ${NEW_VERSION}"
git push origin main
echo "  ✓ Committed and pushed"
echo ""

# ── Step 3: Build macOS .dmg locally ────────────────────────────────────────
echo "=== Step 3/6: Building macOS desktop app ==="
"$PROJECT_ROOT/build-desktop.sh"

# Find the .dmg file
DMG_FILE=$(find "$PROJECT_ROOT/src-tauri/target/release/bundle/dmg" -name "*.dmg" 2>/dev/null | head -1)
if [ -z "$DMG_FILE" ]; then
  echo "Error: No .dmg file found in src-tauri/target/release/bundle/dmg/"
  echo "Build may have failed. Check output above."
  exit 1
fi
echo ""
echo "  ✓ Built: $(basename "$DMG_FILE")"
echo ""

# ── Step 4: Create and push tag ─────────────────────────────────────────────
echo "=== Step 4/6: Creating tag ${TAG} ==="
git tag "$TAG"
git push origin "$TAG"
echo "  ✓ Tag ${TAG} pushed (CI building Windows + Linux)"
echo ""

# ── Step 5: Wait for GitHub Release to be created by CI ─────────────────────
echo "=== Step 5/6: Waiting for GitHub Release to be created by CI ==="
echo "  This may take several minutes..."

MAX_WAIT=600  # 10 minutes
ELAPSED=0
INTERVAL=15

while [ $ELAPSED -lt $MAX_WAIT ]; do
  if gh release view "$TAG" --repo "$REPO" &> /dev/null 2>&1; then
    echo "  ✓ Release ${TAG} found"
    break
  fi
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
  echo "  Waiting... (${ELAPSED}s)"
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo ""
  echo "  Timed out waiting for CI to create the release."
  echo "  You can upload the .dmg manually once the release exists:"
  echo "    gh release upload ${TAG} \"${DMG_FILE}\" --repo ${REPO}"
  exit 1
fi
echo ""

# ── Step 6: Upload macOS .dmg to the release ────────────────────────────────
echo "=== Step 6/6: Uploading macOS .dmg to release ==="
gh release upload "$TAG" "$DMG_FILE" --repo "$REPO"
echo "  ✓ Uploaded $(basename "$DMG_FILE")"
echo ""

echo "============================================="
echo "  Release ${TAG} complete!"
echo "  https://github.com/${REPO}/releases/tag/${TAG}"
echo "============================================="
echo ""
echo "Post-release checklist:"
echo "  - [ ] Verify download links in README work"
echo "  - [ ] Update What's New in About dialog and user manual if not done"
echo "  - [ ] Test downloads for each platform"
