export interface ArchitectureRelation {

    from: string;

    to: string;

}

export class ArchitectureGraph {

    relations:
        ArchitectureRelation[]
        = [];

    add(

        from: string,

        to: string

    ) {

        this.relations.push({

            from,

            to

        });

    }

}