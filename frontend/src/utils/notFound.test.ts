import { describe, expect, it } from 'vitest';
import { ApiError } from '../services/api';
import { isNotFoundError } from './notFound';

describe('isNotFoundError', () => {
  it('reads the status of a web or cloud error', () => {
    expect(isNotFoundError(new ApiError(404, null, 'API error 404: Not Found'))).toBe(true);
    expect(isNotFoundError(new ApiError(500, null, 'API error 500: script 404abc failed'))).toBe(false);
  });

  it('recognises the local libraries\' missing project or script', () => {
    expect(isNotFoundError(new Error('Project not found: p1'))).toBe(true);
    expect(isNotFoundError(new Error('Script not found: s1'))).toBe(true);
  });

  it('does not take a "404" inside some other message as missing', () => {
    expect(isNotFoundError(new Error('Failed to read script 4041-aa'))).toBe(false);
    expect(isNotFoundError(new Error('Could not reach the server (404 page cached)'))).toBe(false);
    expect(isNotFoundError('404')).toBe(false);
    expect(isNotFoundError(null)).toBe(false);
  });
});
