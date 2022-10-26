// App Navigation handled here
import {  getLexiblePresenterTypeHelper } from "../models/LexiblePresenterModel";
import {  getLexibleClientTypeHelper } from "../models/LexibleClientModel";
import React from "react";
import { ClusterfunGameComponent, ClusterFunGameProps } from "libs";

const lazyPresenter = React.lazy(() => import("./LexiblePresenter"));
const lazyClient = React.lazy(() => import("./LexibleClient"))

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

