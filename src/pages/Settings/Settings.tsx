import { useState } from "react";

type PrefsConfig = {
  autoFix: boolean;
  autoDeploy: boolean;
};

const STORAGE_KEY = "aiagent_settings";

const loadSettings = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const saveSettings = (data: object) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

const CheckIcon = () => (
  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
    <path d="M1.5 5.5L4.5 8.5L9.5 2.5" stroke="#4caf7d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      className={`s-toggle${checked ? " s-toggle--on" : ""}`}
      onClick={() => onChange(!checked)}
      role="switch"
      aria-checked={checked}
    >
      <span className="s-toggle__thumb" />
    </button>
  );
}

export default function Settings({ onBack }: { onBack?: () => void }) {
  const [prefs, setPrefs] = useState<PrefsConfig>(() => loadSettings()?.prefs ?? {
    autoFix: true,
    autoDeploy: false,
  });
  const [saved, setSaved] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);

  const handleSave = () => {
    saveSettings({ prefs });
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const handleClear = () => {
    localStorage.removeItem(STORAGE_KEY);
    setPrefs({ autoFix: true, autoDeploy: false });
    setClearConfirm(false);
  };

  return (
    <div className="settings-page">
      <div className="settings-inner">
        <div className="s-header">
          <div className="s-header-left">
            {onBack && (
              <button className="s-back-btn" onClick={onBack} aria-label="Back to home">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>Back</span>
              </button>
            )}
            <div>
              <h2 className="s-title">Settings</h2>
              <p className="s-sub">Manage reliability preferences.</p>
            </div>
          </div>
          <button className={`s-save-btn${saved ? " s-save-btn--saved" : ""}`} onClick={handleSave}>
            {saved ? <><CheckIcon /> Saved</> : "Save changes"}
          </button>
        </div>

        <div className="s-block">
          <p className="s-block__label">AI Engine</p>

          <div className="s-ai-status">
            <div className="s-ai-status__left">
              <span className="s-status-dot s-status-dot--on" />
              <div>
                <span className="s-ai-status__name">UiMason AI</span>
                <span className="s-ai-status__note">Planning, coding, review, repair, and deployment assistance</span>
              </div>
            </div>
            <span className="s-badge s-badge--active">Active</span>
          </div>
        </div>

        <div className="s-block">
          <p className="s-block__label">Behaviour</p>

          <div className="s-row">
            <div className="s-row__text">
              <span className="s-row__name">Auto-fix errors</span>
              <span className="s-row__desc">UiMason retries and repairs code errors up to 3 times.</span>
            </div>
            <Toggle checked={prefs.autoFix} onChange={(v) => setPrefs((p) => ({ ...p, autoFix: v }))} />
          </div>

          <div className="s-row s-row--last">
            <div className="s-row__text">
              <span className="s-row__name">Auto-deploy</span>
              <span className="s-row__desc">Deploy automatically when a project is verified.</span>
            </div>
            <Toggle checked={prefs.autoDeploy} onChange={(v) => setPrefs((p) => ({ ...p, autoDeploy: v }))} />
          </div>
        </div>

        <div className="s-danger">
          <div className="s-danger__row">
            <div>
              <span className="s-danger__title">Reset all settings</span>
              <span className="s-danger__desc">Clear saved behaviour preferences.</span>
            </div>
            {!clearConfirm ? (
              <button className="s-danger__btn" onClick={() => setClearConfirm(true)}>Reset</button>
            ) : (
              <div className="s-danger__confirm">
                <span>Sure?</span>
                <button className="s-danger__btn s-danger__btn--yes" onClick={handleClear}>Yes, reset</button>
                <button className="s-danger__btn s-danger__btn--no" onClick={() => setClearConfirm(false)}>Cancel</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
