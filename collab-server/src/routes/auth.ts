import { Router } from 'express';
import { z } from 'zod';
import { OAuth2Client } from 'google-auth-library';
import * as userService from '../services/userService';
import type { UserRow } from '../db';
import * as tokenService from '../services/tokenService';
import * as emailService from '../services/emailService';
import * as auditService from '../services/auditService';
import * as deviceService from '../services/deviceService';
import type { DeviceInfo } from '../services/deviceService';
import { requireAuth } from '../middleware/auth';
import { strictLimiter, veryStrictLimiter } from '../middleware/rateLimit';
import { config } from '../config';

const router = Router();

// ── Validation schemas ──

const deviceInfoSchema = z.object({
  deviceId: z.string().min(8).max(128),
  deviceName: z.string().min(1).max(120),
  platform: z.string().max(64).optional().nullable(),
}).optional();

const passwordRule = z.string().min(8).max(128).regex(
  /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).+$/,
  'Password must contain at least one uppercase letter, one lowercase letter, and one digit'
);

const registerSchema = z.object({
  email: z.string().email().max(255),
  password: passwordRule,
  displayName: z.string().min(1).max(100),
  device: deviceInfoSchema,
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  device: deviceInfoSchema,
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
  device: deviceInfoSchema,
});

const verifyDeviceSchema = z.object({
  challengeId: z.string().min(8).max(128),
  code: z.string().length(6),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordRule,
});

const deleteAccountSchema = z.object({
  // Password confirmation when the user has one. Google-only accounts can
  // omit this and supply confirmation: 'DELETE' instead.
  password: z.string().optional(),
  confirmation: z.string().optional(),
});

// ── Helpers ──

function userResponse(user: UserRow | null) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    emailVerified: Boolean(user.email_verified),
    twoFactorEnabled: Boolean(user.two_factor_enabled),
  };
}

function getClientIp(req: any): string {
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function pickDeviceInfo(req: any, body: any): DeviceInfo | null {
  const device = body?.device;
  if (!device || typeof device.deviceId !== 'string' || typeof device.deviceName !== 'string') {
    return null;
  }
  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    platform: typeof device.platform === 'string' ? device.platform : null,
    userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
    ipAddress: getClientIp(req),
  };
}

function deviceResponse(row: {
  device_id: string;
  device_name: string;
  platform: string | null;
  user_agent: string | null;
  ip_address: string | null;
  trusted: number;
  first_seen_at: string;
  last_seen_at: string;
}, currentDeviceId?: string | null): Record<string, unknown> {
  return {
    deviceId: row.device_id,
    deviceName: row.device_name,
    platform: row.platform,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    trusted: Boolean(row.trusted),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    current: currentDeviceId ? row.device_id === currentDeviceId : false,
  };
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
    const deviceInfo = pickDeviceInfo(req, parsed.data);

    // Check if email already exists
    const existing = await userService.findUserByEmail(email);
    if (existing) {
      res.status(409).json({ error: 'Email already registered' });
      return;
    }

    let user = await userService.createUser(email, password, displayName);
    const accessToken = tokenService.generateAccessToken(user.id, user.email);
    const { token: refreshToken } = await tokenService.generateRefreshToken(
      user.id,
      deviceInfo?.deviceId ?? null,
    );

    // The device that created the account is implicitly trusted — no 2FA prompt
    // on the very first login.
    if (deviceInfo) {
      await deviceService.recordTrustedDevice(user.id, deviceInfo);
    }

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
    const deviceInfo = pickDeviceInfo(req, parsed.data);
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

    // Device tracking + (opt-in) new-device 2FA.
    //
    //   • If 2FA is enabled and the (user, device) pair is new, we email a
    //     6-digit code and respond with a challenge — no tokens are issued
    //     until the client posts the code to /verify-device.
    //   • If 2FA is off (default), login proceeds normally; the device is
    //     recorded as trusted and we email a "new device signed in" notice
    //     so the user can spot unauthorized access.
    //   • If no device info was provided (older clients), nothing changes —
    //     login works exactly as before.
    if (deviceInfo) {
      const known = await deviceService.findDevice(user.id, deviceInfo.deviceId);
      if (!known) {
        if (user.two_factor_enabled) {
          const challenge = await deviceService.createDeviceChallenge(user.id, deviceInfo);
          if (!challenge) {
            res.status(429).json({ error: 'Too many new-device verification attempts. Please try again later.' });
            return;
          }
          await emailService.sendNewDeviceCode(
            user.email,
            challenge.code,
            deviceInfo.deviceName,
            deviceInfo.ipAddress ?? null,
          );
          await auditService.logEvent(
            'new_device_challenge',
            user.id,
            null,
            { device: deviceInfo.deviceName, deviceId: deviceInfo.deviceId },
            getClientIp(req),
          );
          res.status(200).json({
            deviceVerificationRequired: true,
            challengeId: challenge.challengeId,
            message: 'A verification code was emailed to confirm this new device.',
          });
          return;
        }
        // 2FA off — record the device and notify by email (best-effort).
        await deviceService.recordTrustedDevice(user.id, deviceInfo);
        try {
          await emailService.sendNewDeviceNotice(
            user.email,
            deviceInfo.deviceName,
            deviceInfo.ipAddress ?? null,
          );
        } catch { /* notification only — never block login */ }
      } else {
        await deviceService.touchDevice(user.id, deviceInfo.deviceId, deviceInfo.ipAddress ?? null);
      }
    }

    const accessToken = tokenService.generateAccessToken(user.id, user.email);
    const { token: refreshToken } = await tokenService.generateRefreshToken(
      user.id,
      deviceInfo?.deviceId ?? null,
    );

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

router.post('/verify-device', strictLimiter, async (req, res) => {
  try {
    const parsed = verifyDeviceSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }

    const challenge = await deviceService.consumeDeviceChallenge(
      parsed.data.challengeId,
      parsed.data.code,
    );
    if (!challenge) {
      res.status(400).json({ error: 'Invalid or expired verification code' });
      return;
    }

    const user = await userService.findUserById(challenge.user_id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    await deviceService.recordTrustedDevice(user.id, {
      deviceId: challenge.device_id,
      deviceName: challenge.device_name,
      userAgent: challenge.user_agent,
      platform: challenge.platform,
      ipAddress: challenge.ip_address,
    });

    const accessToken = tokenService.generateAccessToken(user.id, user.email);
    const { token: refreshToken } = await tokenService.generateRefreshToken(user.id, challenge.device_id);

    await auditService.logEvent(
      'new_device_verified',
      user.id,
      null,
      { device: challenge.device_name, deviceId: challenge.device_id },
      getClientIp(req),
    );

    res.json({
      user: userResponse(user),
      accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('Verify device error:', err);
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

    const deviceInfo = pickDeviceInfo(req, parsed.data);
    if (deviceInfo) {
      await deviceService.recordTrustedDevice(user.id, deviceInfo);
    }

    const accessToken = tokenService.generateAccessToken(user.id, user.email);
    const { token: refreshToken } = await tokenService.generateRefreshToken(
      user.id,
      deviceInfo?.deviceId ?? null,
    );

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

// ── Change password ──
router.post('/change-password', requireAuth, veryStrictLimiter, async (req, res) => {
  try {
    const parsed = changePasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.flatten().fieldErrors });
      return;
    }

    const user = await userService.findUserById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!user.password_hash) {
      // Google-only account: no password to change. Asks the user to set one
      // by signing out and using "Forgot password" — which we don't have yet,
      // so this is a hard error for now.
      res.status(400).json({ error: 'This account does not use a password (signed in with Google).' });
      return;
    }

    if (!(await userService.verifyPassword(user, parsed.data.currentPassword))) {
      await auditService.logEvent(
        'login_failed',
        user.id,
        null,
        { reason: 'change_password_wrong_current' },
        getClientIp(req),
      );
      res.status(401).json({ error: 'Current password is incorrect' });
      return;
    }

    if (parsed.data.currentPassword === parsed.data.newPassword) {
      res.status(400).json({ error: 'New password must be different from the current password' });
      return;
    }

    await userService.updatePassword(user.id, parsed.data.newPassword);
    // Invalidate every refresh token so other devices are forced to sign in
    // again with the new password.
    await tokenService.revokeAllRefreshTokens(user.id);

    await auditService.logEvent('password_changed', user.id, null, null, getClientIp(req));

    // Best-effort notification email — don't fail the request if SMTP fails.
    const ua = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : 'Unknown device';
    try { await emailService.sendPasswordChangedNotice(user.email, ua); } catch { /* ignore */ }

    res.json({ message: 'Password updated. Please sign in again on all devices.' });
  } catch (err) {
    console.error('Change password error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Devices ──
router.get('/devices', requireAuth, async (req, res) => {
  try {
    const devices = await deviceService.listDevices(req.user!.id);
    const currentDeviceId = typeof req.headers['x-device-id'] === 'string'
      ? req.headers['x-device-id']
      : null;
    res.json({
      devices: devices.map((d) => deviceResponse(d, currentDeviceId)),
    });
  } catch (err) {
    console.error('List devices error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/devices/:deviceId', requireAuth, async (req, res) => {
  try {
    const rawDeviceId = req.params.deviceId;
    const deviceId = Array.isArray(rawDeviceId) ? rawDeviceId[0] : rawDeviceId;
    if (!deviceId || typeof deviceId !== 'string' || deviceId.length > 128) {
      res.status(400).json({ error: 'Invalid deviceId' });
      return;
    }
    const removed = await deviceService.deleteDevice(req.user!.id, deviceId);
    if (!removed) {
      res.status(404).json({ error: 'Device not found' });
      return;
    }
    await auditService.logEvent(
      'device_revoked',
      req.user!.id,
      null,
      { deviceId },
      getClientIp(req),
    );
    res.json({ message: 'Device revoked' });
  } catch (err) {
    console.error('Revoke device error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Two-factor verification preference ──
const twoFactorSchema = z.object({ enabled: z.boolean() });

router.post('/two-factor', requireAuth, async (req, res) => {
  try {
    const parsed = twoFactorSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }
    await userService.setTwoFactorEnabled(req.user!.id, parsed.data.enabled);
    const fresh = await userService.findUserById(req.user!.id);
    res.json({ user: userResponse(fresh) });
  } catch (err) {
    console.error('Toggle 2FA error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Account deletion (Apple Guideline 5.1.1(v)) ──
//
// Permanently deletes the user record and every server-side artifact that
// belongs to it. The frontend is expected to clear local state and prompt the
// user to download any cloud screenplays *before* hitting this endpoint —
// the server cannot recover deleted data.
router.delete('/account', requireAuth, veryStrictLimiter, async (req, res) => {
  try {
    const parsed = deleteAccountSchema.safeParse(req.body || {});
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input' });
      return;
    }

    const user = await userService.findUserById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // For password accounts: require current password. For Google-only
    // accounts the JWT itself is sufficient, but require the literal string
    // "DELETE" as a typed confirmation so it cannot be triggered by accident.
    if (user.password_hash) {
      if (!parsed.data.password) {
        res.status(400).json({ error: 'Password is required to confirm account deletion' });
        return;
      }
      if (!(await userService.verifyPassword(user, parsed.data.password))) {
        await auditService.logEvent(
          'login_failed',
          user.id,
          null,
          { reason: 'delete_account_wrong_password' },
          getClientIp(req),
        );
        res.status(401).json({ error: 'Password is incorrect' });
        return;
      }
    } else {
      if (parsed.data.confirmation !== 'DELETE') {
        res.status(400).json({ error: 'Type DELETE to confirm account deletion' });
        return;
      }
    }

    const emailForNotice = user.email;

    await userService.deleteUser(user.id);

    await auditService.logEvent('account_deleted', null, null, { email: emailForNotice }, getClientIp(req));

    try { await emailService.sendAccountDeletedNotice(emailForNotice); } catch { /* ignore */ }

    res.json({ message: 'Account deleted' });
  } catch (err) {
    console.error('Delete account error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
