import fs from "fs/promises";

export async function mkdir(path: string, recursive = true): Promise<void> {
  await fs.mkdir(path, { recursive });
}