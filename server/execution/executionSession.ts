import type {

    ExecutionSession

} from "./types/execution.types";

export class SessionStore {

    private sessions =
        new Map<
            string,
            ExecutionSession
        >();

    create(

        session: ExecutionSession

    ) {

        this.sessions.set(

            session.id,

            session

        );

    }

    get(

        sessionId: string

    ) {

        return this.sessions.get(

            sessionId

        );

    }

}