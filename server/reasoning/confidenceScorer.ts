export class ConfidenceScorer {

    score(

        confidence: number

    ) {

        return Math.min(

            confidence,

            1

        );

    }

}