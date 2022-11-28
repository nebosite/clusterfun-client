// App Navigation handled here
import {  getStressatoPresenterTypeHelper } from "../models/PresenterModel";
import {  getStressatoClientTypeHelper } from "../models/ClientModel";
import React from "react";
import { ClusterfunGameComponent, ClusterFunGameProps } from "libs";

const lazyPresenter = React.lazy(() => import(`./Presenter`));
const lazyClient = React.lazy(() => import(`./Client`));

// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
export default class StressatoGameComponent extends ClusterfunGameComponent {
    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: ClusterFunGameProps) {
        super(props);
    }

    componentDidMount(): void {
        this.init(
            lazyPresenter, 
            lazyClient, 
            getStressatoPresenterTypeHelper, 
            getStressatoClientTypeHelper)
    }
}

