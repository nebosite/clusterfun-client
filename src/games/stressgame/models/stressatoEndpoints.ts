import MessageEndpoint from "libs/messaging/MessageEndpoint";

export const StressatoPresenterRelayWithReturnEndpoint: MessageEndpoint<
    { returnSize: number, actionData: string }, 
    { actionData: string } | undefined> = {
    route: "/utils/stressato/relay-with-return"
}

export const StressatoPresenterRelayWithoutReturnEndpoint: MessageEndpoint<{ actionData: string }, void> = {
    route: "/utils/stressato/relay-without-return"
}