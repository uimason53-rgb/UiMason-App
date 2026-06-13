import type { WorkflowState } from "./types/orchestrator.types";

export class WorkflowManager {

    private workflows =
        new Map<
            string,
            WorkflowState
        >();

    save(

        state: WorkflowState

    ) {

        this.workflows.set(

            state.taskId,

            state

        );

    }

    get(

        taskId: string

    ) {

        return this.workflows.get(

            taskId

        );

    }

}