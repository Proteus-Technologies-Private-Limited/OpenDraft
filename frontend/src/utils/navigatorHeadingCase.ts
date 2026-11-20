/**
 * The class that makes the Navigator's headings read as the page prints them,
 * from the active template's Scene Heading rule — never a case of its own. A
 * template that leaves headings as typed gets them as typed here too.
 */
export function headingCaseClass(transform: string | undefined): string {
  if (transform === 'uppercase') return ' nav-heading-upper';
  if (transform === 'lowercase') return ' nav-heading-lower';
  return '';
}
