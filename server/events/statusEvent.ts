import type {
    EventData
}
from "./types/event.types";

export class StatusEvent {

    create(
        status: string
    ): EventData {

        return {

            type:
                "status",

            payload: {

                status

            },

            timestamp:
                Date.now()

        };

    }

}