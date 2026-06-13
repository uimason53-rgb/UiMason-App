import type { SymbolNode }
from "./types/graph.types";

export function createSymbolNode(

    name: string,

    type:
        | "function"
        | "class"
        | "interface"
        | "variable",

    file: string

): SymbolNode {

    return {

        id: crypto.randomUUID(),

        name,

        type,

        file

    };

}