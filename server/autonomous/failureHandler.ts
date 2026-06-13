export class FailureHandler {

    handle(

        error: unknown

    ) {

        return {

            success: false,

            error

        };

    }

}