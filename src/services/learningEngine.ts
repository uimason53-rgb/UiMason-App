import { recordPattern, setPreference, getAllPreferences } from "../memory/memoryManager";

export type UserEdit = {
  filePath: string;
  originalContent: string;
  editedContent: string;
  timestamp: number;
};

// Track a user edit to learn from it
export const trackEdit = (edit: UserEdit) => {
  const originalLines = edit.originalContent.split("\n");
  const editedLines = edit.editedContent.split("\n");

  // Learn naming conventions
  const originalNames = extractNames(edit.originalContent);
  const editedNames = extractNames(edit.editedContent);
  const newNames = editedNames.filter((n) => !originalNames.includes(n));
  if (newNames.length > 0) {
    recordPattern(`naming: ${newNames[0]}`, `User renamed in ${edit.filePath}`);
  }

  // Learn CSS preference
  if (edit.filePath.endsWith(".css") || edit.filePath.endsWith(".scss")) {
    if (edit.editedContent.includes("var(--")) {
      setPreference("css_style", "css-variables");
    }
    if (edit.editedContent.toLowerCase().includes("tailwind")) {
      setPreference("css_style", "tailwind");
    }
    if (edit.editedContent.includes("em") || edit.editedContent.includes("rem")) {
      setPreference("css_units", "relative");
    }
  }

  // Detect indentation preference
  const indent = detectIndent(edit.editedContent);
  if (indent) setPreference("indent", indent);

  // Detect quote preference
  const singleQuotes = (edit.editedContent.match(/'/g) || []).length;
  const doubleQuotes = (edit.editedContent.match(/"/g) || []).length;
  if (singleQuotes > doubleQuotes * 2) setPreference("quotes", "single");
  if (doubleQuotes > singleQuotes * 2) setPreference("quotes", "double");

  // Record the edit pattern
  const diffType = classifyDiff(originalLines.length, editedLines.length, edit);
  recordPattern(`edit_type: ${diffType}`, `User modified ${edit.filePath}`);
};

const extractNames = (content: string): string[] => {
  const matches = content.match(/\b(?:const|let|var|function|class|export)\s+(\w+)/g);
  return (matches || []).map((m) => m.split(/\s+/)[1]).filter(Boolean);
};

const detectIndent = (content: string): string | null => {
  const spaces = content.match(/^[ ]+/gm);
  if (spaces) {
    const avg = Math.round(spaces.reduce((s, l) => s + l.length, 0) / spaces.length);
    if (avg === 2) return "2_spaces";
    if (avg === 4) return "4_spaces";
  }
  if (content.includes("\t")) return "tabs";
  return null;
};

const classifyDiff = (_orig: number, edited: number, edit: UserEdit): string => {
  if (edit.originalContent === "") return "add_new_file";
  if (edit.editedContent.length < edit.originalContent.length * 0.5) return "delete_content";
  if (edit.editedContent.length > edit.originalContent.length * 1.5) return "expand_file";
  return "modify_content";
};

// Generate a coding style guide from learned preferences
export const generateStyleGuide = (): string => {
  const prefs = getAllPreferences();
  const rules: string[] = [];

  if (prefs.indent) {
    const indent = prefs.indent === "tabs" ? "tabs" : prefs.indent === "2_spaces" ? "2 spaces" : "4 spaces";
    rules.push(`• Indentation: ${indent}`);
  }
  if (prefs.quotes) rules.push(`• Quotes: ${prefs.quotes} quotes`);
  if (prefs.css_style) rules.push(`• CSS: ${prefs.css_style}`);
  if (prefs.css_units) rules.push(`• CSS units: ${prefs.css_units}`);

  if (rules.length === 0) return "";
  return "[LEARNED CODING STYLE]\n" + rules.join("\n");
};