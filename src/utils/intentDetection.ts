// ─────────────────────────────────────────────────────────────
// intentDetection.ts — Client-side intent analysis
// Determines whether a prompt needs workspace analysis, direct
// code generation, or AI clarification before building.
// ─────────────────────────────────────────────────────────────

import type { ChatMessage } from "../types/chat";

// Detect if message is a workspace-analysis command (local, no API needed)
export const isWorkspaceCommand = (msg: string): boolean => {
  const m = msg.toLowerCase().trim();
  const cmds = [
    "baca", "faham", "analyze", "analyse", "understand", "scan",
    "apa file", "list file", "senarai fail", "tunjuk file", "show file",
    "ringkas", "summarize", "summary", "describe",
    "framework", "tech stack", "stack apa", "guna apa",
    "apa yang ada", "project ni", "project ini", "tengok project",
  ];
  return cmds.some((c) => m.includes(c));
};

// Returns true when the prompt is specific enough to build immediately
export const isClearBuildRequest = (prompt: string): boolean => {
  const p = prompt
    .toLowerCase()
    .replace(/lnding|landig/g, "landing")
    .replace(/sction|secton/g, "section")
    .replace(/pg\b/g, "page")
    .replace(/\bweb\b/g, "webpage");

  if (p.trim().length < 8) return false;

  const toVague = [
    "buat app", "buat sesuatu", "buat website",
    "build me an app", "create something",
    "make a website", "create a platform",
  ];
  if (toVague.some((v) => p === v || p.startsWith(v + " "))) return false;

  const keywords = [
    "landing page", "webpage", "web page", "home page",
    "dashboard", "portfolio", "blog", "admin panel", "admin page",
    "login page", "signup page", "register page", "profile page",
    "hero", "navbar", "navigation", "header", "footer",
    "sidebar", "modal", "card", "form", "section", "layout",
    "calculator", "todo", "to-do", "timer", "stopwatch",
    "quiz", "chat", "weather", "calendar", "notes", "gallery",
    "laman", "muka surat", "papan pemuka",
  ];

  return keywords.some((k) => p.includes(k));
};

// Build rich context from conversation history for code generation
const STATUS_PREFIXES = [
  "Thinking", "Perfect!", "Starting", "Planning", "Generating",
  "Applying", "Got it!", "I'll build", "Alright", "Analysis",
];

export const buildContextFromMessages = (messages: ChatMessage[]): string => {
  const relevant = messages.filter((m) => {
    if (m.role === "user") return m.content.trim().length > 0;
    return m.content.length > 60 && !STATUS_PREFIXES.some((p) => m.content.startsWith(p));
  });

  if (relevant.length === 0) return messages.find((m) => m.role === "user")?.content ?? "";
  if (relevant.length === 1) return relevant[0].content;

  const convo = relevant
    .map((m) => `${m.role === "user" ? "User" : "UiMason"}: ${m.content}`)
    .join("\n\n");

  return `Build this project based on the requirements gathered in this conversation:\n\n${convo}\n\nNow generate the complete, production-ready project code.`;
};