import type { ExecutionStatus } from "./types/execution.types";

export class ExecutionState {

    private states =
        new Map<
            string,
            ExecutionStatus
        >();

    set(

        sessionId: string,

        status: ExecutionStatus

    ) {

        this.states.set(

            sessionId,

            status

        );

    }

    get(

        sessionId: string

    ) {

        return this.states.get(

            sessionId

        );

    }

}