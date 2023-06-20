// App Navigation handled here
import {  getStressatoHostTypeHelper } from "../models/HostModel";
import {  getStressatoClientTypeHelper } from "../models/ClientModel";
import React from "react";
import { ClusterfunGameComponent } from "libs";
import { ClusterFunGameAndUIProps } from "libs/config/ClusterFunGameProps";
import { getStressatoPresenterTypeHelper } from "../models/PresenterModel";

const lazyPresenter = React.lazy(() => import(`./Presenter`));
const lazyClient = React.lazy(() => import(`./Client`));

// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
export default class StressatoGameComponent extends ClusterfunGameComponent {
    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: ClusterFunGameAndUIProps) {
        super(props);

        this.init(
            lazyPresenter, 
            lazyClient, 
            getStressatoPresenterTypeHelper, 
            getStressatoClientTypeHelper)
    }
}

