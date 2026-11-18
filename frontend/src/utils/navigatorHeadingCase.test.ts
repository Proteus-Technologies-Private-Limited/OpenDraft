import { describe, it, expect } from 'vitest';
import { headingCaseClass } from './navigatorHeadingCase';
import { INDUSTRY_STANDARD_TEMPLATE } from '../stores/industryStandardTemplate';
import { STAGE_PLAY_TEMPLATE } from '../stores/templates/stagePlayTemplate';

describe('navigator heading case follows the template', () => {
  it('capitalises when the Scene Heading rule does', () => {
    expect(headingCaseClass(INDUSTRY_STANDARD_TEMPLATE.rules.sceneHeading.textTransform)).toBe(' nav-heading-upper');
    expect(headingCaseClass(STAGE_PLAY_TEMPLATE.rules.sceneHeading.textTransform)).toBe(' nav-heading-upper');
  });

  it('leaves headings as typed when the rule does', () => {
    expect(headingCaseClass('none')).toBe('');
  });

  it('lower-cases when the rule does', () => {
    expect(headingCaseClass('lowercase')).toBe(' nav-heading-lower');
  });

  it('adds no case of its own when there is no rule', () => {
    expect(headingCaseClass(undefined)).toBe('');
  });
});
