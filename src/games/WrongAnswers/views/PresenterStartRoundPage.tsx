// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { WrongAnswersPresenterModel } from "../models/PresenterModel";
import styles from "./Presenter.module.css"



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
                <div className={styles.promptIntro}>Use your devices to give <span className={styles.textHighlight}>wrong answers</span> for this prompt:</div>
                <div className={styles.promptText}>{appModel.currentPrompt.text}</div>   
                <div className={styles.progressTitle}>Waiting for {appModel.answerSetSize - appModel.foundAnswers.length} answers!</div>          
            </div>
        );

    }
}
