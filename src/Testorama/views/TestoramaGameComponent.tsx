// App Navigation handled here
import {  getTestoramaPresenterTypeHelper } from "../models/TestoramaPresenterModel";
import {  getTestoramaClientTypeHelper } from "../models/TestoramaClientModel";
import { ClusterFunGameProps } from "libs";
import ClusterfunGameComponent from "libs/components/ClustfunGameComponent";
import React from "react";

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
            ()=> React.lazy(() => import(`./TestoramaPresenter`)), 
            ()=> React.lazy(() => import(`./TestoramaClient`)), 
            getTestoramaPresenterTypeHelper, 
            getTestoramaClientTypeHelper)
    }
}

