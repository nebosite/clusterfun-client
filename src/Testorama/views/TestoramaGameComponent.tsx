// App Navigation handled here
import {  getTestoramaPresenterTypeHelper } from "../models/TestoramaPresenterModel";
import {  getTestoramaClientTypeHelper } from "../models/TestoramaClientModel";
import { ClusterFunGameProps } from "libs";
import ClusterfunGameComponent from "libs/components/ClustfunGameComponent";
import React from "react";

const lazyPresenter = React.lazy(() => import(`./TestoramaPresenter`));
const lazyClient = React.lazy(() => import(`./TestoramaClient`));

// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
export default class TestoramaGameComponent extends ClusterfunGameComponent {
    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: ClusterFunGameProps) {
        super(props);

        this.init(
            lazyPresenter, 
            lazyClient, 
            getTestoramaPresenterTypeHelper, 
            getTestoramaClientTypeHelper)
    }
}

