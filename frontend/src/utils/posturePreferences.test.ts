import { describe, expect, it } from 'vitest';
import { migratePosturePreferences, postureChoices, savePostureChoice, type PosturePreferences } from './posturePreferences';

describe('foldable posture choices', () => {
  it('defaults each posture independently', () => {
    expect(postureChoices({}, 'folded')).toEqual({ toolbarMode: 'hidden', viewLayout: 'phone' });
    expect(postureChoices({}, 'open')).toEqual({ toolbarMode: 'compact', viewLayout: 'page' });
  });
  it('migrates existing choices to folded only, without mutating ordinary settings', () => {
    const saved: PosturePreferences = { toolbarMode: 'comfortable', viewLayout: 'page' };
    expect(migratePosturePreferences(saved)).toEqual({ folded: saved });
    expect(postureChoices(saved, 'open')).toEqual({ toolbarMode: 'compact', viewLayout: 'page' });
    expect(saved.byPosture).toBeUndefined();
  });
  it('keeps each posture and each setting independent across repeated choices', () => {
    let saved: PosturePreferences = {};
    saved = { byPosture: savePostureChoice(saved, 'folded', { toolbarMode: 'comfortable' }) };
    saved = { byPosture: savePostureChoice(saved, 'open', { viewLayout: 'phone' }) };
    saved = { byPosture: savePostureChoice(saved, 'folded', { viewLayout: 'page' }) };
    expect(postureChoices(saved, 'folded')).toEqual({ toolbarMode: 'comfortable', viewLayout: 'page' });
    expect(postureChoices(saved, 'open')).toEqual({ toolbarMode: 'compact', viewLayout: 'phone' });
  });
  it('does not reseed a migrated empty posture map from legacy settings', () => {
    expect(postureChoices({ byPosture: {}, toolbarMode: 'comfortable' }, 'folded').toolbarMode).toBe('hidden');
  });
});
