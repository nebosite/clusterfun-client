// App Navigation handled here
import {  getLexiblePresenterTypeHelper } from "../models/PresenterModel";
import {  getLexibleClientTypeHelper } from "../models/ClientModel";
import React from "react";
import { ClusterfunGameComponent, ClusterFunGameProps } from "libs";

const lazyPresenter = React.lazy(() => import("./Presenter"));
const lazyClient = React.lazy(() => import("./Client"))

// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
export default class LexibleGameComponent extends ClusterfunGameComponent {
    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: ClusterFunGameProps) {
        super(props);

        this.init(
            lazyPresenter, 
            lazyClient, 
            getLexiblePresenterTypeHelper, 
            getLexibleClientTypeHelper)
    }
}

