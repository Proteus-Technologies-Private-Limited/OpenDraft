import { Server } from '@hocuspocus/server';
import type {
  onAuthenticatePayload,
  onConnectPayload,
  onDisconnectPayload,
  onLoadDocumentPayload,
  onStoreDocumentPayload,
} from '@hocuspocus/server';
import * as fs from 'fs';
import * as path from 'path';
import * as Y from 'yjs';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000/api';
const PORT = parseInt(process.env.PORT || '4000', 10);
const DATA_DIR = path.join(__dirname, '..', 'data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function docPath(documentName: string): string {
  const safeName = documentName.replace(/\//g, '--');
  return path.join(DATA_DIR, `${safeName}.yjs`);
}

interface CollabSession {
  token: string;
  project_id: string;
  script_id: string;
  collaborator_name: string;
  active: boolean;
}

async function validateToken(token: string): Promise<CollabSession | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/collab/session/${token}`);
    if (!res.ok) return null;
    return await res.json() as CollabSession;
  } catch (err) {
    console.error('Token validation failed:', err);
    return null;
  }
}

const server = new Server({
  name: 'OpenDraft Collaboration Server',

  async onAuthenticate(data: onAuthenticatePayload) {
    const token = data.token;
    if (!token) {
      throw new Error('No authentication token provided');
    }

    const session = await validateToken(token);
    if (!session) {
      throw new Error('Invalid or expired invite token');
    }

    // Store session info in the connection context
    data.context.user = {
      name: session.collaborator_name,
      projectId: session.project_id,
      scriptId: session.script_id,
    };
  },

  async onConnect(data: onConnectPayload) {
    console.log(`Client connected to document: ${data.documentName} (${data.context?.user?.name || 'unknown'})`);
  },

  async onDisconnect(data: onDisconnectPayload) {
    console.log(`Client disconnected from document: ${data.documentName} (${data.context?.user?.name || 'unknown'})`);
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
  },
});

server.listen(PORT);
console.log(`OpenDraft Collaboration Server running on port ${PORT}`);
console.log(`Backend URL: ${BACKEND_URL}`);
