export class EmbeddingService {

    async embed(

        _text: string

    ): Promise<number[]> {

        /*
        Placeholder embedding.

        Nanti akan diganti dengan:

        OpenAI
        Gemini
        Voyage AI
        Ollama
        Local BGE

        */

        return Array.from(

            {

                length: 1536

            },

            () => Math.random()

        );

    }

}