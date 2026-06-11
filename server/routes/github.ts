import { Router } from "express";
import crypto from "crypto";
import { z } from "zod";
import db from "../db/index";
import { isProduction } from "../env";
import { authMiddleware } from "../middleware/auth";
import { generalRateLimiter } from "../middleware/rateLimiter";

type GitHubConnection = {
  userId: string;
  username: string;
  encryptedToken: string;
  createdAt: number;
  updatedAt: number;
};

type GitHubUser = {
  login: string;
  id: number;
  avatar_url?: string;
  html_url?: string;
};

type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  permissions?: { push?: boolean; pull?: boolean; admin?: boolean; maintain?: boolean };
};

type GitHubRef = {
  object: { sha: string; type: string; url: string };
};

type GitHubCommit = {
  sha: string;
  tree: { sha: string };
};

type GitHubPullRequest = {
  number: number;
  html_url: string;
  state: string;
  title: string;
  head: { ref: string; sha: string };
  base: { ref: string };
};

const router = Router();
router.use(authMiddleware);
router.use(generalRateLimiter);

const tokenSecret = process.env.GITHUB_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || "uimason-dev-github-token-secret";
if (isProduction && tokenSecret === "uimason-dev-github-token-secret") {
  throw new Error("GITHUB_TOKEN_ENCRYPTION_KEY or JWT_SECRET must be configured in production.");
}

const githubFileSchema = z.object({
  path: z.string().min(1).max(260).refine((path) => !path.includes("..") && !path.startsWith("/") && !path.startsWith("\\"), "Unsafe file path"),
  content: z.string().max(1_500_000).default(""),
});

const repoSchema = z.object({
  owner: z.string().min(1).max(100),
  repo: z.string().min(1).max(100),
});

const connectSchema = z.object({
  token: z.string().min(20).max(500),
});

const createBranchSchema = repoSchema.extend({
  baseBranch: z.string().min(1).max(120).default("main"),
  branchName: z.string().min(1).max(120),
});

const createPrSchema = createBranchSchema.extend({
  files: z.array(githubFileSchema).min(1).max(500),
  commitMessage: z.string().min(1).max(200),
  title: z.string().min(1).max(200),
  body: z.string().max(8000).default(""),
});

const encryptToken = (token: string) => {
  const key = crypto.createHash("sha256").update(tokenSecret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(".");
};

const decryptToken = (payload: string) => {
  const [ivRaw, tagRaw, encryptedRaw] = payload.split(".");
  if (!ivRaw || !tagRaw || !encryptedRaw) throw new Error("Invalid encrypted token payload");
  const key = crypto.createHash("sha256").update(tokenSecret).digest();
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivRaw, "base64"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedRaw, "base64")), decipher.final()]).toString("utf8");
};

const getConnection = (userId: string): GitHubConnection | undefined =>
  db.prepare("SELECT userId, username, encryptedToken, createdAt, updatedAt FROM github_connections WHERE userId = ?").get(userId) as GitHubConnection | undefined;

const getToken = (userId: string) => {
  const connection = getConnection(userId);
  if (!connection) throw new Error("GitHub is not connected");
  return decryptToken(connection.encryptedToken);
};

const githubFetch = async <T>(token: string, path: string, init: RequestInit = {}): Promise<T> => {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ message: response.statusText })) as { message?: string };
    throw new Error(payload.message || `GitHub API failed: ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

const encodeRef = (branch: string) => branch.split("/").map(encodeURIComponent).join("/");

const normalizeBranchName = (branchName: string) =>
  branchName.trim().replace(/^refs\/heads\//, "").replace(/\s+/g, "-").replace(/[^A-Za-z0-9._/-]/g, "-").replace(/\/+/g, "/");

const getBaseRef = (token: string, owner: string, repo: string, branch: string) =>
  githubFetch<GitHubRef>(token, `/repos/${owner}/${repo}/git/ref/heads/${encodeRef(branch)}`);

const ensureBranch = async (token: string, owner: string, repo: string, baseBranch: string, branchName: string) => {
  const branch = normalizeBranchName(branchName);
  const baseRef = await getBaseRef(token, owner, repo, baseBranch);

  try {
    await githubFetch<GitHubRef>(token, `/repos/${owner}/${repo}/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseRef.object.sha }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (!/Reference already exists|already exists/i.test(message)) throw error;
  }

  return { branch, baseSha: baseRef.object.sha };
};

const commitFiles = async (
  token: string,
  owner: string,
  repo: string,
  branch: string,
  files: Array<{ path: string; content: string }>,
  commitMessage: string
) => {
  const branchRef = await getBaseRef(token, owner, repo, branch);
  const parentSha = branchRef.object.sha;
  const parentCommit = await githubFetch<GitHubCommit>(token, `/repos/${owner}/${repo}/git/commits/${parentSha}`);
  const tree = await githubFetch<{ sha: string }>(token, `/repos/${owner}/${repo}/git/trees`, {
    method: "POST",
    body: JSON.stringify({
      base_tree: parentCommit.tree.sha,
      tree: files.map((file) => ({
        path: file.path.replace(/\\/g, "/"),
        mode: "100644",
        type: "blob",
        content: file.content ?? "",
      })),
    }),
  });
  const commit = await githubFetch<{ sha: string; html_url?: string }>(token, `/repos/${owner}/${repo}/git/commits`, {
    method: "POST",
    body: JSON.stringify({
      message: commitMessage,
      tree: tree.sha,
      parents: [parentSha],
    }),
  });

  await githubFetch<GitHubRef>(token, `/repos/${owner}/${repo}/git/refs/heads/${encodeRef(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha, force: false }),
  });

  return { commitSha: commit.sha, treeSha: tree.sha };
};

router.get("/github/status", async (req, res) => {
  const connection = getConnection(req.user!.userId);
  if (!connection) return res.json({ connected: false });
  res.json({ connected: true, username: connection.username, updatedAt: connection.updatedAt });
});

router.post("/github/connect", async (req, res) => {
  const parsed = connectSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid GitHub token", details: parsed.error.flatten() });

  try {
    const user = await githubFetch<GitHubUser>(parsed.data.token, "/user");
    const now = Date.now();
    db.prepare(
      "INSERT INTO github_connections (userId, username, encryptedToken, createdAt, updatedAt) VALUES (?,?,?,?,?) ON CONFLICT(userId) DO UPDATE SET username = excluded.username, encryptedToken = excluded.encryptedToken, updatedAt = excluded.updatedAt"
    ).run(req.user!.userId, user.login, encryptToken(parsed.data.token), now, now);
    res.json({ connected: true, username: user.login, profileUrl: user.html_url, avatarUrl: user.avatar_url });
  } catch (error) {
    res.status(401).json({ error: error instanceof Error ? error.message : "GitHub connection failed" });
  }
});

router.delete("/github/connect", (req, res) => {
  db.prepare("DELETE FROM github_connections WHERE userId = ?").run(req.user!.userId);
  res.json({ connected: false });
});

router.get("/github/repos", async (req, res) => {
  try {
    const token = getToken(req.user!.userId);
    const repos = await githubFetch<GitHubRepo[]>(token, "/user/repos?sort=updated&per_page=100&affiliation=owner,collaborator,organization_member");
    res.json(repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
      defaultBranch: repo.default_branch,
      htmlUrl: repo.html_url,
      canPush: Boolean(repo.permissions?.push || repo.permissions?.admin || repo.permissions?.maintain),
    })));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to list GitHub repos" });
  }
});

router.get("/github/repos/:owner/:repo/branches", async (req, res) => {
  try {
    const token = getToken(req.user!.userId);
    const branches = await githubFetch<Array<{ name: string; commit: { sha: string } }>>(
      token,
      `/repos/${req.params.owner}/${req.params.repo}/branches?per_page=100`
    );
    res.json(branches.map((branch) => ({ name: branch.name, sha: branch.commit.sha })));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to list branches" });
  }
});

router.post("/github/repos/:owner/:repo/branches", async (req, res) => {
  const parsed = createBranchSchema.safeParse({ ...req.body, owner: req.params.owner, repo: req.params.repo });
  if (!parsed.success) return res.status(400).json({ error: "Invalid branch request", details: parsed.error.flatten() });

  try {
    const token = getToken(req.user!.userId);
    const result = await ensureBranch(token, parsed.data.owner, parsed.data.repo, parsed.data.baseBranch, parsed.data.branchName);
    res.json({ branch: result.branch, baseSha: result.baseSha });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create branch" });
  }
});

router.post("/github/repos/:owner/:repo/pull-request", async (req, res) => {
  const parsed = createPrSchema.safeParse({ ...req.body, owner: req.params.owner, repo: req.params.repo });
  if (!parsed.success) return res.status(400).json({ error: "Invalid pull request data", details: parsed.error.flatten() });

  try {
    const token = getToken(req.user!.userId);
    const { owner, repo, baseBranch, title, body, files, commitMessage } = parsed.data;
    const { branch } = await ensureBranch(token, owner, repo, baseBranch, parsed.data.branchName);
    const commit = await commitFiles(token, owner, repo, branch, files, commitMessage);
    const pr = await githubFetch<GitHubPullRequest>(token, `/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      body: JSON.stringify({
        title,
        head: branch,
        base: baseBranch,
        body: `${body || ""}\n\nGenerated by UiMason.\n\nCommit: ${commit.commitSha}`.trim(),
      }),
    });

    res.json({
      branch,
      commitSha: commit.commitSha,
      pullRequestNumber: pr.number,
      pullRequestUrl: pr.html_url,
      state: pr.state,
      title: pr.title,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create pull request" });
  }
});

export default router;
