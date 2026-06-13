import { GraphStore }
from "./graphStore";

export async function graphBuilder(

    files: any[],

    symbols: any[],

    dependencies: any[]

) {

    const graph =
        new GraphStore();

    graph.files = files;

    graph.symbols = symbols;

    graph.relations = dependencies;

    return graph;

}