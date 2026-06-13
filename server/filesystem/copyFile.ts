import fs from "fs/promises";

export async function copyFile(

    source: string,

    target: string

) {

    await fs.copyFile(

        source,

        target

    );

}