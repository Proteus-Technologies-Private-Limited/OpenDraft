import { getDb } from './db';
import type { ScriptMeta, ScriptResponse } from './api';
import { docHasAnyText } from '../utils/docText';
import { looksLikeTreatment, normalizeFormat } from '../utils/scriptFormat';
import { prepareReviewSave } from '../utils/reviewSave';

export interface DeviceBinding {
  project_id: string;
  scope: string;
  binding_id: string;
  enabled: number;
  generation: string;
  published: number;
  last_synced: number;
}

export interface ScriptBase {
  script_id: string;
  content_hash: string;
  cloud_revision: string;
  device_updated: string;
  cloud_updated: string;
  /** '' normally; 'device' or 'cloud' once a deletion on that side was settled. */
  deleted: '' | 'device' | 'cloud';
  /** Hash of an upload that may have been applied without its reply arriving. */
  sending_hash: string;
}

export async function readBinding(projectId: string): Promise<DeviceBinding | undefined> {
  const db = await getDb();
  const rows = await db.select<DeviceBinding[]>('SELECT * FROM device_project_sync WHERE project_id = $1', [projectId]);
  return rows[0];
}

export async function activeBindings(scope: string): Promise<DeviceBinding[]> {
  const db = await getDb();
  return db.select<DeviceBinding[]>('SELECT sync.* FROM device_project_sync sync JOIN projects p ON p.id = sync.project_id WHERE sync.scope = $1 AND sync.enabled = 1', [scope]);
}

export async function enableBinding(projectId: string, scope: string, bindingId: string, generation: string) {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO device_project_sync (project_id, scope, binding_id, enabled, generation)
     SELECT id, $2, $3, 1, $4 FROM projects WHERE id = $1
     ON CONFLICT(project_id) DO UPDATE SET enabled = 1, generation = excluded.generation
       WHERE device_project_sync.scope = excluded.scope`, [projectId, scope, bindingId, generation],
  );
  return result.rowsAffected > 0;
}

export async function disableBinding(projectId: string, generation: string) {
  const db = await getDb();
  await db.execute('UPDATE device_project_sync SET enabled = 0, generation = $2 WHERE project_id = $1', [projectId, generation]);
}

export async function updateBinding(binding: DeviceBinding, lastSynced?: number) {
  const db = await getDb();
  await db.execute(
    `UPDATE device_project_sync SET published = 1, last_synced = COALESCE($3, last_synced)
     WHERE project_id = $1 AND generation = $2 AND enabled = 1`,
    [binding.project_id, binding.generation, lastSynced ?? null],
  );
}

export async function projectHasLinkedScripts(projectId: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ script_id: string }[]>('SELECT script_id FROM script_files WHERE project_id = $1 LIMIT 1', [projectId]);
  return rows.length > 0;
}

export async function readScriptBases(projectId: string): Promise<ScriptBase[]> {
  const db = await getDb();
  return db.select<ScriptBase[]>('SELECT * FROM device_script_sync WHERE project_id = $1', [projectId]);
}

/** Records what the cloud acknowledged. It describes the cloud's copy, so it is
 * kept whichever generation sent it and even after Stop: only a different
 * counterpart (another binding) may not write here. */
export async function rememberScriptBase(
  binding: DeviceBinding, base: Omit<ScriptBase, 'deleted' | 'sending_hash'>,
) {
  const db = await getDb();
  await db.execute(
    `INSERT INTO device_script_sync
       (project_id, script_id, content_hash, cloud_revision, device_updated, cloud_updated, deleted, sending_hash)
     SELECT project_id, $3, $4, $5, $6, $7, '', '' FROM device_project_sync
     WHERE project_id = $1 AND binding_id = $2
     ON CONFLICT(project_id, script_id) DO UPDATE SET
       content_hash = excluded.content_hash, cloud_revision = excluded.cloud_revision,
       device_updated = excluded.device_updated, cloud_updated = excluded.cloud_updated,
       deleted = '', sending_hash = ''`,
    [binding.project_id, binding.binding_id, base.script_id, base.content_hash, base.cloud_revision,
      base.device_updated, base.cloud_updated],
  );
}

/** Written before an upload, so a reply that never arrives is not mistaken for
 * someone else's change. A row with no revision is a note, not a base. */
export async function noteUploadHash(binding: DeviceBinding, scriptId: string, hash: string) {
  const db = await getDb();
  await db.execute(
    `INSERT INTO device_script_sync
       (project_id, script_id, content_hash, cloud_revision, device_updated, cloud_updated, deleted, sending_hash)
     SELECT project_id, $3, '', '', '', '', '', $4 FROM device_project_sync
     WHERE project_id = $1 AND binding_id = $2
     ON CONFLICT(project_id, script_id) DO UPDATE SET sending_hash = excluded.sending_hash`,
    [binding.project_id, binding.binding_id, scriptId, hash],
  );
}

/** A deletion on one side is not copied to the other. The tombstone keeps the
 * remaining copy from reading as a conflict, or from being recreated. */
export async function tombstoneScript(binding: DeviceBinding, scriptId: string, side: 'device' | 'cloud') {
  const db = await getDb();
  await db.execute(
    `INSERT INTO device_script_sync
       (project_id, script_id, content_hash, cloud_revision, device_updated, cloud_updated, deleted, sending_hash)
     SELECT project_id, $3, '', '', '', '', $4, '' FROM device_project_sync
     WHERE project_id = $1 AND binding_id = $2
     ON CONFLICT(project_id, script_id) DO UPDATE SET deleted = excluded.deleted, sending_hash = ''`,
    [binding.project_id, binding.binding_id, scriptId, side],
  );
}

export async function forgetScriptBase(binding: DeviceBinding, scriptId: string) {
  const db = await getDb();
  await db.execute(
    `DELETE FROM device_script_sync WHERE project_id = $1 AND script_id = $2
       AND EXISTS (SELECT 1 FROM device_project_sync WHERE project_id = $1 AND binding_id = $3)`,
    [binding.project_id, scriptId, binding.binding_id],
  );
}

/** Begin again with the signed-in account: a new cloud counterpart and no
 * remembered bases. The generation changes first, so work still in flight for
 * the old counterpart cannot write into the new one. */
export async function restartBinding(projectId: string, scope: string, bindingId: string, generation: string) {
  const db = await getDb();
  const result = await db.execute(
    `UPDATE device_project_sync SET scope = $2, binding_id = $3, generation = $4, enabled = 1,
       published = 0, last_synced = 0 WHERE project_id = $1`,
    [projectId, scope, bindingId, generation],
  );
  if (!result.rowsAffected) return false;
  await db.execute('DELETE FROM device_script_sync WHERE project_id = $1', [projectId]);
  return true;
}

export async function readDeviceContent(projectId: string, scriptId: string) {
  const db = await getDb();
  const rows = await db.select<{ raw: string | null; updated_at: string }[]>(
    `SELECT sc.content AS raw, s.updated_at FROM scripts s
     LEFT JOIN script_content sc ON sc.script_id = s.id WHERE s.project_id = $1 AND s.id = $2`,
    [projectId, scriptId],
  );
  const row = rows[0];
  if (!row) return undefined;
  const content = row.raw === null ? null : JSON.parse(row.raw) as ScriptResponse['content'];
  return { ...row, content };
}

/** A pull may race a local save or a stop action. Only replace the exact body
 * read before the request, in the same statement that verifies the binding. */
export async function pullDeviceContent(
  binding: DeviceBinding, meta: ScriptMeta, remote: ScriptResponse['content'],
  original?: Awaited<ReturnType<typeof readDeviceContent>>,
  stillOpening = () => true,
) {
  if (!remote || looksLikeTreatment(remote) || (!docHasAnyText(remote) && docHasAnyText(original?.content))) return false;
  const db = await getDb();
  const body = JSON.stringify(prepareReviewSave(remote));
  const size = new TextEncoder().encode(body).length;
  const updated = new Date().toISOString();
  if (!stillOpening()) return false;
  if (!original) {
    await db.execute(
      `INSERT INTO device_script_import
         (script_id, project_id, generation, title, format, created_at, updated_at, size_bytes, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [meta.id, binding.project_id, binding.generation, meta.title, normalizeFormat(meta.format),
        meta.created_at, updated, size, body],
    );
    return (await readDeviceContent(binding.project_id, meta.id))?.raw === body;
  }
  const result = await db.execute(
    `INSERT INTO script_content (script_id, content)
     SELECT s.id, $4 FROM scripts s JOIN device_project_sync sync ON sync.project_id = s.project_id
     WHERE s.project_id = $1 AND sync.generation = $2 AND sync.enabled = 1 AND s.id = $3
       AND ($5 IS NULL OR EXISTS (SELECT 1 FROM script_content WHERE script_id = s.id))
     ON CONFLICT(script_id) DO UPDATE SET content = excluded.content WHERE script_content.content IS $5`,
    [binding.project_id, binding.generation, meta.id, body, original.raw],
  );
  if (!result.rowsAffected) return false;
  await db.execute(
    `UPDATE scripts SET size_bytes = $3, updated_at = $4
     WHERE project_id = $1 AND id = $2 AND EXISTS
       (SELECT 1 FROM script_content WHERE script_id = $2 AND content = $5)`,
    [binding.project_id, meta.id, size, updated, body],
  );
  return true;
}
