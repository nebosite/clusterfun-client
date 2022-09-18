import { ClusterFunMessageBase } from "../ClusterFunMessage";

export interface ClusterFunMessageConstructor<P, M extends ClusterFunMessageBase> {
    readonly messageTypeName: string;
    new (payload: P): M;
};