export class PlanningMemory {

    private plans:
        string[]
        = [];

    add(

        plan: string

    ) {

        this.plans.push(

            plan

        );

    }

    getAll() {

        return this.plans;

    }

}