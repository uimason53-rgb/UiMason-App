import fs from "fs/promises";

export interface StatResult {
  path: string;
  size: number;
  isFile: boolean;
  isDirectory: boolean;
  createdAt: number;
  modifiedAt: number;
}

export async function statFile(path: string): Promise<StatResult> {
  const stats = await fs.stat(path);
  return {
    path,
    size: stats.size,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    createdAt: stats.birthtimeMs,
    modifiedAt: stats.mtimeMs,
  };
}