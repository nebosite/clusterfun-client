// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css"
import { WrongAnswersPresenterModel } from "../models/PresenterModel";


@inject("appModel") @observer
export class PresenterInstructionsPage  extends React.Component<{appModel?: WrongAnswersPresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>;

        return (
            <div>
                <h3>{appModel.name} Instructions</h3>
                <p>During each round, you will get a prompt.  Give as many wrong answers as you can.
                    Be creative and funny!  When enough answers are gathered, there will be a mini tournament!
                </p>
                <button onClick={()=>appModel.startNextRound()}>Ready to Play!</button>
            </div>
        );

    }
}
