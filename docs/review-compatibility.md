# Review compatibility and text preservation

Formatting proposals introduce a schema mark that OpenDraft 2.8.x cannot read.
With y-prosemirror 1.3.7 an unknown mark can cause deletion of its containing
shared text. A release-note warning is not sufficient protection.

## Collaboration

The client verifies the configured collaboration server's `/health` response
before constructing a provider, and checks again before every authentication or
reconnect. The server reports `reviewProtocol`; the protocol must match the
client. Failure leaves the current document/session unchanged and explains that
the app and server must be updated. Requests go only to the collaboration server
already selected by the writer; no screenplay content is sent in the health check.

The authenticated WebSocket independently enforces the same protocol **before
loading or syncing any document**, for hosts, editors, viewers and suggesters.
Credentials use an `od-review.<protocol>.<encoded credentials>` envelope. A legacy
server cannot extract a valid invite from it, so it refuses authentication. This
also protects against a health request and WebSocket reaching different versions
behind a load balancer. An updated server refuses legacy plain/compound tokens.
Authentication failure stops reconnection and preserves any local text as an
unsaved copy rather than discarding a provisional collaborative document.
The envelope preserves the existing invite/JWT validation and suggester identity;
it is compatibility negotiation, not a replacement for authentication.

Deploy the updated server and app together and restart existing sessions. Mixed
versions cannot collaborate, even in a script with no current proposals. This
avoids an older editor joining just before a new proposal is made. The rejection
happens before shared text can reach an unsupported schema. Do not remove the
authentication guard while keeping the new review schema.

Persisted Yjs state is written under `DATA_DIR/review-v<protocol>/`, so a
previous server cannot load newer schema marks after a rollback. Upgrades may
read older protocol directories (and the original legacy directory), but never
write newer updates back there. Preserve these directories when backing up the
server. Previously unprotected experimental state should be backed up and the
session restarted on updated apps before any rollback.

## Library, native files and recovery

When a document contains formatting proposals, persisted screenplay content is
the **accepted baseline**, containing only marks older clients already know.
The live document and all pending review data are retained under the top-level
`_reviewSnapshot` metadata key, with a review version and SHA-256 of the baseline.
This includes pending text suggestions when they coexist with format proposals.
The active editor is never replaced with that fallback during save.

Compatible clients restore the review snapshot before constructing editor nodes.
The baseline hash must still match the stored document and the snapshot's own
accepted projection. If another program edited the body, the edited body wins;
old review metadata cannot resurrect earlier text. Unsupported, corrupted or
mismatched snapshots leave the readable baseline intact. Files with no new
review features retain their existing representation.

Older apps can open the accepted screenplay rather than showing an empty script.
**Saving with an older app discards pending review information. Keep the original
native file or a backup, and use an updated app to continue reviewing.** A snapshot
is not permission for an older app to join a live session. Existing files written
by the earlier implementation must be opened and saved in an updated app before
being handed to an older version.

Protection applies to the common save builder, direct cloud/local library writes,
native serialization, linked native files and recovery snapshots. Existing
metadata-aware load paths restore the review; collaboration seeds use that same
loader. External screenplay serializers still output accepted content.

## Verification

Unit tests exercise an actual ProseMirror schema without `suggestionFormat`,
addition/removal baselines, mixed text/style reviews, native round trips, library
writes, recovery, stale edits and malformed metadata. Protocol tests cover old,
new and invalid responses, server downgrade between checks and token envelopes.

After installing frontend/collab dependencies and building the collab server, run
`node test-script/review-compat-smoke.cjs`. It uses real Hocuspocus sockets: compatible
peers sync; legacy host/editor/viewer/suggester tokens are refused before data is
loaded; a new client on a legacy server is refused; existing shared text is intact.
