import type { GraphRelation }
from "./types/graph.types";

export function createRelation(

    from: string,

    to: string,

    type: GraphRelation["type"]

): GraphRelation {

    return {

        from,

        to,

        type

    };

}