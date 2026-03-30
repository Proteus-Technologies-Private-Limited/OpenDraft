import * as dotenv from 'dotenv';
import * as path from 'path';
import * as crypto from 'crypto';

dotenv.config();

export interface ServerConfig {
  port: number;
  backendUrl: string;
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
  rateLimitWindowMs: number;
  rateLimitMax: number;
  corsOrigins: string[];
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
    port: parseInt(process.env.PORT || '4000', 10),
    backendUrl: process.env.BACKEND_URL || 'http://localhost:8000/api',
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
    rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || String(15 * 60 * 1000), 10),
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
    corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173,http://localhost:3000,tauri://localhost,https://tauri.localhost').split(',').map(s => s.trim()),
  };
}

export const config = loadConfig();
