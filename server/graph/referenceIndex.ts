export class ReferenceIndex {

    private references =
        new Map<
            string,
            string[]
        >();

    add(

        symbol: string,

        file: string

    ) {

        const existing =

            this.references.get(

                symbol

            ) || [];

        existing.push(

            file

        );

        this.references.set(

            symbol,

            existing

        );

    }

    getReferences(

        symbol: string

    ) {

        return (

            this.references.get(

                symbol

            ) || []

        );

    }

}