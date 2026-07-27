// The game's entry point: wires models + lazy views into the framework.
import { getOneOhOnePresenterTypeHelper } from "../models/PresenterModel";
import { getOneOhOneClientTypeHelper } from "../models/ClientModel";
import React from "react";
import { ClusterfunGameComponent, ClusterFunGameProps } from "libs";

const lazyPresenter = React.lazy(() => import(`./Presenter`));
const lazyClient = React.lazy(() => import(`./Client`));

// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
export default class OneOhOneGameComponent extends ClusterfunGameComponent {
  constructor(props: ClusterFunGameProps) {
    super(props);

    this.init(
      lazyPresenter,
      lazyClient,
      getOneOhOnePresenterTypeHelper,
      getOneOhOneClientTypeHelper,
    );
  }
}
