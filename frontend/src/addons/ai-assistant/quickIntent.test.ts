import { describe, it, expect } from 'vitest';
import { parseQuickDialogue } from './quickIntent';

describe('parseQuickDialogue', () => {
  it('reads a simple quoted line', () => {
    expect(parseQuickDialogue('Ben dice: "Ciao a tutti."')).toEqual({
      character: 'BEN', text: 'Ciao a tutti.',
    });
    expect(parseQuickDialogue('Ada dice: «La porta era aperta.»')).toEqual({
      character: 'ADA', text: 'La porta era aperta.',
    });
  });

  it('reads an unquoted line', () => {
    expect(parseQuickDialogue('Ora Ben dice: Non dovevi tornare.')).toEqual({
      character: 'BEN', text: 'Non dovevi tornare.',
    });
  });

  it('understands English too', () => {
    expect(parseQuickDialogue('Ben says: "Hello, everyone."')).toEqual({
      character: 'BEN', text: 'Hello, everyone.',
    });
    expect(parseQuickDialogue('Have MARGO say "Get out"')).toEqual({
      character: 'MARGO', text: 'Get out',
    });
  });

  it('understands the request wrapped in words', () => {
    expect(parseQuickDialogue('Scrivi un dialogo di Ben che dice «Ciao a tutti»')).toEqual({
      character: 'BEN', text: 'Ciao a tutti',
    });
  });

  it('accepts a lowercase name when it is the only name in the lead-in', () => {
    expect(parseQuickDialogue('ben dice "Ciao"')).toEqual({ character: 'BEN', text: 'Ciao' });
    expect(parseQuickDialogue('ben dice "Ciao"', ['BEN'])).toEqual({ character: 'BEN', text: 'Ciao' });
  });

  it('understands "fai dire a"', () => {
    expect(parseQuickDialogue('Fai dire a Ben: Ciao a tutti.')).toEqual({
      character: 'BEN', text: 'Ciao a tutti.',
    });
  });

  it('keeps a two-word name', () => {
    expect(parseQuickDialogue('MARCUS WEBB dice: «Sei in ritardo.»')).toEqual({
      character: 'MARCUS WEBB', text: 'Sei in ritardo.',
    });
  });

  it('leaves a longer sentence to the model', () => {
    expect(parseQuickDialogue('Vilgax entra nella stanza. Ben lo guarda e dice: Sei in ritardo.')).toBeNull();
  });

  it('leaves two speakers to the model', () => {
    expect(parseQuickDialogue('Ben dice «Ciao» e Vilgax risponde «Vai via»')).toBeNull();
  });

  it('leaves a line followed by another sentence to the model', () => {
    expect(parseQuickDialogue('Ben dice: Ciao. Poi esce.')).toBeNull();
  });

  it('ignores very long prompts and prompts without a speech verb', () => {
    expect(parseQuickDialogue(`Ben dice: ${'x'.repeat(500)}`)).toBeNull();
    expect(parseQuickDialogue('Ben entra in casa.')).toBeNull();
  });
});
