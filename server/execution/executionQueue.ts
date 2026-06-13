export class ExecutionQueue {

    private queue:
        (() => Promise<any>)[]
        = [];

    enqueue(

        task: () => Promise<any>

    ) {

        this.queue.push(

            task

        );

    }

    async executeAll() {

        for (

            const task

            of this.queue

        ) {

            await task();

        }

    }

}