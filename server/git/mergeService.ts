export class MergeService {

    async merge(

        source: string,

        target: string

    ) {

        return {

            success: true,

            source,

            target

        };

    }

}