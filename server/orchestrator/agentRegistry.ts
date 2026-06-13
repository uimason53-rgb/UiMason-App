export class AgentRegistry {

    private agents =
        new Map<
            string,
            any
        >();

    register(

        name: string,

        agent: any

    ) {

        this.agents.set(

            name,

            agent

        );

    }

    get(

        name: string

    ) {

        return this.agents.get(

            name

        );

    }

}