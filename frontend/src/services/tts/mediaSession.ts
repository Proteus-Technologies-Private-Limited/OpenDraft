/** Browser/Android WebView media controls. Native background execution and
 * iOS MPRemoteCommandCenter are separate integrations; this API alone does
 * not keep a suspended web view or its JavaScript player running. */
export interface ReadMediaState {
  status: 'idle' | 'loading' | 'playing' | 'paused' | 'error';
  title: string;
  speaker: string;
}
export interface ReadMediaCommands {
  play: () => void;
  pause: () => void;
  stop: () => void;
  nexttrack: () => void;
  previoustrack: () => void;
}

export function tableReadMediaSession(session: MediaSession, commands: ReadMediaCommands) {
  const registered: MediaSessionAction[] = [];
  for (const [action, callback] of Object.entries(commands)) {
    try {
      session.setActionHandler(action as MediaSessionAction, callback);
      registered.push(action as MediaSessionAction);
    } catch { /* An engine can expose Media Session but omit some actions. */ }
  }
  let lastMetadata = '';
  return {
    update(state: ReadMediaState) {
      session.playbackState = state.status === 'playing' || state.status === 'loading' ? 'playing'
        : state.status === 'paused' ? 'paused' : 'none';
      const key = JSON.stringify([state.title, state.speaker]);
      if (key === lastMetadata) return;
      lastMetadata = key;
      if (typeof MediaMetadata !== 'undefined') {
        session.metadata = new MediaMetadata({ title: state.title, artist: state.speaker });
      }
    },
    dispose() {
      for (const action of registered) {
        try { session.setActionHandler(action, null); } catch { /* unsupported */ }
      }
      session.playbackState = 'none';
      session.metadata = null;
    },
  };
}
