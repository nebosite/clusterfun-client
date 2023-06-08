import MessageEndpoint from "libs/messaging/MessageEndpoint";

export const StressatoHostRelayEndpoint: MessageEndpoint<
    { returnSize: number, actionData: string }, 
    { actionData: string } | undefined> = {
    route: "/utils/stressato/relay",
    responseRequired: false
}