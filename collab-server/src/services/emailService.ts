import * as nodemailer from 'nodemailer';
import { v4 as uuidv4 } from 'uuid';
import { getDB } from '../db';
import { config } from '../config';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!config.smtpHost) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPass || '' } : undefined,
  });

  return transporter;
}

export async function createVerificationCode(userId: string): Promise<string> {
  const db = getDB();
  const code = String(Math.floor(100000 + Math.random() * 900000)); // 6-digit
  const id = uuidv4();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString(); // 15 minutes

  // Invalidate any existing codes for this user
  await db.run('UPDATE email_verifications SET used = 1 WHERE user_id = ? AND used = 0', [userId]);

  await db.run(
    `INSERT INTO email_verifications (id, user_id, code, expires_at, used, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [id, userId, code, expiresAt, now.toISOString()],
  );

  return code;
}

export async function validateVerificationCode(userId: string, code: string): Promise<boolean> {
  const db = getDB();
  const now = new Date().toISOString();

  const row = await db.get<{ id: string }>(
    `SELECT id FROM email_verifications
     WHERE user_id = ? AND code = ? AND used = 0 AND expires_at > ?
     ORDER BY created_at DESC LIMIT 1`,
    [userId, code, now],
  );

  if (!row) return false;

  await db.run('UPDATE email_verifications SET used = 1 WHERE id = ?', [row.id]);
  return true;
}

export async function sendVerificationEmail(email: string, code: string): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    console.log(`[Email] SMTP not configured. Verification code for ${email}: ${code}`);
    return;
  }

  await transport.sendMail({
    from: config.smtpFrom,
    to: email,
    subject: 'OpenDraft - Verify your email',
    text: `Your verification code is: ${code}\n\nThis code expires in 15 minutes.`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #333;">OpenDraft Email Verification</h2>
        <p>Your verification code is:</p>
        <div style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 20px; background: #f5f5f5; border-radius: 8px; margin: 16px 0;">
          ${code}
        </div>
        <p style="color: #666; font-size: 13px;">This code expires in 15 minutes.</p>
      </div>
    `,
  });
}
