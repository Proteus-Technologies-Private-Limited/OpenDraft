/**
 * Script ↔ file text for scripts saved to files on disk (issue #135).
 *
 * What these pin down: a linked file is written from the saved payload alone
 * (no editor), it reads back to the same script, a treatment or AV script is
 * never squeezed into a screenplay format, and file names are safe and never
 * collide with a file already in the folder.
 */
import { describe, it, expect } from 'vitest';
import {
  normalizeLinkedFormat, extensionOfPath, isLinkableExtension, formatForScript,
  linkedFileName, uniqueFileName, serializeContentForFormat, parseLinkedFileText,
  contentHasAv, projectFolderName,
} from './linkedFileFormat';

const SCREENPLAY = {
  type: 'doc',
  content: [
    { type: 'sceneHeading', content: [{ type: 'text', text: 'INT. HOUSE - DAY' }] },
    { type: 'action', content: [{ type: 'text', text: 'Rain on the window.' }] },
    { type: 'character', content: [{ type: 'text', text: 'MAYA' }] },
    { type: 'dialogue', content: [{ type: 'text', text: 'It never stops.' }] },
  ],
  _notes: [{ id: 'n1', text: 'tighten this' }],
  _beats: [{ id: 'b1', title: 'Opening' }],
};

const TREATMENT = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A story about rain.' }] }],
};

describe('formats', () => {
  it('accepts only the text formats a linked file can be in', () => {
    expect(isLinkableExtension('odraft')).toBe(true);
    expect(isLinkableExtension('FDX')).toBe(true);
    expect(isLinkableExtension('fountain')).toBe(true);
    expect(isLinkableExtension('osf')).toBe(true);
    // .fadein is a zip written in one non-atomic pass — not for every save.
    expect(isLinkableExtension('fadein')).toBe(false);
    expect(isLinkableExtension('docx')).toBe(false);
  });

  it('falls back to .odraft for anything it cannot write', () => {
    expect(normalizeLinkedFormat('.Fountain')).toBe('fountain');
    expect(normalizeLinkedFormat('pdf')).toBe('odraft');
    expect(normalizeLinkedFormat(undefined)).toBe('odraft');
  });

  it('reads the extension off Windows and POSIX paths', () => {
    expect(extensionOfPath('D:\\RAID\\Film\\Pilot.FDX')).toBe('fdx');
    expect(extensionOfPath('/mnt/raid/Film/Pilot.fountain')).toBe('fountain');
    expect(extensionOfPath('/mnt/raid/Film/.hidden')).toBe('');
    expect(extensionOfPath('/mnt/raid/v1.2/README')).toBe('');
  });

  it('keeps treatments and AV scripts in .odraft whatever the project prefers', () => {
    expect(formatForScript('fdx', 'treatment', TREATMENT)).toBe('odraft');
    expect(formatForScript('fountain', 'screenplay', TREATMENT)).toBe('odraft');
    const av = { type: 'doc', content: [{ type: 'avBlock', content: [] }] };
    expect(contentHasAv(av)).toBe(true);
    expect(formatForScript('fdx', 'screenplay', av)).toBe('odraft');
    expect(formatForScript('fdx', 'screenplay', SCREENPLAY)).toBe('fdx');
  });
});

describe('file names', () => {
  it('names a file after the script, made safe for every OS', () => {
    expect(linkedFileName('Pilot: Part 1/2', 'fountain')).toBe('Pilot Part 1 2.fountain');
    expect(linkedFileName('', 'odraft')).toBe('Untitled.odraft');
    expect(projectFolderName('My Film?')).toBe('My Film');
  });

  it('never picks a name already in the folder, ignoring case', () => {
    const taken = new Set(['pilot.fountain', 'pilot 2.fountain']);
    expect(uniqueFileName('Pilot.fountain', (c) => taken.has(c.toLowerCase()))).toBe('Pilot 3.fountain');
    expect(uniqueFileName('Other.fdx', (c) => taken.has(c.toLowerCase()))).toBe('Other.fdx');
  });
});

describe('writing and reading back', () => {
  it('round-trips everything through .odraft, notes and beats included', async () => {
    const text = serializeContentForFormat('odraft', SCREENPLAY, 'Rain');
    const back = await parseLinkedFileText('Rain.odraft', text);
    expect(back.title).toBe('Rain');
    expect(back.content._notes).toEqual(SCREENPLAY._notes);
    expect(back.content._beats).toEqual(SCREENPLAY._beats);
    expect(back.content.content).toEqual(SCREENPLAY.content);
    expect(back.scriptFormat).toBe('screenplay');
  });

  it('writes Fountain from the payload, without the app-only keys', async () => {
    const text = serializeContentForFormat('fountain', SCREENPLAY, 'Rain');
    expect(text).toContain('INT. HOUSE - DAY');
    expect(text).toContain('MAYA');
    expect(text).not.toContain('tighten this');
    const back = await parseLinkedFileText('Rain.fountain', text);
    const types = (back.content.content as Array<{ type: string }>).map((n) => n.type);
    expect(types).toContain('sceneHeading');
    expect(types).toContain('dialogue');
  });

  it('writes Final Draft XML from the payload', () => {
    const text = serializeContentForFormat('fdx', SCREENPLAY, 'Rain');
    expect(text.startsWith('<?xml')).toBe(true);
    expect(text).toContain('INT. HOUSE - DAY');
  });

  it('recognises a treatment read back from .odraft', async () => {
    const text = serializeContentForFormat('odraft', TREATMENT, 'Story');
    expect((await parseLinkedFileText('Story.odraft', text)).scriptFormat).toBe('treatment');
  });

  it('refuses a format it cannot write rather than writing something wrong', () => {
    expect(() => serializeContentForFormat('docx', SCREENPLAY, 'Rain')).toThrow(/cannot write/);
  });
});
