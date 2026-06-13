export class StrategySelector {

    select(

        options: string[]

    ) {

        if (

            options.length === 0

        ) {

            return null;

        }

        return options[0];

    }

}