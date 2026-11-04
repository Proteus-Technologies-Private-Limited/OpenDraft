export type DictationAction =
  | { kind: 'text'; text: string }
  | { kind: 'element'; type: 'sceneHeading' | 'action' | 'character' | 'dialogue' | 'parenthetical' | 'transition'; text: string }
  | { kind: 'paragraph' };

/** Commands occupy a whole recognition result, never a substring of dialogue. */
export function parseDictation(text: string, commands = false): DictationAction | null {
  const value = text.trim();
  if (!value) return null;
  if (!commands) return { kind: 'text', text: value };
  if (/^literal\s+/i.test(value)) return { kind: 'text', text: value.replace(/^literal\s+/i, '') };
  const command = value.replace(/[.!?]+$/, '').trim();
  if (/^new (?:paragraph|line)$/i.test(command)) return { kind: 'paragraph' };
  const plain: Record<string, 'sceneHeading' | 'action' | 'dialogue' | 'parenthetical' | 'transition'> = {
    'new scene': 'sceneHeading', 'action': 'action', 'dialogue': 'dialogue',
    'parenthetical': 'parenthetical', 'transition': 'transition',
  };
  const type = plain[command.toLowerCase()];
  if (type) return { kind: 'element', type, text: '' };
  const character = command.match(/^character\s+(.+)$/i);
  if (character) return { kind: 'element', type: 'character', text: character[1].toLocaleUpperCase() };
  return { kind: 'text', text: value };
}
