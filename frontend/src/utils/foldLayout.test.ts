import { describe, expect, it } from 'vitest';
import { foldLayout } from './foldLayout';
describe('open foldable page fit', () => {
  it('fits a page without Navigator, then overlays it if docking would fall below 80%', () => {
    expect(foldLayout(951, 816, 240, false, false)).toEqual({ dockNavigator: false, zoom: 100 });
    expect(foldLayout(951, 816, 240, true, false)).toEqual({ dockNavigator: true, zoom: 85 });
    expect(foldLayout(800, 816, 240, true, false)).toEqual({ dockNavigator: false, zoom: 96 });
  });
  it('reserves one column and keeps page zoom at least 70%', () => {
    expect(foldLayout(951, 816, 240, true, true)).toEqual({ dockNavigator: false, zoom: 77 });
    expect(foldLayout(690, 816, 240, true, true)).toEqual({ dockNavigator: false, zoom: 70 });
  });
});
