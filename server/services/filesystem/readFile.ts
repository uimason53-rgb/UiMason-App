import fs from "fs/promises";

export interface ReadFileResult {
  path: string;
  content: string;
}

export async function readFile(
  path: string
): Promise<ReadFileResult> {

  const content = await fs.readFile(
    path,
    "utf8"
  );

  return {
    path,
    content
  };

}