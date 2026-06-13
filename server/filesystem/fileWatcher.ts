import fs from "fs";

export function fileWatcher(

    path: string,

    callback: () => void

) {

    fs.watch(

        path,

        callback

    );

}