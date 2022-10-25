// App Navigation handled here
import {  getLexiblePresenterTypeHelper } from "../models/LexiblePresenterModel";
import {  getLexibleClientTypeHelper } from "../models/LexibleClientModel";
import { ClusterFunGameProps } from "libs";
import ClusterfunGameComponent from "libs/components/ClustfunGameComponent";
import React from "react";

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
            ()=> React.lazy(() => import(`./LexiblePresenter`)), 
            ()=> React.lazy(() => import(`./LexibleClient`)), 
            getLexiblePresenterTypeHelper, 
            getLexibleClientTypeHelper)
    }
}

