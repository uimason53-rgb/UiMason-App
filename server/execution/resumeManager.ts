import { CheckpointStore } from "./checkpointStore";

export class ResumeManager {

    private checkpoints =
        new CheckpointStore();

    resume(

        sessionId: string

    ) {

        return this.checkpoints.get(

            sessionId

        );

    }

}