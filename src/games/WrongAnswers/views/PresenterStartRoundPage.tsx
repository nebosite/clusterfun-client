// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { WrongAnswersPresenterModel } from "../models/PresenterModel";


@inject("appModel") @observer
export class PresenterStartRoundPage  extends React.Component<{appModel?: WrongAnswersPresenterModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>;

        return (
            <div>
                <h3>{appModel.name}</h3>
                <p>Use you devices to give wrong answers for this prompt:</p>
                <p>{appModel.currentPrompt.text}</p>             
            </div>
        );

    }
}
