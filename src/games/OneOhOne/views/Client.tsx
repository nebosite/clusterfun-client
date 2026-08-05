import { ONE_OH_ONE_VERSION_HISTORY } from "../models/GameSettings";
// The phone view for 101: one card per piece the player controls, each with
// 1-10 pick buttons and a confirm button.  Plain visuals - awaiting the
// design pass.
import React from "react";
import { observer, inject } from "mobx-react";
import { OneOhOneClientModel, OneOhOneClientState } from "../models/ClientModel";
import styles from "./Client.module.css";
import classNames from "classnames";
import {
  UIProperties,
  GeneralGameState,
  SafeBrowser,
  GeneralClientGameState,
  UINormalizer,
  ErrorBoundary,
  PlayerAvatar,
  ClientHeader,
} from "libs";
import {
  OneOhOneMoveSummary,
  OneOhOneRoundPhase,
  PieceSnapshot,
} from "../models/oneOhOneEndpoints";
import { MIN_GUESS } from "../models/oneOhOneLogic";

// Short summary of what happened to a piece last round
function describeLastMove(move: OneOhOneMoveSummary | PieceSnapshot["lastMove"]): string {
  if (!move) return "";
  if (move.won) return `🏆 Landed on ${move.newPosition}!`;
  if (move.busted) return `Busted — back to 0!`;
  if (move.collidedCount > 0) return `Collision on ${move.guess} — went back ${-move.delta}`;
  return `Moved forward ${move.delta}`;
}

@inject("appModel")
@observer
class PieceCard extends React.Component<{
  appModel?: OneOhOneClientModel;
  piece: PieceSnapshot;
}> {
  render() {
    const { appModel, piece } = this.props;
    const collecting = appModel!.phase === OneOhOneRoundPhase.Collecting;
    const pickable = collecting && !piece.confirmed;
    // The range comes from the host, because it depends on how many pieces are racing.
    const maxGuess = appModel!.maxGuess;
    const buttons = [];
    for (let n = MIN_GUESS; n <= maxGuess; n++) {
      buttons.push(
        <button
          key={n}
          className={classNames(styles.guessButton, {
            [styles.guessSelected]: piece.guess === n,
          })}
          disabled={!pickable}
          onClick={() => appModel!.selectGuess(piece.pieceId, n)}
        >
          {n}
        </button>,
      );
    }

    return (
      <div className={styles.pieceCard}>
        <div className={styles.pieceHeader}>
          <PlayerAvatar avatarId={piece.avatarId} colorIndex={piece.avatarColor} size={36} />
          <span className={styles.pieceName}>{piece.name}</span>
          <span className={styles.piecePosition}>at {piece.position}</span>
        </div>
        <div className={styles.pieceStatus}>
          {collecting
            ? piece.confirmed
              ? `Locked in: ${piece.guess} ✓`
              : // eslint-disable-next-line eqeqeq
                piece.guess != null
                ? `Picked ${piece.guess} — confirm it!`
                : "Pick a number:"
            : describeLastMove(piece.lastMove)}
        </div>
        <div className={styles.guessGrid}>{buttons}</div>
        {collecting ? (
          <button
            className={classNames(styles.confirmButton, {
              [styles.confirmDone]: piece.confirmed,
            })}
            // eslint-disable-next-line eqeqeq
            disabled={!pickable || piece.guess == null}
            onClick={() => appModel!.confirmGuess(piece.pieceId)}
          >
            {piece.confirmed ? "Confirmed ✓" : "Confirm"}
          </button>
        ) : null}
      </div>
    );
  }
}

// Everyone's moves from the last resolved round
@inject("appModel")
@observer
class RoundResults extends React.Component<{ appModel?: OneOhOneClientModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel || appModel.allResults.length === 0) return null;
    const myIds = appModel.myPieces.map((p) => p.pieceId);

    return (
      <div className={styles.resultsList}>
        <div className={styles.resultsTitle}>Round {appModel.roundNumber} results:</div>
        {appModel.allResults.map((result) => (
          <div
            key={result.pieceId}
            className={classNames(styles.resultRow, {
              [styles.resultMine]: myIds.includes(result.pieceId),
              [styles.moveGood]: result.delta > 0,
              [styles.moveBad]: result.delta < 0 || result.busted,
            })}
          >
            <PlayerAvatar avatarId={result.avatarId} colorIndex={result.avatarColor} size={26} />
            <span className={styles.resultName}>{result.name}</span>
            <span className={styles.resultText}>
              {describeLastMove(result)} → {result.newPosition}
            </span>
          </div>
        ))}
      </div>
    );
  }
}

// A pure-CSS celebration for the winning player's phone
class WinCelebration extends React.Component<{ winnerNames: string[] }> {
  render() {
    const confetti = ["🎉", "✨", "🎊", "🥳", "🎉", "✨", "🎊", "⭐"];
    return (
      <div className={styles.celebration}>
        <div className={styles.celebrationTrophy}>🏆</div>
        <div className={styles.celebrationText}>YOU WIN!</div>
        {confetti.map((emoji, i) => (
          <span
            key={i}
            className={styles.confetti}
            style={{ left: `${8 + i * 12}%`, animationDelay: `${i * 0.22}s` }}
          >
            {emoji}
          </span>
        ))}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Client Page
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client extends React.Component<{
  appModel?: OneOhOneClientModel;
  uiProperties: UIProperties;
}> {
  lastState: string = GeneralGameState.Unknown;

  // -------------------------------------------------------------------
  // Vibrate on state changes so players look at their phones
  // -------------------------------------------------------------------
  alertUser() {
    const { appModel } = this.props;
    if (appModel!.gameState !== this.lastState) {
      SafeBrowser.vibrate([50, 50, 50, 50]);
    }
    this.lastState = appModel!.gameState as string;
  }

  // -------------------------------------------------------------------
  // renderSubScreen
  // -------------------------------------------------------------------
  private renderSubScreen() {
    const { appModel } = this.props;

    switch (appModel!.gameState) {
      case GeneralClientGameState.WaitingToStart:
        return (
          <div>
            <div className={styles.wait_text}>
              Sit tight, we are waiting for the host to start the game...
            </div>
            <div className={styles.instructions}>
              <div style={{ fontWeight: 700 }}>How to play:</div>
              <p>Each round, pick a number from 1-10 for every piece you control, then confirm.</p>
              <p>Unique number? Move forward that many spaces.</p>
              <p>Picked the same as someone else? Everyone who matched goes backward!</p>
              <p>
                Land exactly on {appModel!.winPosition} to win — but overshoot past{" "}
                {appModel!.bustLimit} and you restart at 0.
              </p>
            </div>
          </div>
        );
      case OneOhOneClientState.Playing: {
        this.alertUser();
        const collecting = appModel!.phase === OneOhOneRoundPhase.Collecting;
        return (
          <div>
            <div className={styles.roundLabel}>
              Round {appModel!.roundNumber}
              {collecting ? ` — ${appModel!.secondsLeft}s left` : " — results!"}
            </div>
            {appModel!.myPieces.map((piece) => (
              <PieceCard piece={piece} key={piece.pieceId} />
            ))}
            {!collecting ? <RoundResults /> : null}
          </div>
        );
      }
      case GeneralGameState.GameOver:
        return (
          <div>
            {appModel!.iWon ? (
              <WinCelebration winnerNames={appModel!.winnerNames.slice()} />
            ) : (
              <p>
                Game over!{" "}
                {appModel!.winnerNames.length > 0
                  ? `Winner: ${appModel!.winnerNames.join(" & ")}`
                  : ""}
              </p>
            )}
            <div>
              <button onClick={() => this.props.appModel!.quitApp()}>Quit</button>
            </div>
          </div>
        );
      case GeneralClientGameState.JoinError:
        return <p>Could not join the game because: {this.props.appModel!.joinError}</p>;

      default:
        return <div>These are not the droids you are looking for...</div>;
    }
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    return (
      <div>
        <UINormalizer
          uiProperties={this.props.uiProperties}
          virtualHeight={1920}
          virtualWidth={1080}
        >
          <div className={styles.gameclient}>
            <ClientHeader
              className={styles.topbar}
              title="101"
              history={ONE_OH_ONE_VERSION_HISTORY}
              avatarId={appModel?.avatarId ?? 0}
              avatarColor={appModel?.avatarColor}
              avatarSize={40}
              playerName={appModel?.playerName}
              onQuit={() => appModel?.quitApp()}
            />
            <div style={{ margin: "60px" }}>
              <ErrorBoundary>{this.renderSubScreen()}</ErrorBoundary>
            </div>
          </div>
        </UINormalizer>
      </div>
    );
  }
}
