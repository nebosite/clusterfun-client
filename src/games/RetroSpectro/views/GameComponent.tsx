// App Navigation handled here
import React from "react";
//import { Provider } from "mobx-react";
import { getRetroSpectroPresenterTypeHelper } from "../models/RetroSpectroPresenterModel";
import { getRetroSpectroClientTypeHelper } from "../models/RetroSpectroClientModel";
import { ClusterFunGameProps, ClusterfunGameComponent } from "libs";

const lazyPresenter = React.lazy(() => import(`./presenter/RetroSpectroPresenter`));
const lazyClient = React.lazy(() => import(`./client/RetroSpectroClient`));

// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
export default class RetroSpectroGameComponent extends ClusterfunGameComponent {
    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: ClusterFunGameProps) {
        super(props);

        this.init(
            lazyPresenter, 
            lazyClient, 
            getRetroSpectroPresenterTypeHelper, 
            getRetroSpectroClientTypeHelper)
    }
}

