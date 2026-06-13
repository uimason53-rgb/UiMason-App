export interface CallEdge {

    caller: string;

    callee: string;

}

export class CallGraph {

    edges: CallEdge[] = [];

    addEdge(

        caller: string,

        callee: string

    ) {

        this.edges.push({

            caller,

            callee

        });

    }

}