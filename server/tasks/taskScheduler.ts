import type {

    Task

} from "./types/task.types";

export class TaskScheduler {

    sort(

        tasks: Task[]

    ) {

        const priorityOrder = {

            critical: 4,

            high: 3,

            normal: 2,

            low: 1

        };

        return tasks.sort(

            (a, b) =>

                priorityOrder[
                    b.priority
                ]

                -

                priorityOrder[
                    a.priority
                ]

        );

    }

}