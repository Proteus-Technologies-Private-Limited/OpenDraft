#!/bin/bash
set -e

# ── OpenDraft Release Script ─────────────────────────────────────────────────
# Release process (no downtime for download links):
#   1. Creates release branch with version bump (code + download links)
#   2. Tags the branch and pushes tag → triggers CI builds
#   3. CI builds all platforms, submits to stores, publishes release
#   4. Creates PR to merge version bump + updated links into main
#   5. Waits for PR merge → links go live only after release is published

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
BRANCH="release/v${NEW_VERSION}"

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

# Check for uncommitted changes
if ! git diff --quiet HEAD 2>/dev/null; then
  echo "Error: You have uncommitted changes. Commit or stash them first."
  exit 1
fi

# Ensure we're on main and up to date
git checkout main
git pull origin main

OLD_VERSION=$(grep '"version"' "$PROJECT_ROOT/src-tauri/tauri.conf.json" | head -1 | sed 's/.*"\([0-9]*\.[0-9]*\.[0-9]*\)".*/\1/')
echo "Current version: ${OLD_VERSION}"
echo "New version:     ${NEW_VERSION}"
echo ""

# ── Step 1: Create release branch and update versions ───────────────────────
echo "=== Step 1/4: Updating version numbers ==="

git checkout -b "$BRANCH"

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

# README.md download links
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_aarch64\.dmg/OpenDraft_${NEW_VERSION}_aarch64.dmg/g" "$PROJECT_ROOT/README.md"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_x64\.dmg/OpenDraft_${NEW_VERSION}_x64.dmg/g" "$PROJECT_ROOT/README.md"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_x64-setup\.exe/OpenDraft_${NEW_VERSION}_x64-setup.exe/g" "$PROJECT_ROOT/README.md"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_x64_en-US\.msi/OpenDraft_${NEW_VERSION}_x64_en-US.msi/g" "$PROJECT_ROOT/README.md"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_amd64\.deb/OpenDraft_${NEW_VERSION}_amd64.deb/g" "$PROJECT_ROOT/README.md"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_amd64\.AppImage/OpenDraft_${NEW_VERSION}_amd64.AppImage/g" "$PROJECT_ROOT/README.md"
sed -i '' "s/OpenDraft-[0-9]*\.[0-9]*\.[0-9]*-1\.x86_64\.rpm/OpenDraft-${NEW_VERSION}-1.x86_64.rpm/g" "$PROJECT_ROOT/README.md"
echo "  ✓ README.md (download links)"

# landing/index.html download links
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_aarch64\.dmg/OpenDraft_${NEW_VERSION}_aarch64.dmg/g" "$PROJECT_ROOT/landing/index.html"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_x64-setup\.exe/OpenDraft_${NEW_VERSION}_x64-setup.exe/g" "$PROJECT_ROOT/landing/index.html"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_amd64\.deb/OpenDraft_${NEW_VERSION}_amd64.deb/g" "$PROJECT_ROOT/landing/index.html"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_x64\.dmg/OpenDraft_${NEW_VERSION}_x64.dmg/g" "$PROJECT_ROOT/landing/index.html"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_x86_64-legacy\.dmg/OpenDraft_${NEW_VERSION}_x86_64-legacy.dmg/g" "$PROJECT_ROOT/landing/index.html"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_x64_en-US\.msi/OpenDraft_${NEW_VERSION}_x64_en-US.msi/g" "$PROJECT_ROOT/landing/index.html"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_amd64\.AppImage/OpenDraft_${NEW_VERSION}_amd64.AppImage/g" "$PROJECT_ROOT/landing/index.html"
sed -i '' "s/OpenDraft_[0-9]*\.[0-9]*\.[0-9]*_android\.apk/OpenDraft_${NEW_VERSION}_android.apk/g" "$PROJECT_ROOT/landing/index.html"
echo "  ✓ landing/index.html (download links)"

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

# ── Step 2: Commit, push branch, create tag ──────────────────────────────────
echo "=== Step 2/4: Pushing release branch and tag ==="
git add -A
git commit -m "Bump version to ${NEW_VERSION}"
git push origin "$BRANCH"
echo "  ✓ Branch ${BRANCH} pushed"

# Tag the release branch — this triggers CI
git tag "$TAG"
git push origin "$TAG"
echo "  ✓ Tag ${TAG} pushed — CI is now building all platforms"
echo "  https://github.com/${REPO}/actions"
echo ""

# ── Step 3: Wait for CI to publish the release ──────────────────────────────
echo "=== Step 3/4: Waiting for CI to publish release ==="
echo "  Monitoring build progress..."
echo ""

while true; do
  # Check if the release exists and is not a draft
  DRAFT=$(gh release view "$TAG" --repo "$REPO" --json isDraft -q '.isDraft' 2>/dev/null || echo "none")
  if [ "$DRAFT" = "false" ]; then
    echo "  ✓ Release ${TAG} is published!"
    break
  elif [ "$DRAFT" = "true" ]; then
    echo "  Release exists (draft) — builds still in progress..."
  else
    echo "  Release not created yet — waiting for first build to complete..."
  fi
  sleep 30
done

# ── Step 3.5: Upload old-version binaries for backward compatibility ───────
# Download links on main still reference the OLD version filenames.
# Until the PR merges, we need the old binaries available in the new release
# so that /releases/latest/download/OpenDraft_OLD_... doesn't 404.
echo "  Uploading old-version binaries for backward-compatible downloads..."
OLD_TAG="v${OLD_VERSION}"
TMPDIR=$(mktemp -d)

EXTENSIONS=("aarch64.dmg" "x64-setup.exe" "x64_en-US.msi" "amd64.deb" "amd64.AppImage" "android.apk" "ios.ipa")
for ext in "${EXTENSIONS[@]}"; do
  OLD_NAME="OpenDraft_${OLD_VERSION}_${ext}"
  if gh release download "$OLD_TAG" --repo "$REPO" -p "$OLD_NAME" -D "$TMPDIR" 2>/dev/null; then
    gh release upload "$TAG" "$TMPDIR/$OLD_NAME" --repo "$REPO" --clobber 2>/dev/null
    echo "    ✓ ${OLD_NAME}"
  fi
done
# RPM uses different naming: OpenDraft-VERSION-1.x86_64.rpm
OLD_RPM="OpenDraft-${OLD_VERSION}-1.x86_64.rpm"
if gh release download "$OLD_TAG" --repo "$REPO" -p "$OLD_RPM" -D "$TMPDIR" 2>/dev/null; then
  gh release upload "$TAG" "$TMPDIR/$OLD_RPM" --repo "$REPO" --clobber 2>/dev/null
  echo "    ✓ ${OLD_RPM}"
fi
rm -rf "$TMPDIR"

echo ""

# ── Step 4: Create PR to merge into main ────────────────────────────────────
echo "=== Step 4/4: Creating PR to update main ==="

PR_URL=$(gh pr create \
  --title "Release v${NEW_VERSION}" \
  --body "$(cat <<PREOF
## Release v${NEW_VERSION}

Version bump and download link updates. The release is already published and all builds are live.

**Safe to merge** — download links will start pointing to the new version after merge.
PREOF
)" \
  --base main \
  --head "$BRANCH" \
  --repo "$REPO")

echo "  ✓ PR created: $PR_URL"
echo ""
echo "============================================="
echo "  Release ${TAG} is LIVE!"
echo ""
echo "  Merge the PR to update download links:"
echo "  $PR_URL"
echo ""
echo "  Old download links still work until you merge."
echo "============================================="
echo ""

# Wait for merge and clean up
echo "Waiting for PR merge to clean up..."
while true; do
  PR_STATE=$(gh pr view "$PR_URL" --repo "$REPO" --json state -q '.state')
  if [ "$PR_STATE" = "MERGED" ]; then
    echo "  ✓ PR merged! Download links are now live."
    break
  elif [ "$PR_STATE" = "CLOSED" ]; then
    echo "  PR closed — you can merge it later manually."
    break
  fi
  sleep 10
done

# Remove old-version binaries now that links on main point to new version
echo "  Cleaning up old-version binaries from release..."
for ext in "${EXTENSIONS[@]}"; do
  gh release delete-asset "$TAG" "OpenDraft_${OLD_VERSION}_${ext}" --repo "$REPO" -y 2>/dev/null
done
gh release delete-asset "$TAG" "OpenDraft-${OLD_VERSION}-1.x86_64.rpm" --repo "$REPO" -y 2>/dev/null
echo "  ✓ Old-version binaries removed"

# Switch back to main
git checkout main
git pull origin main

# Clean up release branch
git branch -d "$BRANCH" 2>/dev/null || true
git push origin --delete "$BRANCH" 2>/dev/null || true
echo "  ✓ Cleaned up release branch"
