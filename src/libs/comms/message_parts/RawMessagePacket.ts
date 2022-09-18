import ClusterFunMessageHeader from "./ClusterFunMessageHeader";

/**
 * Describes the parts that constitute a serialized ClusterFun message
 */
export interface RawMessagePacket<P> {
    header: ClusterFunMessageHeader,
    payload: P
}