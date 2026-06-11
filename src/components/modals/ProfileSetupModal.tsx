import { useState, useRef } from "react";
import type { UserProfile } from "../../types/chat";

type Props = {
  onSave: (profile: UserProfile) => void;
  onClose?: () => void;
  existingProfile?: UserProfile | null;
};

export default function ProfileSetupModal({ onSave, onClose, existingProfile }: Props) {
  const [name, setName] = useState(existingProfile?.name ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>(existingProfile?.avatarUrl);
  const fileRef = useRef<HTMLInputElement>(null);
  const isEditing = !!existingProfile;

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setAvatarUrl(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({ name: name.trim(), avatarUrl });
  };

  const initials = name.trim().slice(0, 2).toUpperCase() || "?";

  return (
    <div className="modal-overlay">
      <div className="modal-card">
        {/* Back button — only shown when editing existing profile */}
        {isEditing && onClose && (
          <button className="modal-back-btn" onClick={onClose} aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>Back</span>
          </button>
        )}

        <div className="modal-header">
          {!isEditing && (
            <div className="modal-logo">
              <div className="logo-dot" />
              <span>UiMason</span>
            </div>
          )}
          <h2 className="modal-title">
            {isEditing ? "Edit Profile" : "Welcome to UiMason"}
          </h2>
          <p className="modal-subtitle">
            {isEditing ? "Update your name and profile photo" : "Set up your profile to get started"}
          </p>
        </div>

        <div className="modal-body">
          {/* Avatar picker — always visible, combined */}
          <div className="avatar-picker-wrapper">
            <div className="avatar-picker" onClick={() => fileRef.current?.click()}>
              {avatarUrl ? (
                <img src={avatarUrl} alt="Avatar" className="avatar-img avatar-lg" />
              ) : (
                <div className="avatar-initials avatar-lg">{initials}</div>
              )}
              <div className="avatar-overlay">
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                  <path d="M12.5 2.5L15.5 5.5L6 15H3V12L12.5 2.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"/>
                </svg>
                <span>Change photo</span>
              </div>
            </div>
            {avatarUrl && (
              <button
                className="avatar-remove-btn"
                onClick={() => setAvatarUrl(undefined)}
                title="Remove photo"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            )}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            style={{ display: "none" }}
            onChange={handleAvatarChange}
          />

          <div className="modal-field">
            <label className="modal-label">Full Name</label>
            <input
              className="modal-input"
              placeholder="e.g. John Doe"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              autoFocus
            />
          </div>
        </div>

        <div className="modal-footer">
          {isEditing && onClose && (
            <button className="modal-btn-ghost" onClick={onClose}>
              Cancel
            </button>
          )}
          <button
            className="modal-btn-primary"
            onClick={handleSave}
            disabled={!name.trim()}
          >
            {isEditing ? "Save Changes" : "Get Started"}
          </button>
        </div>
      </div>
    </div>
  );
}