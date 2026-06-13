import {

    MemoryStore

} from "./memoryStore";

import {

    VectorMemory

} from "./vectorMemory";

import {

    SemanticSearch

} from "./semanticSearch";

export class ContextRetriever {

    private memoryStore =
        new MemoryStore();

    private vectorMemory =
        new VectorMemory();

    private semanticSearch =
        new SemanticSearch();

    async retrieve(

        query: string

    ) {

        const results =

            await this.semanticSearch
                .search(
                    query
                );

        return {

            query,

            results,

            memories:

                this.memoryStore
                    .getAll(),

            vectors:

                this.vectorMemory
                    .getAll()

        };

    }

}