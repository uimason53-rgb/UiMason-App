export class CancellationManager {

    private cancelled =
        new Set<string>();

    cancel(

        sessionId: string

    ) {

        this.cancelled.add(

            sessionId

        );

    }

    isCancelled(

        sessionId: string

    ) {

        return this.cancelled.has(

            sessionId

        );

    }

}