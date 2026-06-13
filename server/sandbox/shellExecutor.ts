import {

    commandRunner

} from "./commandRunner";

export class ShellExecutor {

    async execute(

        command: string

    ) {

        return commandRunner(

            command

        );

    }

}