// App Navigation handled here
import {  getLexibleHostTypeHelper } from "../models/HostModel";
import {  getLexibleClientTypeHelper } from "../models/ClientModel";
import React from "react";
import { ClusterfunGameComponent } from "libs";
import { ClusterFunGameAndUIProps } from "libs/config/ClusterFunGameProps";

const lazyPresenter = React.lazy(() => import("./Presenter"));
const lazyClient = React.lazy(() => import("./Client"))

// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
export default class LexibleGameComponent extends ClusterfunGameComponent {
    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: ClusterFunGameAndUIProps) {
        super(props);

        this.init(
            lazyPresenter, 
            lazyClient, 
            getLexibleHostTypeHelper, 
            getLexibleClientTypeHelper)
    }
}

