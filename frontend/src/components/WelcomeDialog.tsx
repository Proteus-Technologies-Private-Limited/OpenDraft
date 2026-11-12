import React from 'react';
import { ModalOverlay } from './ModalOverlay';
import { Trans, useTranslation } from 'react-i18next';
import logoUrl from '../assets/opendraft-icon.svg';

export type WelcomeChoice = 'blank' | 'sample' | 'import';

interface WelcomeDialogProps {
  onChoice: (choice: WelcomeChoice) => void;
}

const WelcomeDialog: React.FC<WelcomeDialogProps> = ({ onChoice }) => {
  const { t } = useTranslation('projects');
  return (
    <ModalOverlay className="dialog-overlay">
      <div className="welcome-card" onClick={(e) => e.stopPropagation()}>
        <div className="welcome-hero">
          <img className="welcome-logo" src={logoUrl} alt="" />
          {/* i18n-ignore: brand name */}
          <h1 className="welcome-title">Open Draft</h1>
          <p className="welcome-subtitle">{t('welcome.subtitle')}</p>
        </div>

        <div className="welcome-tips">
          <div className="welcome-tip">
            <span className="welcome-tip-icon">&#9998;</span>
            <span>{t('welcome.tipClick')}</span>
          </div>
          <div className="welcome-tip">
            <span className="welcome-tip-icon">&#8629;</span>
            <span><Trans ns="projects" i18nKey="welcome.tipEnter" components={{ kbd: <kbd /> }} /></span>
          </div>
          <div className="welcome-tip">
            <span className="welcome-tip-icon">&#8677;</span>
            <span><Trans ns="projects" i18nKey="welcome.tipTab" components={{ kbd: <kbd /> }} /></span>
          </div>
        </div>

        <p className="welcome-choose-label">{t('welcome.chooseLabel')}</p>

        <div className="welcome-choices">
          <button className="welcome-choice-btn welcome-choice-blank" onClick={() => onChoice('blank')}>
            <span className="welcome-choice-icon">&#128196;</span>
            <span className="welcome-choice-text">
              <strong>{t('welcome.blank.title')}</strong>
              <small>{t('welcome.blank.hint')}</small>
            </span>
          </button>
          <button className="welcome-choice-btn welcome-choice-sample" onClick={() => onChoice('sample')}>
            <span className="welcome-choice-icon">&#127916;</span>
            <span className="welcome-choice-text">
              <strong>{t('welcome.sample.title')}</strong>
              <small>{t('welcome.sample.hint')}</small>
            </span>
          </button>
          <button className="welcome-choice-btn welcome-choice-import" onClick={() => onChoice('import')}>
            <span className="welcome-choice-icon">&#128194;</span>
            <span className="welcome-choice-text">
              <strong>{t('welcome.import.title')}</strong>
              <small>{t('welcome.import.hint')}</small>
            </span>
          </button>
        </div>

        <p className="welcome-footer">
          {t('welcome.footer')}
        </p>
      </div>
    </ModalOverlay>
  );
};

export default WelcomeDialog;
