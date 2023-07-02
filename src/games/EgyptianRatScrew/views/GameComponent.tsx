// App Navigation handled here
import {  getEgyptianRatScrewPresenterTypeHelper } from "../models/PresenterModel";
import {  getEgyptianRatScrewClientTypeHelper } from "../models/ClientModel";
import React from "react";
import { ClusterfunGameComponent, ClusterFunGameProps } from "libs";

const lazyPresenter = React.lazy(() => import(`./Presenter`));
const lazyClient = React.lazy(() => import(`./Client`));

// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
export default class EgyptianRatScrewGameComponent extends ClusterfunGameComponent {
    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: ClusterFunGameProps) {
        super(props);

        this.init(
            lazyPresenter, 
            lazyClient, 
            getEgyptianRatScrewPresenterTypeHelper, 
            getEgyptianRatScrewClientTypeHelper)
    }
}

