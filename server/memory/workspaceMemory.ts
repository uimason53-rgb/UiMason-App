export class WorkspaceMemory {

    private workspaces =
        new Map<
            string,
            string[]
        >();

    add(

        workspaceId: string,

        content: string

    ) {

        const current =

            this.workspaces.get(

                workspaceId

            ) || [];

        current.push(

            content

        );

        this.workspaces.set(

            workspaceId,

            current

        );

    }

}