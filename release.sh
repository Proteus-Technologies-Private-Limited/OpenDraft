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
  echo "         SKIP_PLATFORMS=\"android ios macos\" ./release.sh 0.4.1"
  exit 1
fi

# ── Platforms to leave out ──────────────────────────────────────────────────
# SKIP_PLATFORMS="android ios macos" releases the rest only. It travels to CI
# as a `skip-platforms:` line in the annotated tag (see the plan job in
# release.yml). A platform left out keeps its download links and update
# notice on the version it already has; that version's files are copied into
# this release, and left there, so the /releases/latest/ links keep working.
SKIP_PLATFORMS=$(echo "${SKIP_PLATFORMS:-}" | tr ',[:upper:]' ' [:lower:]' | xargs)
for p in $SKIP_PLATFORMS; do
  case "$p" in
    macos|ios|android|windows|linux) ;;
    *) echo "Error: unknown platform '$p' in SKIP_PLATFORMS (use macos ios android windows linux)"; exit 1 ;;
  esac
done
builds() { [[ " $SKIP_PLATFORMS " != *" $1 "* ]]; }
if ! builds windows && ! builds linux && ! builds macos; then
  echo "Error: SKIP_PLATFORMS leaves no desktop platform to release."
  exit 1
fi

NEW_VERSION="$1"
TAG="v${NEW_VERSION}"
BRANCH="release/v${NEW_VERSION}"

echo ""
echo "=== OpenDraft Release ${TAG} ==="
[ -n "$SKIP_PLATFORMS" ] && echo "    Leaving out: ${SKIP_PLATFORMS}"
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

# The filenames README and the landing page currently link to, captured before
# the seds below rewrite them to the new version.
#
# Step 3.5 backfills these into the new release, because `releases/latest`
# moves to the new tag the moment it is published while main still advertises
# the old filenames until the PR merges. That list used to be hand-written and
# had drifted: it was missing x64.dmg and x86_64-legacy.dmg, so every Intel Mac
# download 404'd for the whole window between publishing v0.26.2 and merging
# its PR. Reading it off the files that do the advertising cannot drift.
#
# Any version, not just OLD_VERSION: a platform left out of an earlier release
# is still advertised at the version it last shipped.
ADVERTISED=$(grep -ohE "OpenDraft[_-][0-9]+\.[0-9]+\.[0-9]+[_-][A-Za-z0-9_.-]*\.(dmg|exe|msi|deb|rpm|AppImage|apk)" \
  "$PROJECT_ROOT/README.md" "$PROJECT_ROOT/landing/index.html" 2>/dev/null \
  | sort -u || true)
if [ -z "$ADVERTISED" ]; then
  echo "Error: no download links found in README.md or landing/index.html."
  echo "       Refusing to release: the backfill in step 3.5 would upload nothing"
  echo "       and every download link would 404 until the PR merged."
  exit 1
fi
# Where those files are now: the release /releases/latest/ points at. It holds
# every advertised file, its own and any carried in from before.
LATEST_TAG=$(gh release view --repo "$REPO" --json tagName -q .tagName)
echo "  Download links to keep alive during the release:"
echo "$ADVERTISED" | sed 's/^/    /'

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

# frontend/src/services/diagnostics.ts
sed -i '' "s/return '${OLD_VERSION}';/return '${NEW_VERSION}';/g" \
  "$PROJECT_ROOT/frontend/src/services/diagnostics.ts"
echo "  ✓ frontend/src/services/diagnostics.ts"

# README.md and landing/index.html download links — only for the platforms
# this release builds; the rest keep pointing at the files they already have.
bump_link() {  # <platform> <sed pattern for the old name> <new name>
  builds "$1" || return 0
  for f in "$PROJECT_ROOT/README.md" "$PROJECT_ROOT/landing/index.html"; do
    sed -i '' "s/$2/$3/g" "$f"
  done
}
V='[0-9]*\.[0-9]*\.[0-9]*'
bump_link macos   "OpenDraft_${V}_aarch64\.dmg"        "OpenDraft_${NEW_VERSION}_aarch64.dmg"
bump_link macos   "OpenDraft_${V}_x64\.dmg"            "OpenDraft_${NEW_VERSION}_x64.dmg"
bump_link macos   "OpenDraft_${V}_x86_64-legacy\.dmg"  "OpenDraft_${NEW_VERSION}_x86_64-legacy.dmg"
bump_link windows "OpenDraft_${V}_x64-setup\.exe"      "OpenDraft_${NEW_VERSION}_x64-setup.exe"
bump_link windows "OpenDraft_${V}_x64_en-US\.msi"      "OpenDraft_${NEW_VERSION}_x64_en-US.msi"
bump_link linux   "OpenDraft_${V}_amd64\.deb"          "OpenDraft_${NEW_VERSION}_amd64.deb"
bump_link linux   "OpenDraft_${V}_amd64\.AppImage"     "OpenDraft_${NEW_VERSION}_amd64.AppImage"
bump_link linux   "OpenDraft-${V}-1\.x86_64\.rpm"     "OpenDraft-${NEW_VERSION}-1.x86_64.rpm"
bump_link android "OpenDraft_${V}_android\.apk"        "OpenDraft_${NEW_VERSION}_android.apk"
echo "  ✓ README.md, landing/index.html (download links)"

# Advertised files this release does not replace. They are copied into it in
# step 3.5 like the rest, and are the ones left there after the PR merges.
STILL_ADVERTISED=$(grep -ohE "OpenDraft[_-][0-9]+\.[0-9]+\.[0-9]+[_-][A-Za-z0-9_.-]*\.(dmg|exe|msi|deb|rpm|AppImage|apk)" \
  "$PROJECT_ROOT/README.md" "$PROJECT_ROOT/landing/index.html" 2>/dev/null \
  | grep -v "[_-]${NEW_VERSION}[_-]" | sort -u || true)
if [ -n "$STILL_ADVERTISED" ]; then
  echo "  Kept at their current version (platform not in this release):"
  echo "$STILL_ADVERTISED" | sed 's/^/    /'
fi

# user-manual - footer version in all HTML files
# user-manual - footer version in all HTML files. Match only the footer
# pattern, NOT every "vX.Y.Z" — index.html also lists past-version <h3>
# headings in the cumulative changelog and those must stay intact.
for f in "$PROJECT_ROOT"/user-manual/*.html; do
  sed -i '' "s/&middot; v${OLD_VERSION} &middot;/\&middot; v${NEW_VERSION} \&middot;/g" "$f"
done
echo "  ✓ user-manual/*.html (footers)"

# user-manual/search.js — only the "What's New in vX.Y.Z" entry, not every "v"
sed -i '' "s/What's New in v${OLD_VERSION}/What's New in v${NEW_VERSION}/g" \
  "$PROJECT_ROOT/user-manual/search.js"
echo "  ✓ user-manual/search.js"

# landing/updates.json — the manifest the in-app update notice reads. Only the
# channels served off the GitHub release move here; Apple and Google are still
# reviewing at this point, so their entries are left for the store watch to
# move once each store reports the build actually live. Deliberately a script
# rather than a sed: a blanket version substitution would rewrite the play
# channel too, and send Play users to a listing with nothing new on it.
MANIFEST_CHANNELS=""
builds macos   && MANIFEST_CHANNELS="${MANIFEST_CHANNELS:+$MANIFEST_CHANNELS,}dmg"
builds windows && MANIFEST_CHANNELS="${MANIFEST_CHANNELS:+$MANIFEST_CHANNELS,}win"
builds linux   && MANIFEST_CHANNELS="${MANIFEST_CHANNELS:+$MANIFEST_CHANNELS,}linux"
builds android && MANIFEST_CHANNELS="${MANIFEST_CHANNELS:+$MANIFEST_CHANNELS,}apk"
if [ -x "$PROJECT_ROOT/venv/bin/python" ]; then
  "$PROJECT_ROOT/venv/bin/python" "$PROJECT_ROOT/test-script/update_download_manifest.py" "${NEW_VERSION}" --only "$MANIFEST_CHANNELS"
else
  python3 "$PROJECT_ROOT/test-script/update_download_manifest.py" "${NEW_VERSION}" --only "$MANIFEST_CHANNELS"
fi
echo "  ✓ landing/updates.json (download channels)"

# The in-app manual downloads user-manual/manifest.json to decide whether the
# copy on someone's device is current. The footer rewrite above changes every
# page, so the manifest has to be rebuilt or installed copies keep reporting
# themselves up to date against a version that no longer matches.
if [ -x "$PROJECT_ROOT/venv/bin/python" ]; then
  "$PROJECT_ROOT/venv/bin/python" "$PROJECT_ROOT/test-script/generate_manual_manifest.py" > /dev/null
  echo "  ✓ user-manual/manifest.json"
else
  echo "  ! venv missing — user-manual/manifest.json NOT regenerated"
fi

# Update Cargo.lock — bump ONLY the opendraft package version. Do NOT run
# `cargo generate-lockfile`/`cargo update`: that re-resolves every dependency to
# the latest version and pulls in incompatible Tauri releases (wry/tauri-runtime)
# that break the build. The pinned dependency versions must stay as-is.
echo ""
echo "  Updating Cargo.lock (opendraft version only)..."
perl -0pi -e "s/(name = \"opendraft\"\nversion = \")${OLD_VERSION}(\")/\${1}${NEW_VERSION}\${2}/" \
  "$PROJECT_ROOT/src-tauri/Cargo.lock"
echo "  ✓ src-tauri/Cargo.lock"

echo ""

# ── Step 2: Commit, push branch, create tag ──────────────────────────────────
echo "=== Step 2/4: Pushing release branch and tag ==="
git add -A
git commit -m "Bump version to ${NEW_VERSION}"
git push origin "$BRANCH"
echo "  ✓ Branch ${BRANCH} pushed"

# Tag the release branch — this triggers CI. A release that leaves platforms
# out says so in an annotated tag, which the plan job in release.yml reads.
if [ -n "$SKIP_PLATFORMS" ]; then
  git tag -a "$TAG" -m "Release ${TAG}" -m "skip-platforms: ${SKIP_PLATFORMS}"
else
  git tag "$TAG"
fi
git push origin "$TAG"
echo "  ✓ Tag ${TAG} pushed — CI is now building${SKIP_PLATFORMS:+ (leaving out: ${SKIP_PLATFORMS})}"
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
TMPDIR=$(mktemp -d)

# Every advertised filename, whatever its shape — the rpm's
# OpenDraft-VERSION-1.x86_64.rpm needed a special case when this was built from
# a list of extensions, and no longer does.
while IFS= read -r OLD_NAME; do
  [ -z "$OLD_NAME" ] && continue
  if ! gh release download "$LATEST_TAG" --repo "$REPO" -p "$OLD_NAME" -D "$TMPDIR" 2>/dev/null; then
    echo "    ! ${OLD_NAME} — not on ${LATEST_TAG}, cannot backfill"
    continue
  fi
  # Errors are no longer swallowed: a silent upload failure here is a download
  # link that 404s for every user until the PR merges.
  if gh release upload "$TAG" "$TMPDIR/$OLD_NAME" --repo "$REPO" --clobber; then
    echo "    ✓ ${OLD_NAME}"
  else
    echo "    ! ${OLD_NAME} — upload failed"
  fi
done <<< "$ADVERTISED"
rm -rf "$TMPDIR"

# Prove it, rather than assume it. These are the URLs the website hands out.
echo "  Checking every advertised download resolves..."
DOWNLOAD_BASE="https://github.com/${REPO}/releases/latest/download"
BROKEN=""
while IFS= read -r NAME; do
  [ -z "$NAME" ] && continue
  CODE=$(curl -sS -o /dev/null -w "%{http_code}" -L -r 0-0 --max-time 30 \
    "${DOWNLOAD_BASE}/${NAME}" 2>/dev/null || echo "000")
  case "$CODE" in
    200|206) echo "    ✓ ${NAME}" ;;
    *)       echo "    ✗ ${NAME} → HTTP ${CODE}"; BROKEN="${BROKEN} ${NAME}" ;;
  esac
done <<< "$ADVERTISED"

if [ -n "$BROKEN" ]; then
  echo ""
  echo "WARNING: these download links are broken right now:${BROKEN}"
  echo "  Users following them get a 404 until the PR in step 4 is merged."
  echo "  Merge it promptly, or upload the missing files to ${TAG} by hand."
  echo ""
fi

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

# Remove old-version binaries now that links on main point to new version —
# except those still advertised, for a platform this release left out.
echo "  Cleaning up old-version binaries from release..."
while IFS= read -r OLD_NAME; do
  [ -z "$OLD_NAME" ] && continue
  if grep -qxF "$OLD_NAME" <<< "$STILL_ADVERTISED"; then
    echo "    · keeping ${OLD_NAME} (still advertised)"
    continue
  fi
  gh release delete-asset "$TAG" "$OLD_NAME" --repo "$REPO" -y 2>/dev/null
done <<< "$ADVERTISED"
echo "  ✓ Old-version binaries removed"

# Switch back to main
git checkout main
git pull origin main

# Clean up release branch
git branch -d "$BRANCH" 2>/dev/null || true
git push origin --delete "$BRANCH" 2>/dev/null || true
echo "  ✓ Cleaned up release branch"
