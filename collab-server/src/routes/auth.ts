import { Router } from 'express';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import * as userService from '../services/userService';
import type { UserRow } from '../db';
import * as tokenService from '../services/tokenService';
import * as emailService from '../services/emailService';
import * as auditService from '../services/auditService';
import { requireAuth } from '../middleware/auth';
import { strictLimiter, veryStrictLimiter } from '../middleware/rateLimit';
import { config } from '../config';

const router = Router();

// ── Validation schemas ──

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: z.string().min(8).max(128).regex(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
    'Password must contain at least one uppercase letter, one lowercase letter, and one digit'
  ),
  displayName: z.string().min(1).max(100),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const verifyEmailSchema = z.object({
  code: z.string().length(6),
});

const verifyEmailLinkSchema = z.object({
  email: z.string().email().max(255),
  code: z.string().length(6),
});

const googleLoginSchema = z.object({
  idToken: z.string().min(1),
});

// ── Helpers ──

function userResponse(user: UserRow | null) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    emailVerified: Boolean(user.email_verified),
  };
}

function getClientIp(req: any): string {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

// ── Routes ──

router.post('/register', veryStrictLimiter, async (req, res) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const { email, password, displayName } = parsed.data;

    // Check if email already exists
    const existing = await userService.findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    let user = await userService.createUser(email, password, displayName);
    const accessToken = tokenService.generateAccessToken(user.id, user.email);
    const { token: refreshToken } = await tokenService.generateRefreshToken(user.id);

    // Send verification email if SMTP is configured, otherwise auto-verify
    if (config.smtpHost) {
      const code = await emailService.createVerificationCode(user.id);
      await emailService.sendVerificationEmail(user.email, code);
    } else {
      await userService.setEmailVerified(user.id);
      user = (await userService.findUserById(user.id))!;
    }

    await auditService.logEvent('register', user.id, null, { email: user.email }, getClientIp(req));

    res.status(201).json({
      user: userResponse(user),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/login', strictLimiter, async (req, res) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }

    const { email, password } = parsed.data;
    const user = await userService.findUserByEmail(email);

    if (!user) {
      await auditService.logEvent('login_failed', null, null, { email, reason: 'user_not_found' }, getClientIp(req));
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!(await userService.verifyPassword(user, password))) {
      await auditService.logEvent('login_failed', null, null, { email, reason: 'wrong_password' }, getClientIp(req));
      res.status(401).json({ error: 'Invalid email or password' });
      return;
    }

    const accessToken = tokenService.generateAccessToken(user.id, user.email);
    const { token: refreshToken } = await tokenService.generateRefreshToken(user.id);

    await auditService.logEvent('login', user.id, null, { email: user.email }, getClientIp(req));

    res.json({
      user: userResponse(user),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/refresh', strictLimiter, async (req, res) => {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }

    const result = await tokenService.rotateRefreshToken(parsed.data.refreshToken);
    if (!result) {
      res.status(401).json({ error: 'Invalid or expired refresh token' });
      return;
    }

    await auditService.logEvent('token_refresh', result.userId, null, null, getClientIp(req));

    res.json({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/logout', async (req, res) => {
  try {
    const parsed = refreshSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }

    await tokenService.revokeRefreshToken(parsed.data.refreshToken);
    await auditService.logEvent('logout', null, null, null, getClientIp(req));

    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/verify-email', requireAuth, veryStrictLimiter, async (req, res) => {
  try {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid code format' });
      return;
    }

    const valid = await emailService.validateVerificationCode(req.user!.id, parsed.data.code);
    if (!valid) {
      res.status(400).json({ error: 'Invalid or expired verification code' });
      return;
    }

    await userService.setEmailVerified(req.user!.id);
    await auditService.logEvent('email_verified', req.user!.id, null, null, getClientIp(req));

    res.json({ message: 'Email verified' });
  } catch (err) {
    console.error('Verify email error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Magic-link variant: unauthenticated — the link emailed to the user carries
// {email, code}. Validates the code, marks email as verified, and returns a
// fresh token pair so the frontend can log the user in on click.
router.post('/verify-email-link', veryStrictLimiter, async (req, res) => {
  try {
    const parsed = verifyEmailLinkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const user = await userService.findUserByEmail(parsed.data.email);
    if (!user) {
      res.status(400).json({ error: 'Invalid or expired verification link' });
      return;
    }

    const valid = await emailService.validateVerificationCode(user.id, parsed.data.code);
    if (!valid) {
      res.status(400).json({ error: 'Invalid or expired verification link' });
      return;
    }

    await userService.setEmailVerified(user.id);
    const freshUser = (await userService.findUserById(user.id))!;

    const accessToken = tokenService.generateAccessToken(freshUser.id, freshUser.email);
    const { token: refreshToken } = await tokenService.generateRefreshToken(freshUser.id);

    await auditService.logEvent('email_verified', freshUser.id, null, { via: 'magic_link' }, getClientIp(req));

    res.json({
      user: userResponse(freshUser),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Verify email-link error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/resend-verification', requireAuth, veryStrictLimiter, async (req, res) => {
  try {
    const user = await userService.findUserById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (user.email_verified) {
      res.status(400).json({ error: 'Email already verified' });
      return;
    }

    const code = await emailService.createVerificationCode(user.id);
    await emailService.sendVerificationEmail(user.email, code);

    res.json({ message: 'Verification email sent' });
  } catch (err) {
    console.error('Resend verification error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/google', strictLimiter, async (req, res) => {
  try {
    if (!config.googleClientId) {
      res.status(501).json({ error: 'Google login is not configured on this server' });
      return;
    }

    const parsed = googleLoginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }

    const client = new OAuth2Client(config.googleClientId);
    const ticket = await client.verifyIdToken({
      idToken: parsed.data.idToken,
      audience: config.googleClientId,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email || !payload.sub) {
      res.status(400).json({ error: 'Invalid Google token' });
      return;
    }

    const user = await userService.findOrCreateGoogleUser(
      payload.sub,
      payload.email,
      payload.name || payload.email.split('@')[0],
    );

    const accessToken = tokenService.generateAccessToken(user.id, user.email);
    const { token: refreshToken } = await tokenService.generateRefreshToken(user.id);

    await auditService.logEvent('google_login', user.id, null, { email: user.email }, getClientIp(req));

    res.json({
      user: userResponse(user),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(401).json({ error: 'Google authentication failed' });
  }
});

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await userService.findUserById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(userResponse(user));
  } catch (err) {
    console.error('Get me error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Return whether Google login is available (for frontend UI)
router.get('/config', (req, res) => {
  res.json({
    googleEnabled: Boolean(config.googleClientId),
    emailVerificationRequired: Boolean(config.smtpHost),
  });
});

export default router;
