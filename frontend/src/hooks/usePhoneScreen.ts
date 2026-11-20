/**
 * Whether this is a phone-sized screen: html.phone, set in main.tsx and by a
 * foldable's posture (folded to its cover screen). A phone's one-row toolbar
 * has no room for names, so it shows icons whatever labels the bar was given
 * on a larger screen (Toolbar.tsx, Layout › Toolbar & footer).
 */
import { useSyncExternalStore } from 'react';
import { PHONE_DEVICE_CHANGE_EVENT } from '../utils/phoneDevice';
import { FOLD_CHANGE_EVENT } from '../utils/foldPosture';

function subscribe(notify: () => void): () => void {
  window.addEventListener(PHONE_DEVICE_CHANGE_EVENT, notify);
  window.addEventListener(FOLD_CHANGE_EVENT, notify);
  return () => {
    window.removeEventListener(PHONE_DEVICE_CHANGE_EVENT, notify);
    window.removeEventListener(FOLD_CHANGE_EVENT, notify);
  };
}

function read(): boolean {
  try {
    return document.documentElement.classList.contains('phone');
  } catch (err) {
    console.warn('[toolbar] could not read the phone class', err);
    return false;
  }
}

export function usePhoneScreen(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}
