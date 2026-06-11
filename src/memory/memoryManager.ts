const MEMORY_DB_KEY = "uimason_memory";

// ── Working memory (current session state) ───────────────────
export type WorkingMemory = {
  sessionId: string;
  userGoal: string;
  recentActions: string[];
  activeFiles: string[];
  lastContext: string;
  updatedAt: number;
};

// ── Episodic memory (past session summaries) ─────────────────
export type Episode = {
  id: string;
  sessionTitle: string;
  userPrompt: string;
  projectName?: string;
  stack?: string[];
  fileCount: number;
  outcome: "success" | "error" | "incomplete";
  summary: string;
  keyLearnings: string[];
  timestamp: number;
};

// ── Semantic memory (learned patterns) ───────────────────────
export type SemanticPattern = {
  id: string;
  pattern: string;
  context: string;
  frequency: number;
  lastUsed: number;
};

// ── Full memory store ────────────────────────────────────────
export type MemoryStore = {
  working: WorkingMemory | null;
  episodes: Episode[];
  patterns: SemanticPattern[];
  preferences: Record<string, string>;
};

const load = (): MemoryStore => {
  try { const r = localStorage.getItem(MEMORY_DB_KEY); return r ? JSON.parse(r) : { episodes:[], patterns:[], preferences:{}, working:null }; }
  catch (error) { console.warn("Memory load failed", error); return { episodes:[], patterns:[], preferences:{}, working:null }; }
};

const save = (s: MemoryStore) => { try { localStorage.setItem(MEMORY_DB_KEY, JSON.stringify(s)); } catch (error) { console.warn("Memory save failed", error); } };

// ── Working memory API ───────────────────────────────────────
export const setWorkingMemory = (wm: WorkingMemory) => {
  const s = load(); s.working = { ...wm, updatedAt: Date.now() }; save(s);
};
export const getWorkingMemory = (): WorkingMemory | null => load().working;
export const clearWorkingMemory = () => { const s = load(); s.working = null; save(s); };

// ── Episodic memory API ──────────────────────────────────────
export const recordEpisode = (ep: Omit<Episode, "id" | "timestamp">) => {
  const s = load();
  const episode: Episode = { ...ep, id: `ep-${Date.now()}`, timestamp: Date.now() };
  s.episodes.unshift(episode);
  if (s.episodes.length > 50) s.episodes = s.episodes.slice(0, 50);
  save(s);
  return episode;
};

export const getRecentEpisodes = (n = 5): Episode[] => load().episodes.slice(0, n);

export const findSimilarEpisodes = (prompt: string): Episode[] => {
  const p = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  return load().episodes.filter(ep => {
    const combined = `${ep.userPrompt} ${ep.summary}`.toLowerCase();
    return p.some(w => combined.includes(w));
  }).slice(0, 5);
};

// ── Semantic memory API ──────────────────────────────────────
export const recordPattern = (pattern: string, context: string) => {
  const s = load();
  const existing = s.patterns.find(x => x.pattern === pattern);
  if (existing) { existing.frequency++; existing.lastUsed = Date.now(); }
  else s.patterns.unshift({ id: `pat-${Date.now()}`, pattern, context, frequency: 1, lastUsed: Date.now() });
  if (s.patterns.length > 100) s.patterns = s.patterns.slice(0, 100);
  save(s);
};

export const getRelevantPatterns = (prompt: string): SemanticPattern[] => {
  const p = prompt.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  return load().patterns.filter(pat => p.some(w => pat.context.toLowerCase().includes(w) || pat.pattern.toLowerCase().includes(w))).slice(0, 5);
};

// ── Preference learning ──────────────────────────────────────
export const setPreference = (key: string, value: string) => {
  const s = load(); s.preferences[key] = value; save(s);
};
export const getPreference = (key: string): string | undefined => load().preferences[key];
export const getAllPreferences = (): Record<string, string> => ({ ...load().preferences });

// ── Build memory context for AI prompts ──────────────────────
export const buildMemoryContext = (userPrompt: string): string => {
  const s = load();
  const parts: string[] = [];

  // Working memory
  if (s.working) {
    parts.push(`[CURRENT SESSION]\nGoal: ${s.working.userGoal}\nRecent: ${s.working.recentActions.slice(-3).join(", ")}`);
  }

  // Similar episodes
  const similar = findSimilarEpisodes(userPrompt);
  if (similar.length > 0) {
    parts.push(`[PAST SIMILAR PROJECTS]\n${similar.map(e => `- ${e.sessionTitle}: ${e.summary} (${e.outcome}, ${e.fileCount} files)`).join("\n")}`);
  }

  // Relevant patterns
  const patterns = getRelevantPatterns(userPrompt);
  if (patterns.length > 0) {
    parts.push(`[LEARNED PATTERNS]\n${patterns.map(p => `- ${p.pattern}: ${p.context} (used ${p.frequency}×)`).join("\n")}`);
  }

  // Preferences
  const prefs = s.preferences;
  if (Object.keys(prefs).length > 0) {
    parts.push(`[USER PREFERENCES]\n${Object.entries(prefs).map(([k,v]) => `- ${k}: ${v}`).join("\n")}`);
  }

  return parts.join("\n\n");
};