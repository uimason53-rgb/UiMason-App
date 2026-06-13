import { BrainProvider } from "./brainProvider";
import { CodingProvider } from "./codingProvider";

export class ProviderManager {

    private _brain =
        new BrainProvider();

    private _coding =
        new CodingProvider();

    constructor() {

        void this._brain;

        void this._coding;

    }

}