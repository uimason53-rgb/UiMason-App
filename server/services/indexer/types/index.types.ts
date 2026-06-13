export interface ProjectFile {

    path: string;

    extension: string;

}

export interface SymbolInfo {

    name: string;

    type:
        | "function"
        | "class"
        | "interface"
        | "variable";

    file: string;

}

export interface DependencyEdge {

    from: string;

    to: string;

}