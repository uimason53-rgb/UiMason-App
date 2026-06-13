import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync =

    promisify(

        exec

    );

export async function commandRunner(

    command: string

) {

    const result =

        await execAsync(

            command

        );

    return {

        stdout:

            result.stdout,

        stderr:

            result.stderr,

        exitCode:

            0

    };

}