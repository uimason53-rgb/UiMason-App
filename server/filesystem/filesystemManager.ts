import { readFile } from "./readFile";
import { writeFile } from "./writeFile";
import { deleteFile } from "./deleteFile";
import { moveFile } from "./moveFile";
import { copyFile } from "./copyFile";

export class FilesystemManager {

    read(

        path: string

    ) {

        return readFile(

            path

        );

    }

    write(

        path: string,

        content: string

    ) {

        return writeFile(

            path,

            content

        );

    }

    delete(

        path: string

    ) {

        return deleteFile(

            path

        );

    }

    move(

        source: string,

        target: string

    ) {

        return moveFile(

            source,

            target

        );

    }

    copy(

        source: string,

        target: string

    ) {

        return copyFile(

            source,

            target

        );

    }

}