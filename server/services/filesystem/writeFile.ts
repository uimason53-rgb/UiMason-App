import fs from "fs/promises";
import path from "path";

export interface WriteFileInput {
  path: string;
  content: string;
}

export async function writeFile(input: WriteFileInput) {
  await fs.mkdir(path.dirname(input.path), { recursive: true });
  await fs.writeFile(input.path, input.content, "utf8");
}