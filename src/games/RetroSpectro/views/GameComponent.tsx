// App Navigation handled here
import React from "react";
//import { Provider } from "mobx-react";
import { getRetroSpectroPresenterTypeHelper } from "../models/PresenterModel";
import { getRetroSpectroClientTypeHelper } from "../models/ClientModel";
import { ClusterFunGameProps, ClusterfunGameComponent } from "libs";

const lazyPresenter = React.lazy(() => import(`./presenter/Presenter`));
const lazyClient = React.lazy(() => import(`./client/Client`));

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
