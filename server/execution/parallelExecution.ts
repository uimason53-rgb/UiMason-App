export class ParallelExecution {

    async run(

        tasks: (() => Promise<any>)[]

    ) {

        return Promise.all(

            tasks.map(

                task => task()

            )

        );

    }

}