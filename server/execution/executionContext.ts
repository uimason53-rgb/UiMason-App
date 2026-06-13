import type { ExecutionContext } from "./types/execution.types";

export class ExecutionContextStore {

    private contexts =
        new Map<
            string,
            ExecutionContext
        >();

    set(

        sessionId: string,

        context: ExecutionContext

    ) {

        this.contexts.set(

            sessionId,

            context

        );

    }

    get(

        sessionId: string

    ) {

        return this.contexts.get(

            sessionId

        );

    }

}