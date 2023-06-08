import { BaseGameModel, ISessionHelper, ITypeHelper } from "../../libs";
import { UIProperties } from "../../libs/types/UIProperties";
import React from "react";
import { ClusterFunGameProps } from "./GameChooser";
export declare class ClusterfunGameComponent extends React.Component<ClusterFunGameProps> {
    appModel?: BaseGameModel;
    UI: React.ComponentType<{
        appModel?: any;
        uiProperties: UIProperties;
    }>;
    init(presenterType: React.ComponentType<{
        appModel?: any;
        uiProperties: UIProperties;
    }>, clientType: React.ComponentType<{
        appModel?: any;
        uiProperties: UIProperties;
    }>, derivedHostTypeHelper: (sessionHelper: ISessionHelper, gameProps: ClusterFunGameProps) => ITypeHelper, derivedClientTypeHelper: (sessionHelper: ISessionHelper, gameProps: ClusterFunGameProps) => ITypeHelper): void;
    render(): JSX.Element;
}
