/**
 * projectApi — per-project dispatcher that picks `cloudApi` (remote HTTP) or
 * `api` (local SQLite on Tauri / HTTP on web) based on the project's origin
 * stored in projectStore.
 *
 * Same "mode follows the file" rule as scriptApi, lifted up to project-level
 * reads/writes (ProjectList, ProjectView). Without this, a cloud project
 * opened from the project-list "Cloud" tab would have its scripts and
 * metadata served by the local SQLite api and either 404 or silently misroute.
 */

import { useProjectStore } from '../stores/projectStore';
import { api, type ProjectProperties } from './api';
import { cloudApi } from './cloudApi';
import { offlineCloud } from './offlineCloud';

function pick(projectId: string) {
  return useProjectStore.getState().isCloudProject(projectId) ? cloudApi : api;
}

export const projectApi = {
  getProject: (id: string) => (pick(id) === cloudApi ? offlineCloud : api).getProject(id),

  listScripts: (projectId: string, includePreview: boolean = false) =>
    (pick(projectId) === cloudApi ? offlineCloud : api).listScripts(projectId, includePreview),

  updateProject: (
    id: string,
    data: { name?: string; color?: string; pinned?: boolean; sort_order?: number; properties?: Partial<ProjectProperties> },
  ) => pick(id).updateProject(id, data),

  deleteProject: async (id: string) => {
    const client = pick(id) === cloudApi ? offlineCloud : api;
    const result = await client.deleteProject(id);
    // Drop the cloud-project marker so a subsequent local create with the
    // same id (extremely unlikely, but cheap to be defensive) doesn't get
    // stuck routing to the cloud.
    useProjectStore.getState().unmarkCloudProject(id);
    return result;
  },
};
