// App Navigation handled here
import {  getTestatoHostTypeHelper } from "../models/HostModel";
import {  getTestatoClientTypeHelper } from "../models/ClientModel";
import React from "react";
import { ClusterfunGameComponent } from "libs";
import { ClusterFunGameAndUIProps } from "libs/config/ClusterFunGameProps";
import { getTestatoPresenterTypeHelper } from "../models/PresenterModel";

const lazyPresenter = React.lazy(() => import(`./Presenter`));
const lazyClient = React.lazy(() => import(`./Client`));

// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
export default class TestatoGameComponent extends ClusterfunGameComponent {
    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: ClusterFunGameAndUIProps) {
        super(props);

        this.init(
            lazyPresenter, 
            lazyClient, 
            getTestatoPresenterTypeHelper, 
            getTestatoClientTypeHelper)
    }
}

