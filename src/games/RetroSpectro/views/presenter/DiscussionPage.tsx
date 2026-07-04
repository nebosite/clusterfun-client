import classNames from "classnames";
import { RetroSpectroPresenterModel } from "games/RetroSpectro/models/PresenterModel";
import { inject, observer } from "mobx-react";
import React from "react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import styles from "./Presenter.module.css";

// -------------------------------------------------------------------
// DiscussionPage
// -------------------------------------------------------------------
@inject("appModel")
@observer
export class DiscussionPage extends React.Component<{ appModel?: RetroSpectroPresenterModel }> {
  state: { summaryVisible: boolean };

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(props: { appModel?: RetroSpectroPresenterModel }) {
    super(props);

    this.state = { summaryVisible: false };
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    const { summaryVisible } = this.state;
    if (!appModel) return <div>No Data</div>;

    const discussionBox = () => {
      if (!appModel.currentDiscussion) return null;
      return (
        <div className={styles.discussionGroup}>
          {appModel.currentDiscussion.answers.map((a) => (
            <div
              className={classNames(styles.discussionCard, {
                [styles.discussionCardPositive]: a.answerType === "Positive",
                [styles.discussionCardNegative]: a.answerType !== "Positive",
              })}
              key={a.id}
            >
              <div className={styles.discussionCardText}>{a.text}</div>
              <div className={styles.discussionCardAuthor}>{a.player?.name}</div>
            </div>
          ))}
        </div>
      );
    };

    const notesSection = () => {
      const discussion = appModel.currentDiscussion;
      if (!discussion) return null;
      return (
        <div className={styles.discussionNotes}>
          <div className={styles.sectionLabel}>Notes</div>
          <textarea
            className={styles.discussionNotesInput}
            value={discussion.notes}
            onChange={(e) => (discussion.notes = e.target.value)}
          />
          <div className={styles.sectionLabel}>Tasks</div>
          <textarea
            className={styles.discussionNotesInput}
            value={discussion.tasks}
            onChange={(e) => (discussion.tasks = e.target.value)}
          />
        </div>
      );
    };

    const prevOpacity = appModel.hasPrev ? 1.0 : 0.35;
    const nextOpacity = appModel.hasNext ? 1.0 : 0.35;

    const showSummary = () => {
      this.setState({ summaryVisible: !summaryVisible });
    };

    let summary = "";
    if (summaryVisible) {
      summary = "Retro Summary " + new Date().toLocaleDateString();
      appModel.answerCollections.forEach((collection) => {
        summary += "\n--------------------- " + collection.name + " ---------------------";
        summary += "\nResponses:";
        collection.answers.forEach((answer) => {
          summary += `\n    ${answer.player?.name}: ${answer.text}`;
        });
        if (collection.notes?.trim()) {
          summary += "\n\nNotes: \n" + collection.notes + "\n";
        }
        if (collection.tasks?.trim()) {
          summary += "\nTasks:";
          collection.tasks.split("\n").forEach((task) => {
            if (task.trim() !== "") {
              summary += "\n    [ ] " + task;
            }
          });
        }
        summary += "\n";
      });
    }

    return (
      <DndProvider backend={HTML5Backend}>
        <div>
          {summaryVisible ? (
            <div className={styles.summaryBox}>
              <pre>{summary}</pre>
            </div>
          ) : null}

          <div className={styles.discussionHeader}>
            <div className={styles.discussionIntro}>
              <b>Discussion.</b> Submitters, share your thinking. Everyone: what did we learn, and
              is there an action to take?
              <div style={{ marginTop: 8 }}>
                <button
                  className={styles.ghostButton}
                  onClick={() => appModel.goBackToCategorizing()}
                >
                  ← Back to categorizing
                </button>
              </div>
            </div>
            <button className={styles.discussionButton} onClick={() => showSummary()}>
              {summaryVisible ? "Hide summary" : "Show summary"}
            </button>
          </div>

          <div className={styles.discussionMain}>
            {discussionBox()}
            {notesSection()}
          </div>

          <div className={styles.discussionButtonRow}>
            <button
              className={styles.discussionButton}
              style={{ opacity: prevOpacity }}
              onClick={() => appModel.prevDiscussion()}
            >
              ⬅ Prev{appModel.prevName ? " · " + appModel.prevName : ""}
            </button>
            <div className={styles.discussionCategoryLabel}>{appModel.currentDiscussion?.name}</div>
            <button
              className={styles.discussionButton}
              style={{ opacity: nextOpacity }}
              onClick={() => appModel.nextDiscussion()}
            >
              Next{appModel.nextName ? " · " + appModel.nextName : ""} ➡
            </button>
          </div>
        </div>
      </DndProvider>
    );
  }
}
