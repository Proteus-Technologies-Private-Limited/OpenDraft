#!/bin/bash
set -e

# ── OpenDraft Release Script ─────────────────────────────────────────────────
# Handles the full release process:
#   1. Updates version in all source files (on a release branch)
#   2. Creates a PR for the version bump
#   3. After PR is merged, creates git tag (triggers CI for all platforms)

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

# Check for uncommitted changes (other than what this script will make)
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
echo "=== Step 1/3: Updating version numbers ==="

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

# ── Step 2: Commit, push branch, create PR ──────────────────────────────────
echo "=== Step 2/3: Creating pull request ==="
git add -A
git commit -m "Bump version to ${NEW_VERSION}"
git push origin "$BRANCH"

PR_URL=$(gh pr create \
  --title "Release v${NEW_VERSION}" \
  --body "$(cat <<PREOF
## Version bump to ${NEW_VERSION}

Updates version numbers and download links across all source files.

**After merging**, the release tag will be created automatically — do not create it manually.
PREOF
)" \
  --base main \
  --head "$BRANCH" \
  --repo "$REPO")

echo "  ✓ PR created: $PR_URL"
echo ""

# ── Step 3: Wait for merge, then tag ────────────────────────────────────────
echo "=== Step 3/3: Waiting for PR to be merged ==="
echo "  Merge the PR at: $PR_URL"
echo "  (or press Enter here after merging to create the tag)"
echo ""

while true; do
  PR_STATE=$(gh pr view "$PR_URL" --repo "$REPO" --json state -q '.state')
  if [ "$PR_STATE" = "MERGED" ]; then
    echo "  ✓ PR merged!"
    break
  elif [ "$PR_STATE" = "CLOSED" ]; then
    echo "  ✗ PR was closed without merging. Aborting."
    exit 1
  fi
  echo "  Waiting for PR to be merged... (checking every 10s)"
  sleep 10
done

# Switch back to main and pull the merge
git checkout main
git pull origin main

# Create and push the tag
git tag "$TAG"
git push origin "$TAG"
echo "  ✓ Tag ${TAG} pushed"
echo ""

# Clean up the release branch
git branch -d "$BRANCH" 2>/dev/null || true
git push origin --delete "$BRANCH" 2>/dev/null || true

echo "============================================="
echo "  Release ${TAG} tag pushed!"
echo "  CI is now building all platforms."
echo "  https://github.com/${REPO}/actions"
echo "============================================="
echo ""
echo "Post-release checklist:"
echo "  - [ ] Wait for CI to complete and verify all assets are on the release"
echo "  - [ ] Verify download links in README work"
echo "  - [ ] Update What's New in About dialog and user manual if not done"
echo "  - [ ] Test downloads for each platform"
