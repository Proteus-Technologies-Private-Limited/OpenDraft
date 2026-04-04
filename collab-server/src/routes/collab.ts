import { Router } from 'express';
import * as crypto from 'crypto';
import { getDB } from '../db';
import type { CollabSessionRow } from '../db';

const router = Router();

/** Generate a URL-safe random token. */
function generateToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

/** Generate a session nonce (shorter, for Yjs room grouping). */
function generateNonce(): string {
  return crypto.randomBytes(8).toString('hex');
}

// ── Create a collaboration invite ────────────────────────────────────────────

router.post('/invite', async (req, res) => {
  try {
    const {
      project_id,
      script_id,
      collaborator_name,
      role = 'editor',
      expires_in_hours = 1,
      session_nonce,
    } = req.body;

    if (!project_id || !script_id || !collaborator_name) {
      res.status(400).json({ error: 'project_id, script_id, and collaborator_name are required' });
      return;
    }

    const db = getDB();
    const token = generateToken();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + expires_in_hours * 60 * 60 * 1000);

    // Determine session nonce: reuse existing active nonce for same project/script,
    // use the provided one, or generate a new one.
    let nonce = session_nonce || '';
    if (!nonce) {
      // Check for an existing active session with the same project/script
      const existing = await db.get<CollabSessionRow>(
        `SELECT session_nonce FROM collab_sessions
         WHERE project_id = ? AND script_id = ? AND active = 1 AND session_nonce != ''
         ORDER BY created_at DESC LIMIT 1`,
        [project_id, script_id],
      );
      nonce = existing?.session_nonce || generateNonce();
    }

    await db.run(
      `INSERT INTO collab_sessions (token, project_id, script_id, collaborator_name, role, active, session_nonce, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [token, project_id, script_id, collaborator_name, role, nonce, now.toISOString(), expiresAt.toISOString()],
    );

    res.status(201).json({
      token,
      project_id,
      script_id,
      collaborator_name,
      role,
      active: true,
      session_nonce: nonce,
      created_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });
  } catch (err) {
    console.error('Create invite error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Validate a session token ─────────────────────────────────────────────────

router.get('/session/:token', async (req, res) => {
  try {
    const db = getDB();
    const session = await db.get<CollabSessionRow>(
      'SELECT * FROM collab_sessions WHERE token = ?',
      [req.params.token],
    );

    if (!session) {
      res.status(404).json({ error: 'Invalid or expired invite' });
      return;
    }

    // Check if expired or revoked
    if (!session.active || new Date(session.expires_at) < new Date()) {
      res.status(404).json({ error: 'Invalid or expired invite' });
      return;
    }

    res.json({
      token: session.token,
      project_id: session.project_id,
      script_id: session.script_id,
      collaborator_name: session.collaborator_name,
      role: session.role,
      active: Boolean(session.active),
      session_nonce: session.session_nonce,
      created_at: session.created_at,
      expires_at: session.expires_at,
    });
  } catch (err) {
    console.error('Validate session error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── List active sessions for a project/script ────────────────────────────────

router.get('/sessions/:projectId/:scriptId', async (req, res) => {
  try {
    const db = getDB();
    const now = new Date().toISOString();

    const sessions = await db.all<CollabSessionRow>(
      `SELECT * FROM collab_sessions
       WHERE project_id = ? AND script_id = ? AND active = 1 AND expires_at > ?
       ORDER BY created_at DESC`,
      [req.params.projectId, req.params.scriptId, now],
    );

    res.json(sessions.map(s => ({
      token: s.token,
      project_id: s.project_id,
      script_id: s.script_id,
      collaborator_name: s.collaborator_name,
      role: s.role,
      active: Boolean(s.active),
      session_nonce: s.session_nonce,
      created_at: s.created_at,
      expires_at: s.expires_at,
    })));
  } catch (err) {
    console.error('List sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Revoke a specific invite ─────────────────────────────────────────────────

router.delete('/session/:token', async (req, res) => {
  try {
    const db = getDB();
    await db.run(
      'UPDATE collab_sessions SET active = 0 WHERE token = ?',
      [req.params.token],
    );
    res.json({ message: 'Session revoked' });
  } catch (err) {
    console.error('Revoke session error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Revoke all invites for a project/script ──────────────────────────────────

router.delete('/sessions/:projectId/:scriptId', async (req, res) => {
  try {
    const db = getDB();
    await db.run(
      'UPDATE collab_sessions SET active = 0 WHERE project_id = ? AND script_id = ?',
      [req.params.projectId, req.params.scriptId],
    );
    res.json({ message: 'All sessions revoked' });
  } catch (err) {
    console.error('Revoke all sessions error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
