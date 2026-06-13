import type {
    EventData
}
from "./types/event.types";

export class ProgressEvent {

    create(
        progress: number
    ): EventData {

        return {

            type:
                "progress",

            payload: {

                progress

            },

            timestamp:
                Date.now()

        };

    }

}