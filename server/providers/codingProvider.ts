import type {

    AIRequest,
    AIResponse

} from "./types/provider.types";

export class CodingProvider {

    async execute(

        request: AIRequest

    ): Promise<AIResponse> {

        return {

            content:

                request.prompt

        };

    }

}