import fs from "fs/promises";

export async function moveFile(

    source: string,

    target: string

) {

    await fs.rename(

        source,

        target

    );

}