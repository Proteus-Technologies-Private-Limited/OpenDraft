/**
 * The Layout switcher on a bar: the workspace layouts, as a menu or a row of
 * buttons, so a writer can move between arrangements in one click. Which
 * layouts it offers, and whether it ends with "Edit layouts…", are the
 * writer's choice (Layout › Toolbar & footer).
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { FaThLarge } from 'react-icons/fa';
import { useEditorFields } from '../../stores/editorStore';
import type { ToolbarItemOptions, ToolbarLabelMode } from '../../utils/toolbarLayout';
import Select from '../Select';
import { useWorkspaceLayoutChoices } from './toolbarMeta';

const EDIT = '__edit-layouts';
const CUSTOM = 'custom';

interface Props {
  label: ToolbarLabelMode;
  options: ToolbarItemOptions;
}

const LayoutSwitcher: React.FC<Props> = ({ label, options }) => {
  const { t } = useTranslation('toolbar');
  const { workspacePreset, applyWorkspacePreset, setLayoutDialog } = useEditorFields(
    'workspacePreset', 'applyWorkspacePreset', 'setLayoutDialog',
  );
  const all = useWorkspaceLayoutChoices();
  const hidden = new Set(options.hiddenLayouts ?? []);
  const choices = all.filter((choice) => !hidden.has(choice.id));
  const editEntry = options.editEntry !== false;
  const heading = label !== 'none' && (
    <span className="toolbar-heading" aria-hidden="true">
      {label !== 'text' && <FaThLarge />}
      {(label === 'text' || label === 'both') && <span className="toolbar-btn-label">{t('layout.items.layout.label')}</span>}
    </span>
  );

  if ((options.layoutStyle ?? 'menu') === 'buttons') {
    return (
      <div className="toolbar-group layout-switcher" role="radiogroup" aria-label={t('layout.items.layout.label')}>
        {heading}
        <div className="layout-switcher-buttons">
          {choices.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="radio"
              aria-checked={workspacePreset === choice.id}
              className={`toolbar-btn layout-switcher-btn${workspacePreset === choice.id ? ' active' : ''}`}
              onClick={() => applyWorkspacePreset(choice.id)}
            >
              <span className="toolbar-btn-label">{choice.label}</span>
            </button>
          ))}
          {editEntry && (
            <button type="button" className="toolbar-btn layout-switcher-btn" title={t('layout.editLayouts')}
              aria-label={t('layout.editLayouts')} onClick={() => setLayoutDialog('panels')}>
              <FaThLarge />
            </button>
          )}
        </div>
      </div>
    );
  }

  const known = choices.some((choice) => choice.id === workspacePreset);
  return (
    <div className="toolbar-group layout-switcher">
      {heading}
      <Select
        className="layout-switcher-select"
        value={known ? workspacePreset : CUSTOM}
        title={t('layout.items.layout.description')}
        aria-label={t('layout.items.layout.label')}
        onChange={(e) => {
          const value = e.target.value;
          if (value === EDIT) setLayoutDialog('panels');
          else if (value !== CUSTOM) applyWorkspacePreset(value);
        }}
      >
        {!known && <option value={CUSTOM}>{t('layout.presets.custom')}</option>}
        {choices.map((choice) => <option key={choice.id} value={choice.id}>{choice.label}</option>)}
        {editEntry && <option value={EDIT}>{t('layout.editLayouts')}</option>}
      </Select>
    </div>
  );
};

export default LayoutSwitcher;
