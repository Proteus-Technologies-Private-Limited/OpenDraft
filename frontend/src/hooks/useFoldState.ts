import { useEffect, useState } from 'react';
import { FOLD_CHANGE_EVENT, getFoldState, isFoldableDevice } from '../utils/foldPosture';

export function useFoldState() {
  const [snapshot, setSnapshot] = useState(() => ({ ...getFoldState(), foldable: isFoldableDevice() }));
  useEffect(() => {
    const update = () => setSnapshot({ ...getFoldState(), foldable: isFoldableDevice() });
    window.addEventListener(FOLD_CHANGE_EVENT, update);
    update();
    return () => window.removeEventListener(FOLD_CHANGE_EVENT, update);
  }, []);
  return snapshot;
}
