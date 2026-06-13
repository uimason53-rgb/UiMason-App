import type {
    TerminalSessionData
} from "./types/sandbox.types";

export class TerminalSession {

    private sessions =
        new Map<
            string,
            TerminalSessionData
        >();

    create(
        id: string
    ) {

        const session: TerminalSessionData = {

            id,

            createdAt:
                Date.now()

        };

        this.sessions.set(

            id,

            session

        );

        return session;

    }

    get(
        id: string
    ) {

        return this.sessions.get(

            id

        );

    }

    remove(
        id: string
    ) {

        this.sessions.delete(

            id

        );

    }

}