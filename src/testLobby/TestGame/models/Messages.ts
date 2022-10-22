import { ClusterFunMessageBase } from "libs";

export class TestatoPlayRequestMessage  extends ClusterFunMessageBase {
    static readonly messageTypeName = "TestatoPlayRequestMessage";
    customText: string = "";
    roundNumber: number = 0;
    
    // eslint-disable-next-line
    constructor(payload: TestatoPlayRequestMessage) { super(payload); Object.assign(this, payload);  } 
}

export class TestatoEndOfRoundMessage  extends ClusterFunMessageBase {
    static readonly messageTypeName = "TestatoEndOfRoundMessage";
    roundNumber: number = 0;
    
    // eslint-disable-next-line
    constructor(payload: TestatoEndOfRoundMessage) { super(payload); Object.assign(this, payload);  } 
}

export class TestatoPlayerActionMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "TestatoPlayerActionMessage";
    roundNumber: number = 0;
    action: string = "";
    actionData: any;

    // eslint-disable-next-line
    constructor(payload: TestatoPlayerActionMessage)  { super(payload); Object.assign(this, payload); } 
}

