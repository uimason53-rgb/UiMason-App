import type { FileNode }
from "./types/graph.types";

export function createFileNode(

    path: string

): FileNode {

    return {

        id: crypto.randomUUID(),

        path

    };

}