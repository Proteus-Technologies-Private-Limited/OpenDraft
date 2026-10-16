import rateLimit from 'express-rate-limit';
import { config } from '../config';

export const standardLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: config.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

export const strictLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

// Token refresh is routine, not a guess at a credential: every signed-in tab
// renews its access token every few minutes, and a refused refresh signs the
// user out. It gets its own counter so sign-in attempts cannot use it up, and
// a higher ceiling so a household or office sharing one IP is not cut off.
export const refreshLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});

export const veryStrictLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
