/**
 * A suggester's stable id: what their suggestions are signed with beside
 * their name, so two collaborators who join under the same name still own
 * only their own suggestions.
 *
 * It is worked out from the invite token the collaborator joined with, the
 * same way here and on the collab server (collab-server/src/server.ts), so
 * neither has to tell the other. A hash, not the token: the id is written
 * into the script for everyone to read, and the token is what lets you in.
 */
import { sha256Hex } from './sha256';

export function suggesterIdOf(inviteToken: string): string | null {
  return inviteToken ? sha256Hex(`opendraft-suggester:${inviteToken}`).slice(0, 16) : null;
}
