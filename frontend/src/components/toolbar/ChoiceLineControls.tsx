import { useTranslation } from 'react-i18next';

/** Buttons sit outside listbox/menu semantics. All labels reuse translations. */
export function ChoiceLineBack({ label, onClose }: { label: string; onClose: () => void }) {
  return <button type="button" className="toolbar-choice-back" title={label} onClick={onClose}>{label}</button>;
}
export function ChoiceLineClose({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation('common');
  return <button type="button" className="toolbar-choice-close" aria-label={t('close')} title={t('close')} onClick={onClose}>×</button>;
}

