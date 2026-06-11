import { useState, useRef, useEffect } from "react";
import type { UserProfile } from "../../types/chat";

type Props = {
  profile: UserProfile;
  onEditProfile: () => void;
  onDeleteProfile: () => void;
  onOpenSettings: () => void;
};

export default function ProfileSection({ profile, onEditProfile, onDeleteProfile, onOpenSettings }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const initials = profile.name.slice(0, 2).toUpperCase();

  return (
    <div className="profile-section" ref={ref}>
      {open && (
        <div className="profile-dropdown">
          <div className="profile-dropdown-header">
            <div className="profile-dropdown-avatar">
              {profile.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Avatar" className="avatar-img avatar-sm" />
              ) : (
                <div className="avatar-initials avatar-sm">{initials}</div>
              )}
            </div>
            <div className="profile-dropdown-info">
              <span className="profile-dropdown-name">{profile.name}</span>
              <span className="profile-dropdown-plan">Pro Plan</span>
            </div>
          </div>

          <div className="profile-menu-divider" />

          {/* Combined Edit Profile + Change Avatar */}
          <button className="profile-menu-item" onClick={() => { setOpen(false); onEditProfile(); }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M1.5 12C1.5 9.5 3.7 7.5 6.5 7.5C9.3 7.5 11.5 9.5 11.5 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <path d="M9.5 1.5L11.5 3.5L8 7H6V5L9.5 1.5Z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
            </svg>
            Edit Profile
          </button>

          <button className="profile-menu-item" onClick={() => { setOpen(false); onOpenSettings(); }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <circle cx="6.5" cy="6.5" r="1.8" stroke="currentColor" strokeWidth="1.2"/>
              <path d="M6.5 1v1.2M6.5 10.8V12M1 6.5h1.2M10.8 6.5H12M2.4 2.4l.85.85M9.75 9.75l.85.85M11.1 2.4l-.85.85M3.25 9.75l-.85.85" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
            Settings
          </button>

          <div className="profile-menu-divider" />

          <button className="profile-menu-item profile-menu-danger" onClick={() => { setOpen(false); onDeleteProfile(); }}>
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
              <path d="M2 3.5H11M4.5 3.5V2.5C4.5 2 4.9 1.5 5.5 1.5H7.5C8.1 1.5 8.5 2 8.5 2.5V3.5M5 6V10M8 6V10M3 3.5L3.5 11C3.5 11.3 3.8 11.5 4 11.5H9C9.2 11.5 9.5 11.3 9.5 11L10 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Delete Profile
          </button>
        </div>
      )}

      <button className="profile-trigger" onClick={() => setOpen((o) => !o)}>
        {profile.avatarUrl ? (
          <img src={profile.avatarUrl} alt="Avatar" className="avatar-img avatar-sm" />
        ) : (
          <div className="avatar-initials avatar-sm">{initials}</div>
        )}
        <span className="profile-name">{profile.name}</span>
        <svg className="profile-chevron-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)', transition: '0.2s' }}>
          <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>
    </div>
  );
}