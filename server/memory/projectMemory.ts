export class ProjectMemory {

    private memories:
        string[]
        = [];

    add(

        item: string

    ) {

        this.memories.push(

            item

        );

    }

    getAll() {

        return this.memories;

    }

}