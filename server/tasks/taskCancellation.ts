export class TaskCancellation {

    private cancelled =
        new Set<string>();

    cancel(

        taskId: string

    ) {

        this.cancelled.add(

            taskId

        );

    }

    isCancelled(

        taskId: string

    ) {

        return this.cancelled.has(

            taskId

        );

    }

}