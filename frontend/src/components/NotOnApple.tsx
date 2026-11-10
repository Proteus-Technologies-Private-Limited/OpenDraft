import type { ReactNode } from 'react';
import { hidesOtherMobilePlatforms } from '../services/platform';

/**
 * Release-note wording that names Android.
 *
 * App Review rejects an iOS or Mac App Store build that shows the word Android
 * anywhere (guideline 2.3.10), so on those apps `apple` is shown in its place,
 * or nothing when it is left out. Everywhere else the children are shown.
 *
 *   On <NotOnApple apple="iPhone and iPad">iPhone, iPad and Android</NotOnApple>, …
 *   <NotOnApple><li>A fix only Android had</li></NotOnApple>
 */
export default function NotOnApple({ children, apple = null }: { children: ReactNode; apple?: ReactNode }) {
  return <>{hidesOtherMobilePlatforms() ? apple : children}</>;
}
