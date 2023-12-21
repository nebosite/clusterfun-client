// App Navigation handled here
import React from "react";
import { observer } from "mobx-react";
import styles from "./Client.module.css"
import { WrongAnswersClientModel } from "../models/ClientModel";
import { Row } from "libs";


@observer
export class ClientAnsweringPage  extends React.Component<{appModel?: WrongAnswersClientModel}> {

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        if (!appModel) return <div>NO APP MODEL</div>;

        const handleAnswerEntry = () => {
            appModel.enterAnswer();
        }

        const handleNewValue = (ev: React.ChangeEvent<HTMLInputElement>) => {
            appModel.currentAnswer = ev.target.value;   
        }

        const renderAnswer = (text: string, index: number) => {
            const handleEdit = () => { appModel.editAnswer(index); }
            const handlePromote = () => { appModel.promoteAnswer(index); }
            const handleDelete = () => { appModel.deleteAnswer(index); }

            let background = "#ffffff80";
            if(index >= appModel.minAnswers) background = "#00000020"

            return <div className={styles.answerBox}
                        key={index} 
                    >
                        <Row>
                            <div className={styles.answerText} style={{background}}>{text}</div>
                            <button className={styles.answerButton} onClick={handleEdit}>✏</button>
                            <button className={styles.answerButton} onClick={handlePromote}>⭱</button>
                            <button className={styles.answerButton} onClick={handleDelete}>❌</button>
                        </Row>
                    </div>
        }

        return (
            <div>
                <div className={styles.promptPrefix}>
                    Enter at least {appModel.minAnswers} wrong answer{appModel.minAnswers === 1 ? "" : "s"} for: 
                </div>
                <div className={styles.prompt}>
                    {appModel.prompt}
                </div>
                <Row style={{marginBottom: "30px"}}>
                    <input
                        className={styles.inputText}
                        type="text"
                        value={appModel.currentAnswer}
                        onChange={handleNewValue}
                    />   
                    <button 
                        className={styles.answerButton}
                            onClick={handleAnswerEntry}>✚</button>                    
                </Row>
                <div>
                    {appModel.answers.map((a,i) => renderAnswer(a,i))}
                </div>
 
            </div>
        );

    }
}
