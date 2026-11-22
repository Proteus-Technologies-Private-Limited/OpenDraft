/**
 * scriptApi — per-script dispatcher that picks `cloudApi` (remote HTTP) or
 * `api` (local SQLite on Tauri / HTTP on web) based on the script's origin
 * stored in projectStore.
 *
 * Rule: "mode follows the file". A script opened from the cloud saves back
 * to the cloud; a locally-created script saves locally. The editor calls
 * into this module instead of `api` directly, so save/load/delete routing
 * just works.
 */

import { useProjectStore } from '../stores/projectStore';
import { api } from './api';
import { cloudApi } from './cloudApi';
import { offlineCloud } from './offlineCloud';
import { refreshDeviceScript, wakeDeviceProjectSync } from './deviceProjectSync';
import type { ScriptResponse } from './api';

function pickFor(projectId: string, scriptId: string) {
  const isCloud = useProjectStore.getState().isCloudScript(projectId, scriptId);
  return isCloud ? cloudApi : api;
}

export const scriptApi = {
  getScript: async (projectId: string, scriptId: string): Promise<ScriptResponse> => {
    if (pickFor(projectId, scriptId) === cloudApi) return offlineCloud.getScript(projectId, scriptId);
    await refreshDeviceScript(projectId, scriptId).catch(error => console.warn('[cloud] local script refresh:', error));
    return api.getScript(projectId, scriptId);
  },

  saveScript: async (
    projectId: string,
    scriptId: string,
    data: {
      title?: string;
      content?: Record<string, unknown>;
      color?: string;
      pinned?: boolean;
      sort_order?: number;
    },
  ): Promise<ScriptResponse> => {
    const client = pickFor(projectId, scriptId);
    if (client === cloudApi && data.content !== undefined
      && data.title === undefined && data.color === undefined && data.pinned === undefined && data.sort_order === undefined) {
      return offlineCloud.saveScript(projectId, scriptId, data.content);
    }
    const result = await client.saveScript(projectId, scriptId, data);
    if (client === api && data.content !== undefined) wakeDeviceProjectSync(projectId);
    return result;
  },

  deleteScript: async (
    projectId: string,
    scriptId: string,
  ): Promise<{ message: string }> => {
    const result = await pickFor(projectId, scriptId).deleteScript(projectId, scriptId);
    // Clean up the cloud-script marker so a subsequent create with the same
    // (projectId, scriptId) does not resurrect a stale cloud routing.
    useProjectStore.getState().unmarkCloudScript(projectId, scriptId);
    return result;
  },
};
