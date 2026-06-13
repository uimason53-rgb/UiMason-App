import fs from "fs/promises";

export async function directoryScanner(

    path: string

) {

    return fs.readdir(

        path

    );

}