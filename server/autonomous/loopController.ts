import { RetryManager } from "./retryManager";
import { StopCondition } from "./stopCondition";

export class LoopController {

    private _retry =
        new RetryManager();

    private _stop =
        new StopCondition();

    constructor() {

        void this._retry;

        void this._stop;

    }

}