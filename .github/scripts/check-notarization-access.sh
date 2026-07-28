#!/bin/bash
#
# Preflight for the macOS notarization credentials.
#
# `notarytool history` is the cheapest authenticated call there is: it needs the
# same Apple ID, team id and app-specific password the notarization at the end of
# the build will use, and it returns in seconds. Running it FIRST means a broken
# account state fails the job before ten minutes of compiling, with a message
# that says what to do — rather than as a 403 buried in tauri-action output, or
# as notarytool hanging until the step timeout.
#
# Exits 0 when notarization should work, 1 when it definitely will not.

set -uo pipefail

if [ -z "${APPLE_ID:-}" ] || [ -z "${APPLE_PASSWORD:-}" ] || [ -z "${APPLE_TEAM_ID:-}" ]; then
  echo "::notice::Apple notarization secrets are not configured — skipping the check."
  echo "The build will produce an unsigned/un-notarized bundle."
  exit 0
fi

echo "Checking notarization access for team ${APPLE_TEAM_ID}..."

OUTPUT=$(xcrun notarytool history \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" 2>&1) && STATUS=0 || STATUS=$?

if [ "$STATUS" -eq 0 ]; then
  echo "✓ Notarization service reachable and the account is in good standing."
  exit 0
fi

echo "$OUTPUT"
echo ""

# Apple reports an unsigned or lapsed Program License Agreement as a 403. It is
# the single most common cause of a macOS release failing after months of
# working, because Apple expires the agreement on its own schedule.
if echo "$OUTPUT" | grep -qi "agreement"; then
  echo "::error::Apple notarization is blocked: the team's legal agreement is missing or expired."
  echo ""
  echo "Nothing in this repository can fix this. An Account Holder must:"
  echo "  1. Sign in at https://developer.apple.com/account"
  echo "  2. Accept any pending Apple Developer Program License Agreement"
  echo "  3. Check App Store Connect → Business (Agreements, Tax, and Banking)"
  echo "     at https://appstoreconnect.apple.com/business for pending agreements"
  echo ""
  echo "Re-run this workflow once the agreement shows as active."
  exit 1
fi

if echo "$OUTPUT" | grep -qiE "unable to authenticate|invalid credentials|401"; then
  echo "::error::Apple rejected the notarization credentials."
  echo "Check the APPLE_ID, APPLE_PASSWORD (app-specific password) and"
  echo "APPLE_TEAM_ID repository secrets. App-specific passwords are revoked"
  echo "when the Apple ID password changes."
  exit 1
fi

echo "::error::Could not reach the Apple notarization service (see output above)."
exit 1
