import type {
    ProjectFile
} from "./types/index.types";

export async function projectScanner(

    _root: string

): Promise<{

    files: ProjectFile[]

}> {

    return {

        files: []

    };

}