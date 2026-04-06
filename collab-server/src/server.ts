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
import { initDB, getDB } from './db';
import { verifyAccessToken } from './services/tokenService';
import * as auditService from './services/auditService';
import authRoutes from './routes/auth';
import collabRoutes from './routes/collab';
import { standardLimiter } from './middleware/rateLimit';

// ── Data directory for Yjs documents ──
const DATA_DIR = config.dataDir;
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function docPath(documentName: string): string {
  const safeName = documentName.replace(/\//g, '--');
  return path.join(DATA_DIR, `${safeName}.yjs`);
}

// ── Invite token validation ──
// Extracted to services/collabValidation.ts to avoid circular imports
// (routes/collab.ts also needs it).

import { validateInviteToken } from './services/collabValidation';
import type { CollabSession } from './services/collabValidation';
export { validateInviteToken, type CollabSession };

// ── Connection tracking for WebSocket limits ──

const connectionsPerIp = new Map<string, number>();
const connectionsPerUser = new Map<string, number>();

function incrementCounter(map: Map<string, number>, key: string): number {
  const count = (map.get(key) || 0) + 1;
  map.set(key, count);
  return count;
}

function decrementCounter(map: Map<string, number>, key: string): void {
  const count = (map.get(key) || 1) - 1;
  if (count <= 0) {
    map.delete(key);
  } else {
    map.set(key, count);
  }
}

// ── Document activity tracking for eviction ──

const docLastActivity = new Map<string, number>();

function touchDocument(documentName: string): void {
  docLastActivity.set(documentName, Date.now());
}

function startDocumentEviction(): void {
  const timeoutMinutes = config.docIdleTimeoutMinutes;
  if (timeoutMinutes <= 0) {
    console.log('Document eviction: disabled');
    return;
  }

  console.log(`Document eviction: idle documents unloaded after ${timeoutMinutes} minutes`);

  setInterval(() => {
    const now = Date.now();
    const timeoutMs = timeoutMinutes * 60 * 1000;

    for (const [docName, lastActive] of docLastActivity.entries()) {
      if (now - lastActive > timeoutMs) {
        const idleMinutes = Math.round((now - lastActive) / 60_000);
        console.log(`Evicting idle document: ${docName} (idle ${idleMinutes}m)`);
        hocuspocus.closeConnections(docName);
        docLastActivity.delete(docName);
      }
    }
  }, 60 * 1000); // Check every minute
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
      console.error(`[onAuthenticate] Invalid or expired invite token: ${inviteToken.slice(0, 12)}... for doc: ${data.documentName}`);
      throw new Error('Invalid or expired invite token');
    }

    // Per-user connection limit check
    const userKey = userId || session.collaborator_name;
    if (config.wsMaxConnectionsPerUser > 0) {
      const userCount = connectionsPerUser.get(userKey) || 0;
      if (userCount >= config.wsMaxConnectionsPerUser) {
        console.warn(`[onAuthenticate] User connection limit reached for: ${userKey} (${userCount}/${config.wsMaxConnectionsPerUser})`);
        throw new Error('Too many connections for this user');
      }
    }
    incrementCounter(connectionsPerUser, userKey);

    // Store session info in the connection context
    data.context.user = {
      id: userId,
      email: userEmail,
      name: session.collaborator_name,
      projectId: session.project_id,
      scriptId: session.script_id,
      role: session.role || 'editor',
      _connKey: userKey, // internal: for tracking disconnections
    };

    await auditService.logEvent('connect', userId, data.documentName, {
      name: session.collaborator_name,
      role: session.role,
    });
  },

  async onConnect(data: onConnectPayload) {
    const user = data.context?.user;
    console.log(`Client connected to document: ${data.documentName} (${user?.name || 'unknown'}, role: ${user?.role || 'unknown'})`);
    touchDocument(data.documentName);
  },

  async onDisconnect(data: onDisconnectPayload) {
    const user = data.context?.user;
    console.log(`Client disconnected from document: ${data.documentName} (${user?.name || 'unknown'})`);

    // Decrement per-user connection counter
    if (user?._connKey) {
      decrementCounter(connectionsPerUser, user._connKey);
    }

    await auditService.logEvent('disconnect', user?.id || null, data.documentName, {
      name: user?.name,
    });
  },

  async onChange(data: onChangePayload) {
    // Viewers may trigger onChange during initial Yjs sync (the Collaboration
    // extension seeds the fragment even with editable:false).  Silently ignore
    // these instead of crashing the server.
    if (data.context?.user?.role === 'viewer') {
      return;
    }
    touchDocument(data.documentName);
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

    touchDocument(data.documentName);
    await auditService.logEvent('document_load', null, data.documentName);
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

    await auditService.logEvent('document_store', null, data.documentName);
  },
});

// ── Express app for REST API ──

const app = express();

// Trust proxy headers (required behind Cloud Run / load balancers for correct
// client IP in rate limiting and X-Forwarded-* headers)
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', true);
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Tauri, mobile apps)
    if (!origin) return callback(null, true);

    // Allow explicitly configured origins
    if (config.corsOrigins.includes(origin)) return callback(null, true);

    // Allow any private/local network origin (192.168.*, 10.*, 172.16-31.*, localhost, 127.*)
    try {
      const url = new URL(origin);
      const host = url.hostname;
      if (
        host === 'localhost' ||
        host.startsWith('127.') ||
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
        host === '::1' ||
        host === 'tauri.localhost'
      ) {
        return callback(null, true);
      }
    } catch { /* invalid URL, fall through to reject */ }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());

// Request logger — logs all incoming HTTP requests
app.use((req, _res, next) => {
  console.log(`[http] ${req.method} ${req.path} from ${req.ip} origin=${req.headers.origin || 'none'}`);
  next();
});

app.use(standardLimiter);

// Auth routes
app.use('/auth', authRoutes);

// Collab invite management (create, validate, list, revoke)
// Used by both Tauri desktop/mobile clients and the web frontend.
app.use('/api/collab', collabRoutes);

// Health check with memory & connection stats
app.get('/health', (_req, res) => {
  const mem = process.memoryUsage();
  const totalWsConnections = Array.from(connectionsPerIp.values()).reduce((a, b) => a + b, 0);

  res.json({
    status: 'ok',
    service: 'opendraft-collab',
    uptime: Math.round(process.uptime()),
    database: config.dbType,
    memory: {
      rss_mb: Math.round(mem.rss / 1024 / 1024),
      heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024),
      heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024),
      external_mb: Math.round(mem.external / 1024 / 1024),
    },
    documents: {
      tracked: docLastActivity.size,
    },
    connections: {
      total: totalWsConnections,
      unique_ips: connectionsPerIp.size,
      unique_users: connectionsPerUser.size,
    },
  });
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

  docLastActivity.delete(documentName);
  res.json({ status: 'ok' });
});

// Close all connections for a document (called by host after revoking all sessions)
app.post('/api/close-document', async (req, res) => {
  const { documentName } = req.body;
  if (!documentName) {
    res.status(400).json({ error: 'documentName is required' });
    return;
  }

  // Close all active WebSocket connections for this document.
  // Guests will try to reconnect — their revoked tokens will fail auth,
  // triggering onAuthenticationFailed on the client which exits collab mode.
  hocuspocus.closeConnections(documentName);
  console.log(`Document closed (all connections kicked): ${documentName}`);

  // Also clean up the persisted Yjs file
  const filePath = docPath(documentName);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Document file deleted: ${documentName}`);
  }

  docLastActivity.delete(documentName);
  res.json({ status: 'ok' });
});

// ── Bootstrap: init DB then start HTTP(S) server ──

async function main(): Promise<void> {
  // Initialize database (async — needed for PostgreSQL)
  await initDB();

  const HOST = config.host;
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
    // Per-IP connection limit check
    const ip = request.socket.remoteAddress || 'unknown';
    if (config.wsMaxConnectionsPerIp > 0) {
      const ipCount = connectionsPerIp.get(ip) || 0;
      if (ipCount >= config.wsMaxConnectionsPerIp) {
        console.warn(`[upgrade] IP connection limit reached for: ${ip} (${ipCount}/${config.wsMaxConnectionsPerIp})`);
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      incrementCounter(connectionsPerIp, ip);

      ws.on('close', () => {
        decrementCounter(connectionsPerIp, ip);
      });

      // Pass the upgraded WebSocket connection to Hocuspocus
      hocuspocus.handleConnection(ws, request);
    });
  });

  // Start document eviction timer
  startDocumentEviction();

  httpServer.listen(PORT, HOST, () => {
    const protocol = config.tlsCert ? 'wss' : 'ws';
    console.log(`OpenDraft Collaboration Server running on ${HOST}:${PORT}`);
    console.log(`  WebSocket: ${protocol}://${HOST}:${PORT}`);
    console.log(`  REST API:  ${config.tlsCert ? 'https' : 'http'}://${HOST}:${PORT}`);
    console.log(`  Backend:   ${config.backendUrl}`);
    console.log(`  Database:  ${config.dbType}`);
    console.log(`  WS limits: ${config.wsMaxConnectionsPerIp}/IP, ${config.wsMaxConnectionsPerUser}/user`);
  });
}

main().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
