// The game's entry point: the framework mounts this component, which inspects the
// room role and constructs the right model (presenter or client) via the type
// helpers, restoring a saved game from storage if one exists.
import { getTemplatePresenterTypeHelper } from "../models/PresenterModel";
import { getTemplateClientTypeHelper } from "../models/ClientModel";
import React from "react";
import { ClusterfunGameComponent, ClusterFunGameProps } from "libs";

const lazyPresenter = React.lazy(() => import(`./Presenter`));
const lazyClient = React.lazy(() => import(`./Client`));

// -------------------------------------------------------------------
// Main Game Page
// -------------------------------------------------------------------
export default class TemplateGameComponent extends ClusterfunGameComponent {
  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(props: ClusterFunGameProps) {
    super(props);

    this.init(
      lazyPresenter,
      lazyClient,
      getTemplatePresenterTypeHelper,
      getTemplateClientTypeHelper,
    );
  }
}
