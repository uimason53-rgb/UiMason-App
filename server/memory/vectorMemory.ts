import type {

    Embedding

} from "./types/memory.types";

export class VectorMemory {

    private vectors:
        Embedding[]
        = [];

    add(

        embedding: Embedding

    ) {

        this.vectors.push(

            embedding

        );

    }

    get(

        id: string

    ) {

        return this.vectors.find(

            v =>

                v.id ===

                id

        );

    }

    getAll() {

        return this.vectors;

    }

    remove(

        id: string

    ) {

        this.vectors =

            this.vectors.filter(

                v =>

                    v.id !==

                    id

            );

    }

    clear() {

        this.vectors = [];

    }

    count() {

        return this.vectors.length;

    }

}