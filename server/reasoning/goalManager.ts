import type {

    Goal

} from "./types/reasoning.types";

export class GoalManager {

    private goals =
        new Map<
            string,
            Goal
        >();

    add(

        goal: Goal

    ) {

        this.goals.set(

            goal.id,

            goal

        );

    }

    get(

        id: string

    ) {

        return this.goals.get(

            id

        );

    }

}