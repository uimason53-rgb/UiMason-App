import type {
    EventData
}
from "./types/event.types";

export class EventHistory {

    private history:
        EventData[] = [];

    add(
        event: EventData
    ) {

        this.history.push(

            event

        );

    }

    getAll() {

        return this.history;

    }

}