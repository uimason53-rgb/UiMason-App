import type { GeneratedFile } from "./claudeService";
import { getAuthToken } from "../hooks/useSessionManager";

export type GitHubStatus = {
  connected: boolean;
  username?: string;
  updatedAt?: number;
};

export type GitHubRepo = {
  id: number;
  name: string;
  fullName: string;
  private: boolean;
  defaultBranch: string;
  htmlUrl: string;
  canPush: boolean;
};

export type GitHubBranch = {
  name: string;
  sha: string;
};

export type GitHubPullRequestResult = {
  branch: string;
  commitSha: string;
  pullRequestNumber: number;
  pullRequestUrl: string;
  state: string;
  title: string;
};

export type CreatePullRequestInput = {
  owner: string;
  repo: string;
  baseBranch: string;
  branchName: string;
  title: string;
  body: string;
  commitMessage: string;
  files: GeneratedFile[];
};

const apiHeaders = (): Record<string, string> => ({
  "Content-Type": "application/json",
  Authorization: `Bearer ${getAuthToken()}`,
});

const readError = async (response: Response, fallback: string) => {
  const payload = await response.json().catch(() => ({ error: fallback })) as { error?: string };
  return payload.error || fallback;
};

export const getGitHubStatus = async (): Promise<GitHubStatus> => {
  const response = await fetch("/api/github/status", { headers: apiHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Failed to load GitHub status"));
  return response.json();
};

export const connectGitHub = async (token: string): Promise<GitHubStatus> => {
  const response = await fetch("/api/github/connect", {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error(await readError(response, "Failed to connect GitHub"));
  return response.json();
};

export const disconnectGitHub = async (): Promise<void> => {
  const response = await fetch("/api/github/connect", { method: "DELETE", headers: apiHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Failed to disconnect GitHub"));
};

export const listGitHubRepos = async (): Promise<GitHubRepo[]> => {
  const response = await fetch("/api/github/repos", { headers: apiHeaders() });
  if (!response.ok) throw new Error(await readError(response, "Failed to list GitHub repos"));
  return response.json();
};

export const listGitHubBranches = async (owner: string, repo: string): Promise<GitHubBranch[]> => {
  const response = await fetch(`/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`, {
    headers: apiHeaders(),
  });
  if (!response.ok) throw new Error(await readError(response, "Failed to list GitHub branches"));
  return response.json();
};

export const createGitHubPullRequest = async (input: CreatePullRequestInput): Promise<GitHubPullRequestResult> => {
  const response = await fetch(`/api/github/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/pull-request`, {
    method: "POST",
    headers: apiHeaders(),
    body: JSON.stringify({
      baseBranch: input.baseBranch,
      branchName: input.branchName,
      title: input.title,
      body: input.body,
      commitMessage: input.commitMessage,
      files: input.files.map((file) => ({ path: file.path, content: file.content ?? "" })),
    }),
  });
  if (!response.ok) throw new Error(await readError(response, "Failed to create GitHub pull request"));
  return response.json();
};
