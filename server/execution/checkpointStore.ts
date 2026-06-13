export class CheckpointStore {

    private checkpoints =
        new Map<
            string,
            any
        >();

    save(

        sessionId: string,

        state: any

    ) {

        this.checkpoints.set(

            sessionId,

            state

        );

    }

    get(

        sessionId: string

    ) {

        return this.checkpoints.get(

            sessionId

        );

    }

}