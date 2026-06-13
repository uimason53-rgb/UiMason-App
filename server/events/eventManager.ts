import {
    EventBus
}
from "./eventBus";

import {
    EventHistory
}
from "./eventHistory";

import type {
    EventData
}
from "./types/event.types";

export class EventManager {

    private bus =
        new EventBus();

    private history =
        new EventHistory();

    emit(
        event: EventData
    ) {

        this.bus.emit(

            event.type,
            event.payload

        );

        this.history.add(

            event

        );

    }

    getHistory() {

        return this.history.getAll();

    }

}