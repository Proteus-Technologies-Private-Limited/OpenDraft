import { getDB } from '../db';
import type { CollabSessionRow } from '../db';
import { config } from '../config';

export interface CollabSession {
  token: string;
  project_id: string;
  script_id: string;
  collaborator_name: string;
  role: string;
  active: boolean;
  session_nonce?: string;
  created_at?: string;
  expires_at?: string;
}

/**
 * Validate an invite token.
 *
 * Checks the collab server's own database first (for invites created by
 * desktop/mobile Tauri clients). Falls back to the Python backend for
 * invites created via the web app.
 */
export async function validateInviteToken(token: string): Promise<CollabSession | null> {
  const preview = token.slice(0, 8) + '...';

  // 1. Check our own database first
  try {
    const db = getDB();
    const session = await db.get<CollabSessionRow>(
      'SELECT * FROM collab_sessions WHERE token = ? AND active = 1',
      [token],
    );
    if (session && new Date(session.expires_at) > new Date()) {
      console.log(`[validateToken] ${preview} → found in collab-server DB`);
      return {
        token: session.token,
        project_id: session.project_id,
        script_id: session.script_id,
        collaborator_name: session.collaborator_name,
        role: session.role,
        active: true,
        session_nonce: session.session_nonce,
        created_at: session.created_at,
        expires_at: session.expires_at,
      };
    }
    console.log(`[validateToken] ${preview} → not in collab-server DB, trying Python backends`);
  } catch (err) {
    console.log(`[validateToken] ${preview} → DB query failed:`, err);
  }

  // 2. Fall back to configured backend URLs (Python web backend)
  for (const url of config.backendUrls) {
    const backendUrl = `${url}/collab/session/${token}`;
    console.log(`[validateToken] ${preview} → trying ${url}`);
    try {
      const res = await fetch(backendUrl);
      console.log(`[validateToken] ${preview} → ${url} responded ${res.status}`);
      if (res.ok) return await res.json() as CollabSession;
    } catch (err) {
      console.log(`[validateToken] ${preview} → ${url} unreachable:`, (err as Error).message);
    }
  }
  console.log(`[validateToken] ${preview} → not found in any backend`);
  return null;
}
