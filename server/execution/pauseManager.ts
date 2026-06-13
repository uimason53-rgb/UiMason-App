export class PauseManager {

    private paused =
        new Set<string>();

    pause(

        sessionId: string

    ) {

        this.paused.add(

            sessionId

        );

    }

    isPaused(

        sessionId: string

    ) {

        return this.paused.has(

            sessionId

        );

    }

}