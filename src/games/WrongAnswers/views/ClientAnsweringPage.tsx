// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Client.module.css"
import { WrongAnswersClientModel } from "../models/ClientModel";
import { Row } from "libs";


@inject("appModel") @observer
export class ClientAnsweringPage  extends React.Component<{appModel?: WrongAnswersClientModel}> {
    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>;

        const handleAnswerSubmit = () => {

        }

        return (
            <div>
                <div className={styles.promptPrefix}>
                    Wrong answers for this prompt: 
                </div>
                <div className={styles.prompt}>
                    {appModel.prompt}
                </div>
                <Row>
                    <input
                        className={styles.inputText}
                        type="text"
                        value={appModel.currentAnswer}
                        onChange={(ev) =>{ appModel.currentAnswer = ev.target.value;}}
                    />   
                    <button onClick={handleAnswerSubmit}>+</button>                    
                </Row>
 
            </div>
        );

    }
}
