import fs from "fs/promises";

export async function writeFile(

    path: string,

    content: string

) {

    await fs.writeFile(

        path,

        content,

        "utf-8"

    );

}