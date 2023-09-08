import classNames from "classnames";
import { RetroSpectroPresenterModel } from "games/RetroSpectro/models/PresenterModel";
import { inject, observer } from "mobx-react";
import React from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import styles from './Presenter.module.css';

// -------------------------------------------------------------------
// DiscussionPage
// -------------------------------------------------------------------
@inject("appModel") 
@observer 
export class DiscussionPage 
    extends React.Component<{appModel?: RetroSpectroPresenterModel}> {

    state: {summaryVisible: boolean}

    // -------------------------------------------------------------------
    // ctor
    // -------------------------------------------------------------------
    constructor(props: {appModel?: RetroSpectroPresenterModel})
    {
        super(props);

        this.state = {summaryVisible: false}
    }

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {appModel} = this.props;
        const {summaryVisible} = this.state;
        if(!appModel) return <div>No Data</div>;

        const discussionBox = () =>
        {
            if(!appModel.currentDiscussion) return null;
            return <div className={styles.discussionGroup}>
                { appModel.currentDiscussion.answers.map(a => (
                    <div className={styles.discussionCard} key={a.id}>
                        <div
                            style={{background: (a.answerType === "Positive" ? "limegreen": "#ff6666")}}>
                            <div className={styles.discussionCardText}>{a.text}</div>
                            <div className={styles.discussionCardAuthor}>({a.player?.name})</div>
                        </div>
                    </div> 
                ))}  
            </div>         
        }

        const prevOpacity = appModel.hasPrev ? 1.0 : .20;
        const nextOpacity = appModel.hasNext ? 1.0 : .20;

        const showSummary = () => {
            this.setState({summaryVisible: !summaryVisible})     
        }

        return (
            <DndProvider backend={HTML5Backend}>
                <div>
                    <div className={styles.summaryBox} style={{opacity: summaryVisible ? 1 : 0, width: summaryVisible ? undefined : "0px" }}>
                        <div>Retro Summary:</div>
                        <ul>
                            {
                                appModel.answerCollections.map(ac =>
                                    {
                                        return (
                                            <li style={{marginLeft: "50px"}}>Category: {ac.name ?? "(none)" }
                                                <ul>
                                                    {ac.answers.map(a => <li key={a.id} style={{marginLeft: "50px"}}>{a.text}</li>)}
                                                </ul>
                                            </li>
                                        )
                                    })
                            }

                        </ul>
                    </div>
                    <div className={styles.divRow}>
                        <div style={{width: "100%"}}>
                            <b>Discussion Time! </b> &nbsp;  Submitters, tell us your thoughts.
                            <br/>Everyone: What have we learned? Is there an action we can take?
                            <button style={{fontSize: "15px"}} onClick={() => appModel.goBackToCategorizing()}>Go back to categorizing</button>
                        </div>
                        <div>
                            <button className={classNames(styles.discussionButton)}  
                                style={{marginLeft:"250px",fontSize:"50%"}}
                                onClick={() => showSummary()}>
                                Show Summary
                            </button>
                        </div>
                    </div>
                    {discussionBox()}
                    <div className={styles.discussionButtonRow}>
                        <button className={classNames(styles.discussionButton)}  
                            style={{opacity: prevOpacity}} 
                            onClick={()=>appModel.prevDiscussion()}>
                                {appModel.prevName + " "}⬅ Prev
                        </button>                       
                        <div className={styles.discussionCategoryLabel}>{appModel.currentDiscussion?.name}</div>
                        <button className={classNames(styles.discussionButton)} 
                            style={{opacity: nextOpacity}}  
                            onClick={()=>appModel.nextDiscussion()}>
                                Next ➡{" " + appModel.nextName}
                        </button>                       
                    </div>

                </div>
            </DndProvider>
        );
    }
}
