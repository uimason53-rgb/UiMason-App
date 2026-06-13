import type {

    FileNode,

    SymbolNode,

    GraphRelation

}
from "./types/graph.types";

export class GraphStore {

    files: FileNode[] = [];

    symbols: SymbolNode[] = [];

    relations: GraphRelation[] = [];

}