import { create } from 'zustand';
import type { ProjectInfo, ScriptMeta, VersionInfo } from '../services/api';

interface ProjectState {
  currentProject: ProjectInfo | null;
  currentScriptId: string | null;
  projects: ProjectInfo[];
  scripts: ScriptMeta[];
  versions: VersionInfo[];
  versionHistoryOpen: boolean;

  setCurrentProject: (project: ProjectInfo | null) => void;
  setCurrentScriptId: (id: string | null) => void;
  setProjects: (projects: ProjectInfo[]) => void;
  setScripts: (scripts: ScriptMeta[]) => void;
  setVersions: (versions: VersionInfo[]) => void;
  setVersionHistoryOpen: (open: boolean) => void;
}

export const useProjectStore = create<ProjectState>((set) => ({
  currentProject: null,
  currentScriptId: null,
  projects: [],
  scripts: [],
  versions: [],
  versionHistoryOpen: false,

  setCurrentProject: (project) => set({ currentProject: project }),
  setCurrentScriptId: (id) => set({ currentScriptId: id }),
  setProjects: (projects) => set({ projects }),
  setScripts: (scripts) => set({ scripts }),
  setVersions: (versions) => set({ versions }),
  setVersionHistoryOpen: (open) => set({ versionHistoryOpen: open }),
}));
