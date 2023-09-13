import classNames from "classnames";
import { RetroSpectroPresenterModel } from "games/RetroSpectro/models/PresenterModel";
import { inject, observer } from "mobx-react";
import React from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import styles from './Presenter.module.css';
import { Row } from "libs";

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

        const notesSection = () => {
            const discussion = appModel.currentDiscussion;
            if(!discussion) return null;
            return  <div className={styles.discussionNotes}>
                <div>Notes</div>
                <textarea className={styles.discussionNotesInput} 
                    value={discussion.notes}
                    onChange={(e) => discussion.notes = e.target.value} />
                <div>Tasks</div>
                <textarea className={styles.discussionNotesInput} 
                    value={discussion.tasks}
                    onChange={(e) => discussion.tasks = e.target.value} />
            </div>
        }

        const prevOpacity = appModel.hasPrev ? 1.0 : .20;
        const nextOpacity = appModel.hasNext ? 1.0 : .20;

        const showSummary = () => {
            this.setState({summaryVisible: !summaryVisible})     
        }

        let summary = "";
        if(summaryVisible) {
            summary = "Retro Summary " + new Date().toLocaleDateString();
            appModel.answerCollections.forEach(collection => {
                summary += "\n--------------------- " + collection.name + " ---------------------";
                summary += "\nResponses:"
                collection.answers.forEach(answer => {
                    summary += `\n    ${answer.player?.name}: ${answer.text}`
                })
                if(collection.notes?.trim()) {
                    summary += "\n\nNotes: \n" + collection.notes + "\n"
                }
                if(collection.tasks?.trim()) {
                    summary += "\nTasks:"
                    collection.tasks.split("\n").forEach(task => {
                        if(task.trim() !== "") {
                            summary += "\n    [ ] " + task
                        }
                    })
                }
                summary += "\n";
            })
        }

        return (
            <DndProvider backend={HTML5Backend}>
                <div>
                    <div className={styles.summaryBox} style={{opacity: summaryVisible ? 1 : 0, width: summaryVisible ? undefined : "0px" }}>
                        <pre>{summary}</pre>
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
                    <Row>
                        {discussionBox()}
                        {notesSection()}
                    </Row>
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
