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

export const veryStrictLimiter = rateLimit({
  windowMs: config.rateLimitWindowMs,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
