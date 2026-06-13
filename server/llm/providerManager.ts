import { BrainProvider } from "./brainProvider";
import { CodingProvider } from "./codingProvider";

import type {

    LLMRequest

} from "./types/llm.types";

export class ProviderManager {

    private brain =
        new BrainProvider();

    private coding =
        new CodingProvider();

    async think(

        request: LLMRequest

    ) {

        return this.brain.generate(

            request

        );

    }

    async code(

        request: LLMRequest

    ) {

        return this.coding.generate(

            request

        );

    }

}