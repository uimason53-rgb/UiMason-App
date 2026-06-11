import { useState } from "react";
import type { UserProfile } from "../types/chat";

const STORAGE_KEY = "uimason_profile";

// Read synchronously on init — no flicker
const readProfile = (): UserProfile | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
};

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(readProfile);

  const saveProfile = (data: UserProfile) => {
    setProfile(data);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  };

  const deleteProfile = () => {
    setProfile(null);
    localStorage.removeItem(STORAGE_KEY);
  };

  // loaded is always true now — no async needed
  return { profile, loaded: true, saveProfile, deleteProfile };
}