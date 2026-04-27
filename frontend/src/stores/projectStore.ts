import { create } from 'zustand';
import type { ProjectInfo, ScriptMeta, VersionInfo } from '../services/api';
import { useSettingsStore } from './settingsStore';

/**
 * Origin of the currently-open script:
 *   'local' — stored on this device (SQLite on desktop/mobile, or the Python
 *             backend when running as a plain web app without sign-in).
 *   'cloud' — stored on the OpenDraft server for the signed-in user. All
 *             reads/writes for this script go over HTTP, even on desktop.
 * The editor routes save/load through scriptApi.ts which picks the right
 * implementation based on this value.
 */
export type ScriptSource = 'local' | 'cloud';

/**
 * Cloud-script markers are scoped per user: `opendraft:cloudScripts:<userId>`.
 * When a different user signs in on the same device they must not see the
 * previous user's cloud files flagged in the UI — cloud storage is per-account.
 * Anonymous browsing uses the reserved "anonymous" bucket (never populated
 * since cloud operations require sign-in, but kept to avoid a null key).
 */
const CLOUD_SCRIPTS_PREFIX = 'opendraft:cloudScripts:';
const CLOUD_PROJECTS_PREFIX = 'opendraft:cloudProjects:';

function userBucket(): string {
  const uid = useSettingsStore.getState().collabAuth.user?.id;
  return uid || 'anonymous';
}

function loadCloudKeys(userId: string): Record<string, true> {
  try {
    const raw = localStorage.getItem(CLOUD_SCRIPTS_PREFIX + userId);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveCloudKeys(userId: string, keys: Record<string, true>): void {
  try {
    localStorage.setItem(CLOUD_SCRIPTS_PREFIX + userId, JSON.stringify(keys));
  } catch { /* quota / private mode */ }
}

function loadCloudProjects(userId: string): Record<string, true> {
  try {
    const raw = localStorage.getItem(CLOUD_PROJECTS_PREFIX + userId);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return {};
}

function saveCloudProjects(userId: string, keys: Record<string, true>): void {
  try {
    localStorage.setItem(CLOUD_PROJECTS_PREFIX + userId, JSON.stringify(keys));
  } catch { /* quota / private mode */ }
}

function keyFor(projectId: string, scriptId: string): string {
  return `${projectId}/${scriptId}`;
}

interface ProjectState {
  currentProject: ProjectInfo | null;
  currentScriptId: string | null;
  projects: ProjectInfo[];
  scripts: ScriptMeta[];
  versions: VersionInfo[];
  versionHistoryOpen: boolean;
  scriptReloadKey: number;

  /** Source of the currently-open script. Drives save/load routing. */
  activeScriptSource: ScriptSource;
  /** Persistent set of project/script keys whose origin is cloud. */
  cloudScripts: Record<string, true>;
  /** Persistent set of project IDs that live on the cloud. Used by ProjectView
   *  and the ProjectList "Cloud" tab to dispatch project-level reads/writes
   *  to cloudApi instead of the local SQLite api. */
  cloudProjects: Record<string, true>;

  setCurrentProject: (project: ProjectInfo | null) => void;
  setCurrentScriptId: (id: string | null) => void;
  setProjects: (projects: ProjectInfo[]) => void;
  setScripts: (scripts: ScriptMeta[]) => void;
  setVersions: (versions: VersionInfo[]) => void;
  setVersionHistoryOpen: (open: boolean) => void;
  triggerScriptReload: () => void;

  setActiveScriptSource: (src: ScriptSource) => void;
  markCloudScript: (projectId: string, scriptId: string) => void;
  unmarkCloudScript: (projectId: string, scriptId: string) => void;
  isCloudScript: (projectId: string, scriptId: string) => boolean;

  markCloudProject: (projectId: string) => void;
  unmarkCloudProject: (projectId: string) => void;
  isCloudProject: (projectId: string) => boolean;
  /** Replace the cloud-project set with the given list. Used after listing
   *  cloud projects to drop entries that no longer exist on the server. */
  syncCloudProjects: (projectIds: string[]) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  currentProject: null,
  currentScriptId: null,
  projects: [],
  scripts: [],
  versions: [],
  versionHistoryOpen: false,
  scriptReloadKey: 0,

  activeScriptSource: 'local',
  cloudScripts: loadCloudKeys(userBucket()),
  cloudProjects: loadCloudProjects(userBucket()),

  setCurrentProject: (project) => set({ currentProject: project }),
  setCurrentScriptId: (id) => set({ currentScriptId: id }),
  setProjects: (projects) => set({ projects }),
  setScripts: (scripts) => set({ scripts }),
  setVersions: (versions) => set({ versions }),
  setVersionHistoryOpen: (open) => set({ versionHistoryOpen: open }),
  triggerScriptReload: () => set((state) => ({ scriptReloadKey: state.scriptReloadKey + 1 })),

  setActiveScriptSource: (src) => set({ activeScriptSource: src }),
  markCloudScript: (projectId, scriptId) => {
    const uid = userBucket();
    const keys = { ...get().cloudScripts, [keyFor(projectId, scriptId)]: true as const };
    saveCloudKeys(uid, keys);
    set({ cloudScripts: keys });
  },
  unmarkCloudScript: (projectId, scriptId) => {
    const uid = userBucket();
    const keys = { ...get().cloudScripts };
    delete keys[keyFor(projectId, scriptId)];
    saveCloudKeys(uid, keys);
    set({ cloudScripts: keys });
  },
  isCloudScript: (projectId, scriptId) =>
    // A script is cloud-routed if it was explicitly marked OR if it lives in
    // a cloud project. Without the project-level fallback, scripts opened
    // from the ProjectList "Cloud" tab would dispatch to the local SQLite api
    // (no per-script marker exists yet) and 404.
    Boolean(
      get().cloudScripts[keyFor(projectId, scriptId)] ||
      get().cloudProjects[projectId],
    ),

  markCloudProject: (projectId) => {
    const uid = userBucket();
    const next = { ...get().cloudProjects, [projectId]: true as const };
    saveCloudProjects(uid, next);
    set({ cloudProjects: next });
  },
  unmarkCloudProject: (projectId) => {
    const uid = userBucket();
    const next = { ...get().cloudProjects };
    delete next[projectId];
    saveCloudProjects(uid, next);
    set({ cloudProjects: next });
  },
  isCloudProject: (projectId) => Boolean(get().cloudProjects[projectId]),
  syncCloudProjects: (projectIds) => {
    const uid = userBucket();
    const next: Record<string, true> = {};
    for (const id of projectIds) next[id] = true;
    saveCloudProjects(uid, next);
    set({ cloudProjects: next });
  },
}));

// Reload cloud-script markers whenever the signed-in user changes. This is
// the enforcement for "user B on this device must not see user A's cloud
// files" — local SQLite files stay visible (shared device), but cloud
// metadata is strictly per-account.
useSettingsStore.subscribe((state, prev) => {
  const newId = state.collabAuth.user?.id;
  const oldId = prev.collabAuth.user?.id;
  if (newId === oldId) return;
  useProjectStore.setState({
    cloudScripts: loadCloudKeys(newId || 'anonymous'),
    cloudProjects: loadCloudProjects(newId || 'anonymous'),
  });
});
