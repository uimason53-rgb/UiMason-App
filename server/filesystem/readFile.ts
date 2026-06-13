import fs from "fs/promises";

export async function readFile(

    path: string

) {

    return fs.readFile(

        path,

        "utf-8"

    );

}