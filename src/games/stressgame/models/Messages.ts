import { ClusterFunMessageBase } from "libs";

export class StressatoPlayerActionMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "StressatoPlayerActionMessage";
    actionData: any;
    returnSize: number = 0;

    // eslint-disable-next-line
    constructor(payload: StressatoPlayerActionMessage)  { super(payload); Object.assign(this, payload); } 
}

export class StressatoServerActionMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "StressatoServerActionMessage";
    actionData: any;

    // eslint-disable-next-line
    constructor(payload: StressatoServerActionMessage)  { super(payload); Object.assign(this, payload); } 
}

