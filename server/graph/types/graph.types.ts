export interface FileNode {

    id: string;

    path: string;

}

export interface SymbolNode {

    id: string;

    name: string;

    type:
        | "function"
        | "class"
        | "interface"
        | "variable";

    file: string;

}

export interface GraphRelation {

    from: string;

    to: string;

    type:
        | "imports"
        | "contains"
        | "calls"
        | "extends"
        | "implements";

}