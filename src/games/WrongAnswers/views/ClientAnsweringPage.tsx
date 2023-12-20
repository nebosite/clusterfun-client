// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Client.module.css"
import { WrongAnswersClientModel } from "../models/ClientModel";
import { Row } from "libs";
import { action, makeObservable, observable } from "mobx";


@observer
export class ClientAnsweringPage  extends React.Component<{appModel?: WrongAnswersClientModel}> {

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>;

        const handleAnswerSubmit = () => {

        }

        const handleNewValue = (ev: React.ChangeEvent<HTMLInputElement>) => {
            console.log(`Setting to ${ev.target.value}`)
            appModel.currentAnswer = ev.target.value;   
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
                        onChange={handleNewValue}
                    />   
                    <button onClick={handleAnswerSubmit}>+</button>                    
                </Row>
 
            </div>
        );

    }
}
