// The player's phone view.  One sub-screen per client game state.  Thin - it captures the
// BUY and shows feedback; the presenter owns the auction and the battle.
import React from "react";
import { observer, inject } from "mobx-react";
import { BidBotsClientModel, BidBotsClientState } from "../models/ClientModel";
import { BIDBOTS_VERSION_HISTORY } from "../models/GameSettings";
import styles from "./Client.module.css";
import classNames from "classnames";
import {
  UIProperties,
  GeneralGameState,
  GeneralClientGameState,
  UINormalizer,
  ErrorBoundary,
  PlayerAvatar,
  ClientHeader,
} from "libs";

const BOT_EMOJI = ["🤖", "👾", "🦾", "🛸", "⚙️", "🔩"];
const botEmoji = (t: number) => BOT_EMOJI[t % BOT_EMOJI.length];

// -------------------------------------------------------------------
// Auction - bid on the bot currently up.
// -------------------------------------------------------------------
@inject("appModel")
@observer
class AuctionScreen extends React.Component<{ appModel?: BidBotsClientModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const bot = appModel.currentBot;
    const revealing = appModel.auctionPhase === "revealing";

    return (
      <div>
        <div className={styles.bankRow}>
          <div>
            <div className={styles.bankLabel}>YOUR BANK</div>
            <div className={styles.bankValue}>${appModel.bank}</div>
          </div>
          <div className={styles.winsPill}>🏆 {appModel.myWins}</div>
        </div>

        {bot ? (
          <div className={styles.botBox}>
            <div className={styles.botEmoji}>{botEmoji(bot.botType)}</div>
            <div className={styles.botName}>{bot.name}</div>
            <div className={styles.statRow}>
              <div className={styles.stat}>
                <div className={styles.statLabel}>HP</div>
                <div className={classNames(styles.statValue, styles.statHp)}>{bot.maxHp}</div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>STR</div>
                <div className={classNames(styles.statValue, styles.statStr)}>{bot.str}</div>
              </div>
              <div className={styles.stat}>
                <div className={styles.statLabel}>DEF</div>
                <div className={classNames(styles.statValue, styles.statDef)}>{bot.def}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.spectateNote}>Next bot coming up…</div>
        )}

        {revealing ? (
          appModel.lastSoldWinnerName ? (
            <div className={classNames(styles.soldNote, styles.soldOther)}>
              SOLD to {appModel.lastSoldWinnerName} for ${appModel.lastSoldPrice}
            </div>
          ) : (
            <div className={classNames(styles.soldNote, styles.soldOther)}>💥 SCRAPPED</div>
          )
        ) : appModel.isSpectating ? (
          <div className={styles.spectateNote}>
            You're spectating this round — you'll join the next auction with a fresh $1000.
          </div>
        ) : (
          <>
            <div className={styles.priceBig}>${appModel.displayPrice}</div>
            <button
              className={styles.buyButton}
              disabled={!appModel.canBuy}
              onClick={() => appModel.buy()}
            >
              {appModel.displayPrice > appModel.bank ? "TOO PRICEY" : "BUY!"}
            </button>
            <div className={styles.buyMessage}>{appModel.buyMessage}</div>
          </>
        )}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Battle - my bots' live health bars.
// -------------------------------------------------------------------
@inject("appModel")
@observer
class BattleScreen extends React.Component<{ appModel?: BidBotsClientModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div>
        <div className={styles.battleHead}>⚔️ BATTLE!</div>
        <div className={styles.battleSub}>Watch the big screen!</div>
        {appModel.myBots.length === 0 ? (
          <div className={styles.spectateNote}>No bots in the arena this round. Cheer them on!</div>
        ) : (
          appModel.myBots.map((b) => {
            const dead = b.hp <= 0;
            const pct = Math.max(0, Math.round((b.hp / b.maxHp) * 100));
            return (
              <div key={b.id} className={classNames(styles.myBotRow, { [styles.dead]: dead })}>
                <div className={styles.myBotEmoji}>{botEmoji(b.botType)}</div>
                <div className={styles.myBotInfo}>
                  <div className={styles.myBotName}>{b.name}</div>
                  {dead ? (
                    <div className={styles.koText}>💥 K.O.</div>
                  ) : (
                    <div className={styles.hpTrack}>
                      <div
                        className={classNames(styles.hpFill, { [styles.hpLow]: pct <= 30 })}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Round result
// -------------------------------------------------------------------
@inject("appModel")
@observer
class ResultScreen extends React.Component<{ appModel?: BidBotsClientModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div>
        <div
          className={classNames(styles.resultBig, {
            [styles.resultWin]: appModel.roundWinnerIsMe,
            [styles.resultLose]: !appModel.roundWinnerIsMe,
          })}
        >
          {appModel.roundWinnerIsMe
            ? "🏆 You won the round!"
            : appModel.battleWinnerName
              ? `${appModel.battleWinnerName} won the round`
              : "Round drawn"}
        </div>
        <div className={styles.bankRow} style={{ marginTop: 40 }}>
          <div className={styles.bankLabel}>YOUR WINS</div>
          <div className={styles.winsPill}>
            🏆 {appModel.myWins} / {appModel.winsToWin}
          </div>
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Client shell
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Client extends React.Component<{
  appModel?: BidBotsClientModel;
  uiProperties: UIProperties;
}> {
  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    switch (appModel.gameState) {
      case GeneralClientGameState.WaitingToStart:
        return <div className={styles.waitText}>Waiting for the host to start the auction…</div>;
      case BidBotsClientState.Auction:
        return <AuctionScreen />;
      case BidBotsClientState.Battle:
        return <BattleScreen />;
      case BidBotsClientState.RoundResult:
        return <ResultScreen />;
      case GeneralGameState.GameOver:
        return (
          <div className={styles.resultBig}>
            {appModel.iAmChampion ? (
              <span className={styles.resultWin}>🏆 You are the CHAMPION!</span>
            ) : (
              <span className={styles.resultLose}>
                {appModel.championName ? `${appModel.championName} wins the game` : "Game over"}
              </span>
            )}
            <div style={{ marginTop: 40 }}>
              <button className={styles.buyButton} onClick={() => appModel.quitApp()}>
                Quit
              </button>
            </div>
          </div>
        );
      case GeneralClientGameState.JoinError:
        return <div className={styles.waitText}>Could not join: {appModel.joinError}</div>;
      default:
        return <div className={styles.waitText}>Standby…</div>;
    }
  }

  render() {
    const { appModel } = this.props;
    return (
      <UINormalizer uiProperties={this.props.uiProperties} virtualHeight={1920} virtualWidth={1080}>
        <div className={styles.gameclient}>
          <ClientHeader
            className={styles.topbar}
            title="BidBots"
            history={BIDBOTS_VERSION_HISTORY}
            avatarId={appModel?.avatarId ?? 0}
            avatarColor={appModel?.avatarColor}
            playerName={appModel?.playerName}
            onQuit={() => appModel?.quitApp()}
          />
          <div className={styles.body}>
            <ErrorBoundary>{this.renderSubScreen()}</ErrorBoundary>
          </div>
        </div>
      </UINormalizer>
    );
  }
}
