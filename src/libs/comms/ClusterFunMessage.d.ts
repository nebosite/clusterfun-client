export declare class ClusterFunMessageBase {
    /**
     * A unique identifier for the message.
     */
    readonly messageId?: number;
    /**
     * The ID of the original message's sender, useful for determining the context of the message.
     */
    readonly sender: string;
    constructor(payload: {
        messageId?: number;
        sender: string;
    });
}
export declare class ClusterFunJoinMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunJoinMessage";
    readonly name: string;
    constructor(payload: ClusterFunJoinMessage);
}
export declare class ClusterFunJoinAckMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunJoinAckMessage";
    readonly isRejoin: boolean;
    readonly didJoin: boolean;
    readonly joinError?: string;
    constructor(payload: ClusterFunJoinAckMessage);
}
export declare class ClusterFunQuitMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunQuitMessage";
}
export declare class ClusterFunKeepAliveMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunKeepAliveMessage";
}
export declare class ClusterFunReceiptAckMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunReceiptAckMessage";
    readonly ackedMessageId: number;
    constructor(payload: ClusterFunReceiptAckMessage);
}
export declare class ClusterFunPingMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunPingMessage";
    readonly pingTime: number;
    constructor(payload: ClusterFunPingMessage);
}
export declare class ClusterFunPingAckMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunPingAckMessage";
    readonly pingTime: number;
    readonly localTime: number;
    constructor(payload: ClusterFunPingAckMessage);
}
export declare class ClusterFunTerminateGameMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunTerminateGameMessage";
    constructor(payload: {
        sender: string;
    });
}
export declare class ClusterFunGameOverMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunGameOverMessage";
    constructor(payload: {
        sender: string;
    });
}
export declare class ClusterFunGamePauseMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunGamePauseMessage";
    constructor(payload: {
        sender: string;
    });
}
export declare class ClusterFunGameResumeMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunGameResumeMessage";
    constructor(payload: {
        sender: string;
    });
}
export declare class ClusterFunServerStateMessage extends ClusterFunMessageBase {
    static readonly messageTypeName = "ClusterFunServerStateMessage";
    readonly state: string;
    readonly isPaused: boolean;
    constructor(payload: ClusterFunServerStateMessage);
}
