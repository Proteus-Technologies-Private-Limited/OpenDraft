import * as dotenv from 'dotenv';
import * as path from 'path';
import * as crypto from 'crypto';

dotenv.config();

export interface ServerConfig {
  host: string;
  port: number;
  backendUrl: string;
  backendUrls: string[];
  jwtSecret: string;
  jwtAccessExpiry: string;
  jwtRefreshExpiry: string;
  bcryptRounds: number;
  dataDir: string;
  tlsCert: string | null;
  tlsKey: string | null;
  googleClientId: string | null;
  googleClientSecret: string | null;
  smtpHost: string | null;
  smtpPort: number;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFrom: string;
  appUrl: string;
  rateLimitWindowMs: number;
  rateLimitMax: number;
  corsOrigins: string[];

  // Database
  dbType: 'sqlite' | 'postgresql';
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;

  // Document eviction
  docIdleTimeoutMinutes: number;

  // WebSocket connection limits
  wsMaxConnectionsPerIp: number;
  wsMaxConnectionsPerUser: number;
}

function loadConfig(): ServerConfig {
  const isProduction = process.env.NODE_ENV === 'production';

  const jwtSecret = process.env.JWT_SECRET ||
    (isProduction ? '' : crypto.randomBytes(32).toString('hex'));

  if (isProduction && !process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET must be set in production');
    process.exit(1);
  }

  return {
    host: process.env.HOST || '0.0.0.0',
    port: parseInt(process.env.PORT || '4000', 10),
    // Comma-separated list of backend URLs to try for token validation
    // (supports both the dev server on 8008 and the Tauri sidecar on 18321)
    backendUrl: process.env.BACKEND_URL || 'http://localhost:8008/api',
    backendUrls: (process.env.BACKEND_URL || 'http://localhost:8008/api,http://localhost:18321/api')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
    jwtSecret,
    jwtAccessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    jwtRefreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
    bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    dataDir: process.env.DATA_DIR || path.join(__dirname, '..', 'data'),
    tlsCert: process.env.TLS_CERT || null,
    tlsKey: process.env.TLS_KEY || null,
    googleClientId: process.env.GOOGLE_CLIENT_ID || null,
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || null,
    smtpHost: process.env.SMTP_HOST || null,
    smtpPort: parseInt(process.env.SMTP_PORT || '587', 10),
    smtpUser: process.env.SMTP_USER || null,
    smtpPass: process.env.SMTP_PASS || null,
    smtpFrom: process.env.SMTP_FROM || 'noreply@opendraft.app',
    // Base URL of the frontend — used to build magic-link verification URLs.
    appUrl: (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, ''),
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10),
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000,http://localhost:8008,http://localhost:18321,tauri://localhost,https://tauri.localhost').split(',').map(s => s.trim()),

    // Database (default: sqlite)
    dbType: (process.env.DB_TYPE === 'postgresql' ? 'postgresql' : 'sqlite') as 'sqlite' | 'postgresql',
    dbHost: process.env.DB_HOST || 'localhost',
    dbPort: parseInt(process.env.DB_PORT || '5432', 10),
    dbName: process.env.DB_NAME || 'opendraft_collab',
    dbUser: process.env.DB_USER || 'opendraft',
    dbPassword: process.env.DB_PASSWORD || '',

    // Document eviction (0 = disabled)
    docIdleTimeoutMinutes: parseInt(process.env.DOC_IDLE_TIMEOUT_MINUTES || '30', 10),

    // WebSocket connection limits (0 = unlimited)
    wsMaxConnectionsPerIp: parseInt(process.env.WS_MAX_CONNECTIONS_PER_IP || '50', 10),
    wsMaxConnectionsPerUser: parseInt(process.env.WS_MAX_CONNECTIONS_PER_USER || '10', 10),
  };
}

export const config = loadConfig();
