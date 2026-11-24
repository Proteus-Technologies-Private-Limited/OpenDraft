import { describe, expect, it } from 'vitest';
import { useSettingsStore } from './settingsStore';
import { belongsToPreviousAccount, useProjectStore } from './projectStore';

const signIn = (id: string | null) => {
  const auth = useSettingsStore.getState().collabAuth;
  useSettingsStore.setState({
    collabAuth: { ...auth, accessToken: id ? `token-${id}` : null, user: id ? { ...(auth.user ?? {}), id } as typeof auth.user : null },
  });
};

describe('a cloud screenplay left open across an account change', () => {
  it('is recognised as the previous account, and is ordinary again once that account signs back in', () => {
    signIn('account-a');
    useProjectStore.getState().markCloudProject('cloud-project');
    useProjectStore.getState().markCloudScript('other-project', 'cloud-script');
    expect(belongsToPreviousAccount('cloud-project', 'any')).toBe(false);

    signIn('account-b');
    expect(belongsToPreviousAccount('cloud-project', 'any')).toBe(true);
    expect(belongsToPreviousAccount('other-project', 'cloud-script')).toBe(true);
    // A local screenplay is never affected.
    expect(belongsToPreviousAccount('local-project', 'local-script')).toBe(false);

    signIn('account-a');
    expect(belongsToPreviousAccount('cloud-project', 'any')).toBe(false);
  });

  it('also applies after signing out', () => {
    signIn('account-a');
    useProjectStore.getState().markCloudProject('cloud-project');
    signIn(null);
    expect(belongsToPreviousAccount('cloud-project', 'any')).toBe(true);
  });
});
