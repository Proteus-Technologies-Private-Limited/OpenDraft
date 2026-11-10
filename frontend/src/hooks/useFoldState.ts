import { useEffect, useState } from 'react';
import { FOLD_CHANGE_EVENT, getFoldState, isFoldableDevice } from '../utils/foldPosture';

export function useFoldState() {
  const [snapshot, setSnapshot] = useState(() => ({ ...getFoldState(), foldable: isFoldableDevice(), viewportWidth: typeof window === 'undefined' ? 0 : window.innerWidth }));
  useEffect(() => {
    const update = () => setSnapshot({ ...getFoldState(), foldable: isFoldableDevice(), viewportWidth: typeof window === 'undefined' ? 0 : window.innerWidth });
    window.addEventListener(FOLD_CHANGE_EVENT, update);
    update();
    return () => window.removeEventListener(FOLD_CHANGE_EVENT, update);
  }, []);
  return snapshot;
}
