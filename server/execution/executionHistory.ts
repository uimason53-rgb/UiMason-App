import type {

    ExecutionHistoryItem

} from "./types/execution.types";

export class ExecutionHistory {

    private history:
        ExecutionHistoryItem[]
        = [];

    add(

        item: ExecutionHistoryItem

    ) {

        this.history.push(

            item

        );

    }

    getAll() {

        return this.history;

    }

}