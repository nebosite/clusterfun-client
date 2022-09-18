let globalMessageId = 1;
export class ClusterFunMessageBase {
    /**
     * A unique identifier for the message.
     */
    readonly messageId?: number;
    /**
     * The ID of the original message's sender, useful for determining the context of the message.
     */
    readonly sender: string; // note that this is only this deep in because we Ack every message
    constructor(payload: { messageId?: number, sender: string }) {
        this.messageId = payload.messageId || globalMessageId++;
        this.sender = payload.sender;
    }
}

export class ClusterFunJoinMessage extends ClusterFunMessageBase {
	static readonly messageTypeName = 'ClusterFunJoinMessage';
	readonly name: string;

    constructor(payload: ClusterFunJoinMessage) { 
        super(payload); 
        this.name = payload.name;
    }
}


export class ClusterFunJoinAckMessage extends ClusterFunMessageBase  {
    static readonly messageTypeName = 'ClusterFunJoinAckMessage';
    
    readonly isRejoin: boolean;
    readonly didJoin: boolean;
    readonly joinError?: string;

    constructor(payload: ClusterFunJoinAckMessage) { 
        super(payload);
        this.isRejoin = payload.isRejoin;
        this.didJoin = payload.didJoin;
        this.joinError = payload.joinError;
    }
}

export class ClusterFunQuitMessage extends ClusterFunMessageBase  {
	static readonly messageTypeName = 'ClusterFunQuitMessage';
}

export class ClusterFunKeepAliveMessage extends ClusterFunMessageBase  {
	static readonly messageTypeName = 'ClusterFunKeepAliveMessage';
}

export class ClusterFunReceiptAckMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunReceiptAckMessage";
    readonly ackedMessageId: number;

    constructor(payload: ClusterFunReceiptAckMessage)  {  
        super(payload); 
        this.ackedMessageId = payload.ackedMessageId;
    }
}

export class ClusterFunPingMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunPingMessage";
    readonly pingTime: number;

    constructor(payload: ClusterFunPingMessage) { 
        super(payload); 
        this.pingTime = payload.pingTime;
    }
}
export class ClusterFunPingAckMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunPingAckMessage";
    readonly pingTime: number;
    readonly localTime: number;

    constructor(payload: ClusterFunPingAckMessage) {  
        super(payload);
        this.pingTime = payload.pingTime;
        this.localTime = payload.localTime;
    }
}

export class ClusterFunTerminateGameMessage extends ClusterFunMessageBase { 
    static readonly messageTypeName = "ClusterFunTerminateGameMessage"; 
    constructor(payload: { sender: string }) {
        super(payload)
    }
}

export class ClusterFunGameOverMessage extends ClusterFunMessageBase { 
    static readonly messageTypeName = "ClusterFunGameOverMessage";  
    constructor(payload: { sender: string }) {
        super(payload)
    }
}

export class ClusterFunGamePauseMessage extends ClusterFunMessageBase { 
    static readonly messageTypeName = "ClusterFunGamePauseMessage";  
    constructor(payload: { sender: string }) {
        super(payload)
    }
}


export class ClusterFunGameResumeMessage extends ClusterFunMessageBase { 
    static readonly messageTypeName = "ClusterFunGameResumeMessage";  
    constructor(payload: { sender: string }) {
        super(payload)
    }
}

export class ClusterFunServerStateMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunServerStateMessage";
    readonly state: string;
    readonly isPaused: boolean;

    constructor(payload: ClusterFunServerStateMessage) {  
        super(payload);
        this.state = payload.state;
        this.isPaused = payload.isPaused;
    }
}