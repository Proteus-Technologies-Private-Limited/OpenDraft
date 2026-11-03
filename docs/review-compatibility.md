# Review compatibility and text preservation

Formatting proposals introduce a schema mark that OpenDraft 2.8.x cannot read.
With y-prosemirror 1.3.7 an unknown mark can cause deletion of its containing
shared text. A release-note warning is not sufficient protection.

## Collaboration

The client probes the selected server's `/health` once before constructing the
provider. A matching `reviewProtocol` enables formatting suggestions. An older
server, timeout, malformed response or HTTP error disables format suggesting for
that session but still permits ordinary collaboration and text suggestions.
Existing proposals do not block ordinary typing after a failed probe. A server
capability message can establish support later without another HTTP request.
Authentication/reconnect uses a fixed credential; it never repeats the health
check or ends a session over an HTTP failure. A document with pending format
proposals cannot seed a server without verified support; resolve those proposals
first. The check sends no screenplay content or authentication credentials.

Tokens append `|review:1` to the existing invite/JWT compound format. Older
servers ignore that field and still authenticate the invite. Updated servers
allow legacy hosts, editors, viewers and suggesters on ordinary scripts. A
legacy connection is refused only if the document contains `suggestionFormat`.
While any legacy connection is authenticating or connected, updates containing
that mark are refused for **every role**, before applying or broadcasting them.
Checks include initial sync uploads and nested screenplay content. A new client
also disables format suggesting while the server reports legacy peers present.
A rejected local proposal remains on its author's machine; it is not broadcast.
A refused review update exits collaboration instead of leaving an editor that
looks collaborative but cannot sync. Hosts retain their project, script, title
and local edits; guests retain an unsaved local copy.
Resolve it or update the older participants before rejoining.

Reservations cover the gap between authentication and document loading. Update
checks and commits run synchronously in the awaited `beforeHandleMessage` hook, preventing a legacy join
from racing a validated format update. Existing suggester permission checks also
run there; viewer connections remain read-only.

Normal update checks decode only incoming Yjs structs. Already-integrated or
simultaneously deleted formatting structs are ignored. The document is checked
for existing proposals when an older client joins, not on every cursor message.
Refusal reasons include readable guidance for installed older apps.

Collaborative undo/redo is guarded before the Yjs document changes. When format
suggestions are unavailable, a history action is previewed in a temporary local
Y.Doc and refused if it would re-emit a proposal mark. The real document and history
entry remain intact. Typing and unaffected history continue; the blocked action
can run when compatible participants are available. Yjs can re-emit historical
format structs while undoing a later text edit in the same paragraph, even when
the visible result would have no proposal. Such actions are held too; typing
continues, and history in unaffected paragraphs remains available. The preview is confined to
restricted history actions, not ordinary edits or server messages.

Persisted Yjs state is written under `DATA_DIR/review-v1/`. Upgrades read that
first, falling back to the original legacy directory, but never write newer
updates back to the legacy file. Back up both directories. **Rollback does not
restore the latest edits:** an older server reads the pre-upgrade legacy file,
so rolling back without migration silently resurrects old screenplay content.
Before rollback, stop sessions, back up current state, and export the latest
accepted scripts with an updated app into fresh sessions. Do not copy raw
review-v1 Yjs files into the legacy directory; older schemas cannot read them.

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
writes, recovery, stale edits and malformed metadata. Protocol tests cover supported, legacy, unavailable and timed-out servers,
backward-compatible tokens, mixed roles and preservation of the original room
when an incompatible update is rejected.

After building the collab server, run `node test-script/review-compat-smoke.cjs`
for real Hocuspocus sockets: mixed-version ordinary collaboration, new clients on
old servers, format proposals blocked with legacy peers, and unsafe legacy joins
refused without sending screenplay content.
