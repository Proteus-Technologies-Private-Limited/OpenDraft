import { Hocuspocus } from '@hocuspocus/server';
import type {
  onAuthenticatePayload,
  onConnectPayload,
  onDisconnectPayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
  onChangePayload,
} from '@hocuspocus/server';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as Y from 'yjs';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { WebSocketServer } from 'ws';

import { config } from './config';
import { initDB } from './db';
import { verifyAccessToken } from './services/tokenService';
import * as auditService from './services/auditService';
import authRoutes from './routes/auth';
import { standardLimiter } from './middleware/rateLimit';

// ── Initialize database ──
initDB();

// ── Data directory for Yjs documents ──
const DATA_DIR = config.dataDir;
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function docPath(documentName: string): string {
  const safeName = documentName.replace(/\//g, '--');
  return path.join(DATA_DIR, `${safeName}.yjs`);
}

// ── Backend invite token validation ──

interface CollabSession {
  token: string;
  project_id: string;
  script_id: string;
  collaborator_name: string;
  role: string;
  active: boolean;
}

async function validateInviteToken(token: string): Promise<CollabSession | null> {
  try {
    const res = await fetch(`${config.backendUrl}/collab/session/${token}`);
    if (!res.ok) return null;
    return await res.json() as CollabSession;
  } catch (err) {
    console.error('Invite token validation failed:', err);
    return null;
  }
}

// ── Hocuspocus WebSocket server ──

const hocuspocus = new Hocuspocus({
  name: 'OpenDraft Collaboration Server',

  async onAuthenticate(data: onAuthenticatePayload) {
    const rawToken = data.token;
    if (!rawToken) {
      throw new Error('No authentication token provided');
    }

    let userId: string | null = null;
    let userEmail: string | null = null;
    let inviteToken: string;

    // Parse compound token format: "jwt:<access_token>|invite:<invite_token>"
    if (rawToken.includes('|')) {
      const parts: Record<string, string> = {};
      for (const segment of rawToken.split('|')) {
        const colonIdx = segment.indexOf(':');
        if (colonIdx > 0) {
          parts[segment.slice(0, colonIdx)] = segment.slice(colonIdx + 1);
        }
      }

      // Validate JWT if present — but don't reject if it's expired;
      // the invite token is the primary auth, JWT is supplementary identity
      if (parts.jwt) {
        const jwtPayload = verifyAccessToken(parts.jwt);
        if (jwtPayload) {
          userId = jwtPayload.sub;
          userEmail = jwtPayload.email;
        } else {
          console.warn('JWT expired/invalid — continuing with invite token only');
        }
      }

      inviteToken = parts.invite || '';
    } else {
      // Legacy: plain invite token (backward compatibility)
      inviteToken = rawToken;
    }

    if (!inviteToken) {
      throw new Error('No invite token provided');
    }

    // Validate invite token against backend
    const session = await validateInviteToken(inviteToken);
    if (!session) {
      throw new Error('Invalid or expired invite token');
    }

    // Store session info in the connection context
    data.context.user = {
      id: userId,
      email: userEmail,
      name: session.collaborator_name,
      projectId: session.project_id,
      scriptId: session.script_id,
      role: session.role || 'editor',
    };

    auditService.logEvent('connect', userId, data.documentName, {
      name: session.collaborator_name,
      role: session.role,
    });
  },

  async onConnect(data: onConnectPayload) {
    const user = data.context?.user;
    console.log(`Client connected to document: ${data.documentName} (${user?.name || 'unknown'}, role: ${user?.role || 'unknown'})`);
  },

  async onDisconnect(data: onDisconnectPayload) {
    const user = data.context?.user;
    console.log(`Client disconnected from document: ${data.documentName} (${user?.name || 'unknown'})`);
    auditService.logEvent('disconnect', user?.id || null, data.documentName, {
      name: user?.name,
    });
  },

  async onChange(data: onChangePayload) {
    // Enforce viewer role — reject writes
    if (data.context?.user?.role === 'viewer') {
      throw new Error('Viewer cannot edit');
    }
  },

  async onLoadDocument(data: onLoadDocumentPayload) {
    const filePath = docPath(data.documentName);

    if (fs.existsSync(filePath)) {
      try {
        const binary = fs.readFileSync(filePath);
        const update = new Uint8Array(binary);
        Y.applyUpdate(data.document, update);
        console.log(`Document loaded from disk: ${data.documentName}`);
      } catch (err) {
        console.error(`Failed to load document ${data.documentName}:`, err);
      }
    } else {
      console.log(`New document (no persisted state): ${data.documentName}`);
    }

    auditService.logEvent('document_load', null, data.documentName);
    return data.document;
  },

  async onStoreDocument(data: onStoreDocumentPayload) {
    const filePath = docPath(data.documentName);

    try {
      const state = Y.encodeStateAsUpdate(data.document);
      fs.writeFileSync(filePath, Buffer.from(state));
      console.log(`Document stored: ${data.documentName}`);
    } catch (err) {
      console.error(`Failed to store document ${data.documentName}:`, err);
    }

    auditService.logEvent('document_store', null, data.documentName);
  },
});

// ── Express app for REST API ──

const app = express();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use(express.json());
app.use(standardLimiter);

// Auth routes
app.use('/auth', authRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'opendraft-collab' });
});

// Reset a document's persisted Yjs state (called by host before starting a new collab session)
app.post('/api/reset-document', async (req, res) => {
  const { documentName, token } = req.body;
  if (!documentName || !token) {
    res.status(400).json({ error: 'documentName and token are required' });
    return;
  }

  // Validate the invite token to ensure the caller is authorized
  const session = await validateInviteToken(token);
  if (!session) {
    res.status(403).json({ error: 'Invalid or expired token' });
    return;
  }

  // If the document is still in Hocuspocus memory, close connections to force unload.
  // This triggers onStoreDocument (which re-writes the file), so we must delete the file AFTER.
  const doc = hocuspocus.documents?.get(documentName);
  if (doc) {
    hocuspocus.closeConnections(documentName);
    // Brief wait for cleanup to complete
    await new Promise((r) => setTimeout(r, 100));
    console.log(`Document reset (connections closed): ${documentName}`);
  }

  // Delete the persisted .yjs file so the next connection starts fresh
  const filePath = docPath(documentName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Document reset (file deleted): ${documentName}`);
  }

  res.json({ status: 'ok' });
});

// ── HTTP(S) server with WebSocket upgrade ──

const PORT = config.port;
let httpServer: http.Server | https.Server;

if (config.tlsCert && config.tlsKey) {
  const cert = fs.readFileSync(config.tlsCert);
  const key = fs.readFileSync(config.tlsKey);
  httpServer = https.createServer({ cert, key }, app);
  console.log('TLS enabled (wss://)');
} else {
  httpServer = http.createServer(app);
  console.log('TLS disabled (ws://)');
}

// WebSocket server (noServer mode — we handle upgrade manually)
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    // Pass the upgraded WebSocket connection to Hocuspocus
    hocuspocus.handleConnection(ws, request);
  });
});

httpServer.listen(PORT, () => {
  const protocol = config.tlsCert ? 'wss' : 'ws';
  console.log(`OpenDraft Collaboration Server running on port ${PORT}`);
  console.log(`  WebSocket: ${protocol}://localhost:${PORT}`);
  console.log(`  REST API:  ${config.tlsCert ? 'https' : 'http'}://localhost:${PORT}`);
  console.log(`  Backend:   ${config.backendUrl}`);
});
