import fs from "fs/promises";

export interface FileNode {

  path: string;

  type:
    | "file"
    | "directory";

}

export async function listFiles(
  dir: string
): Promise<FileNode[]> {

  const entries =
    await fs.readdir(
      dir,
      {
        withFileTypes: true
      }
    );

  return entries.map(
    entry => ({

      path: entry.name,

      type: entry.isDirectory()
        ? "directory"
        : "file"

    })
  );

}