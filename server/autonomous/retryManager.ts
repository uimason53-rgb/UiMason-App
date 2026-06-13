export class RetryManager {

    shouldRetry(

        retries: number

    ) {

        return retries < 3;

    }

}