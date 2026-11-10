import { describe, expect, it } from 'vitest';
import { migratePosturePreferences, postureChoices, savePostureChoice, type PosturePreferences } from './posturePreferences';

describe('foldable posture choices', () => {
  it('defaults each posture independently', () => {
    expect(postureChoices({}, 'folded')).toEqual({ toolbarMode: 'hidden', viewLayout: 'phone' });
    expect(postureChoices({}, 'open')).toEqual({ toolbarMode: 'compact', viewLayout: 'page' });
  });
  it('migrates explicit choices to both postures without mutating ordinary settings', () => {
    const saved: PosturePreferences = { toolbarMode: 'comfortable', viewLayout: 'page' };
    expect(migratePosturePreferences(saved)).toEqual({ folded: saved, open: saved });
    expect(postureChoices(saved, 'open')).toEqual({ toolbarMode: 'comfortable', viewLayout: 'page' });
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
  it('uses posture defaults only for settings with no legacy choice', () => {
    expect(postureChoices({ toolbarMode: 'comfortable' }, 'folded')).toEqual({ toolbarMode: 'comfortable', viewLayout: 'phone' });
    expect(postureChoices({ toolbarMode: 'comfortable' }, 'open')).toEqual({ toolbarMode: 'comfortable', viewLayout: 'page' });
    expect(postureChoices({ viewLayout: 'phone' }, 'open')).toEqual({ toolbarMode: 'compact', viewLayout: 'phone' });
  });

});
