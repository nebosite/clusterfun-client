import { ClusterFunMessageBase } from "libs/comms";

export class TestoramaPlayRequestMessage  extends ClusterFunMessageBase {
    static readonly messageTypeName = "TestoramaPlayRequestMessage";
    customText: string = "";
    roundNumber: number = 0;
    
    // eslint-disable-next-line
    constructor(payload: TestoramaPlayRequestMessage) { super(payload); Object.assign(this, payload);  } 
}

export class TestoramaEndOfRoundMessage  extends ClusterFunMessageBase {
    static readonly messageTypeName = "TestoramaEndOfRoundMessage";
    roundNumber: number = 0;
    
    // eslint-disable-next-line
    constructor(payload: TestoramaEndOfRoundMessage) { super(payload); Object.assign(this, payload);  } 
}

export class TestoramaPlayerActionMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "TestoramaPlayerActionMessage";
    roundNumber: number = 0;
    action: string = "";
    actionData: any;

    // eslint-disable-next-line
    constructor(payload: TestoramaPlayerActionMessage)  { super(payload); Object.assign(this, payload); } 
}

