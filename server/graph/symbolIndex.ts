export class SymbolIndex {

    private index =
        new Map<
            string,
            string
        >();

    add(

        symbol: string,

        file: string

    ) {

        this.index.set(

            symbol,

            file

        );

    }

    find(

        symbol: string

    ) {

        return this.index.get(

            symbol

        );

    }

}