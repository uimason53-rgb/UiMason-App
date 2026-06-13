import type {

    MemoryItem

} from "./types/memory.types";

export class MemoryStore {

    private memories:
        MemoryItem[]
        = [];

    add(

        memory: MemoryItem

    ) {

        this.memories.push(

            memory

        );

    }

    get(

        id: string

    ) {

        return this.memories.find(

            m =>

                m.id ===

                id

        );

    }

    getAll() {

        return this.memories;

    }

    remove(

        id: string

    ) {

        this.memories =

            this.memories.filter(

                m =>

                    m.id !==

                    id

            );

    }

    clear() {

        this.memories = [];

    }

    count() {

        return this.memories.length;

    }

}