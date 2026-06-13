import fs from "fs/promises";

export async function moveFile(

  from: string,

  to: string

) {

  await fs.rename(
    from,
    to
  );

}