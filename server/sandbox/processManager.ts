export class ProcessManager {

    private processes =

        new Map<
            string,
            number
        >();

    register(

        id: string,

        pid: number

    ) {

        this.processes.set(

            id,

            pid

        );

    }

    get(

        id: string

    ) {

        return this.processes.get(

            id

        );

    }

}