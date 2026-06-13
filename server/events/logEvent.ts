import type {
    EventData
}
from "./types/event.types";

export class LogEvent {

    create(
        message: string
    ): EventData {

        return {

            type:
                "log",

            payload: {

                message

            },

            timestamp:
                Date.now()

        };

    }

}