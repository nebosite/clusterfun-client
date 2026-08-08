// The shared-screen view.  One page component per presenter game state, chosen by
// renderSubScreen().  All observers over the presenter model - they render state; they never
// own it.
import React from "react";
import { observer, inject } from "mobx-react";
import styles from "./Presenter.module.css";
import classNames from "classnames";
import BidBotsAssets from "../assets/Assets";
import { BIDBOTS_VERSION_HISTORY } from "../models/GameSettings";
import {
  MediaHelper,
  UIProperties,
  PresenterGameEvent,
  PresenterGameState,
  GeneralGameState,
  DevUI,
  UINormalizer,
  PlayerAvatar,
  GameVersionTag,
} from "libs";
import {
  BidBotsPresenterModel,
  BidBotsGameState,
  BidBotsAuctionPhase,
  BidBotsGameEvent,
} from "../models/PresenterModel";
import { Fighter } from "../models/bidBotsLogic";
import { ScoreRow } from "../models/bidBotsEndpoints";

// A stable emoji per bot "type" so a bot looks the same everywhere it appears.
const BOT_EMOJI = ["🤖", "👾", "🦾", "🛸", "⚙️", "🔩"];
const botEmoji = (t: number) => BOT_EMOJI[t % BOT_EMOJI.length];

// -------------------------------------------------------------------
// Scoreboard - a live leaderboard the model keeps up to date.
// -------------------------------------------------------------------
const Scoreboard = observer(({ rows }: { rows: ScoreRow[] }) => (
  <div>
    <div className={styles.scoreTitle}>STANDINGS</div>
    {rows.map((r) => (
      <div
        key={r.playerId}
        className={classNames(styles.scoreRow, { [styles.scoreRowDim]: !r.isConnected })}
      >
        <PlayerAvatar avatarId={r.avatarId} colorIndex={r.avatarColor} size={40} />
        <span className={styles.scoreName}>{r.name}</span>
        <span className={styles.scoreBank}>${r.bank}</span>
        <span className={styles.scoreWins}>🏆{r.wins}</span>
      </div>
    ))}
  </div>
));

// -------------------------------------------------------------------
// Gathering
// -------------------------------------------------------------------
@inject("appModel")
@observer
class GatheringPage extends React.Component<{ appModel?: BidBotsPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div className={styles.joinBox}>
        <h1 className={styles.title}>BIDBOTS</h1>
        <p className={styles.subtitle}>
          Auction battle bots. Brawl them. Last squad standing wins.
        </p>
        <p>
          Join at <b>{window.location.host}</b> with room code{" "}
          <span className={styles.joinCode}>{appModel.roomId}</span>
        </p>
        <div className={styles.playerGrid}>
          {appModel.players.map((p) => (
            <div className={styles.nameChip} key={p.playerId}>
              <PlayerAvatar avatarId={p.avatarId} colorIndex={p.avatarColor} size={44} /> {p.name}
            </div>
          ))}
        </div>
        {appModel.players.length < appModel.minPlayers ? (
          <div className={styles.subtitle}>Waiting for at least {appModel.minPlayers} players…</div>
        ) : (
          <button className={styles.startButton} onClick={() => appModel.startGame()}>
            START THE AUCTION!
          </button>
        )}
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Auction
// -------------------------------------------------------------------
@inject("appModel")
@observer
class AuctionPage extends React.Component<{ appModel?: BidBotsPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const bot = appModel.currentBot;
    const phase = appModel.auctionPhase;

    return (
      <div className={styles.auctionWrap}>
        <div className={styles.auctionMain}>
          <div className={styles.progressText}>
            BOT {appModel.currentBotIndex + 1} OF {appModel.fighters.length} · ROUND{" "}
            {appModel.currentRound}
          </div>
          {bot ? (
            <div className={styles.botCard}>
              <div className={styles.botEmoji}>{botEmoji(bot.botType)}</div>
              <div className={styles.botName}>{bot.name}</div>
              <div className={styles.statRow}>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>HP</div>
                  <div className={classNames(styles.statValue, styles.statHp)}>{bot.maxHp}</div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>STRENGTH</div>
                  <div className={classNames(styles.statValue, styles.statStr)}>{bot.str}</div>
                </div>
                <div className={styles.stat}>
                  <div className={styles.statLabel}>DEFENSE</div>
                  <div className={classNames(styles.statValue, styles.statDef)}>{bot.def}</div>
                </div>
              </div>

              {phase === BidBotsAuctionPhase.Revealing ? (
                appModel.lastSoldScrapped ? (
                  <div className={styles.scrapBanner}>💥 SCRAPPED — no takers!</div>
                ) : (
                  <div className={styles.soldBanner}>
                    🔨 SOLD to {appModel.playerName(appModel.lastSoldWinnerId)} for $
                    {appModel.lastSoldPrice}!
                  </div>
                )
              ) : (
                <>
                  <div
                    className={classNames(styles.priceReadout, {
                      [styles.priceFrozen]: phase === BidBotsAuctionPhase.Verifying,
                    })}
                  >
                    ${appModel.displayPrice}
                  </div>
                  {phase === BidBotsAuctionPhase.Verifying && (
                    <div className={styles.suspense}>SOLD… going once… going twice…</div>
                  )}
                </>
              )}
            </div>
          ) : (
            <div className={styles.subtitle}>Preparing the next bot…</div>
          )}
        </div>
        <div className={styles.auctionSide}>
          <Scoreboard rows={appModel.scoreboard.slice()} />
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Battle - arena of every owned bot, brawling to the last standing.
// -------------------------------------------------------------------
@inject("appModel")
@observer
class BattlePage extends React.Component<
  { appModel?: BidBotsPresenterModel },
  { shaking: boolean }
> {
  private _shakeTimer: any = null;
  constructor(props: { appModel?: BidBotsPresenterModel }) {
    super(props);
    this.state = { shaking: false };
    props.appModel?.subscribe(BidBotsGameEvent.BattleHit, "battle shake", () => this.kick());
  }
  componentWillUnmount() {
    if (this._shakeTimer) clearTimeout(this._shakeTimer);
  }
  private kick() {
    if (this._shakeTimer) return; // throttle
    this.setState({ shaking: true });
    this._shakeTimer = setTimeout(() => {
      this.setState({ shaking: false });
      this._shakeTimer = null;
    }, 250);
  }
  private ownerColor(ownerId: string | null): number {
    const row = this.props.appModel?.scoreboard.find((r) => r.playerId === ownerId);
    return row?.avatarColor ?? 0;
  }
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    const fighters: Fighter[] = appModel.ownedFighters;
    return (
      <div className={classNames(styles.battleWrap, { [styles.shake]: this.state.shaking })}>
        <div className={styles.battleTitle}>⚔️ BATTLE! ⚔️</div>
        <div className={styles.arena}>
          {fighters.map((f) => {
            const dead = f.hp <= 0;
            const pct = Math.max(0, Math.round((f.hp / f.maxHp) * 100));
            return (
              <div
                key={f.id}
                className={classNames(styles.fighterCard, {
                  [styles.fighterAlive]: !dead,
                  [styles.fighterDead]: dead,
                })}
              >
                <div className={styles.fighterEmoji}>{botEmoji(f.botType)}</div>
                <div className={styles.fighterName}>{f.name}</div>
                <div className={styles.fighterOwner}>
                  <PlayerAvatar avatarId={0} colorIndex={this.ownerColor(f.ownerId)} size={22} />{" "}
                  {appModel.playerName(f.ownerId)}
                </div>
                {dead ? (
                  <div className={styles.koTag}>💥 K.O.</div>
                ) : (
                  <div className={styles.hpTrack}>
                    <div
                      className={classNames(styles.hpFill, { [styles.hpLow]: pct <= 30 })}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Round result / champion
// -------------------------------------------------------------------
@inject("appModel")
@observer
class ResultPage extends React.Component<{ appModel?: BidBotsPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    if (appModel.gameState === GeneralGameState.GameOver) {
      const champ = appModel.champion;
      return (
        <div className={styles.championWrap}>
          <div className={styles.championEmoji}>🏆</div>
          {champ ? (
            <>
              <div className={styles.winnerBanner}>{champ.name} is the CHAMPION!</div>
              <PlayerAvatar avatarId={champ.avatarId} colorIndex={champ.avatarColor} size={120} />
            </>
          ) : (
            <div className={styles.winnerBanner}>Game over</div>
          )}
          <div style={{ marginTop: 20 }}>
            <Scoreboard rows={appModel.scoreboard.slice()} />
          </div>
          <button
            className={styles.startButton}
            style={{ marginTop: 24 }}
            onClick={() => appModel.playAgain(false)}
          >
            Play again, same players
          </button>
        </div>
      );
    }

    const winnerName = appModel.playerName(appModel.roundWinnerId);
    return (
      <div className={styles.championWrap}>
        <div className={styles.winnerBanner}>
          {winnerName ? `🏆 ${winnerName} wins round ${appModel.currentRound}!` : "Round drawn."}
        </div>
        <Scoreboard rows={appModel.scoreboard.slice()} />
      </div>
    );
  }
}

@inject("appModel")
@observer
class PausedPage extends React.Component<{ appModel?: BidBotsPresenterModel }> {
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div className={styles.joinBox}>
        <p className={styles.subtitle}>{appModel.name} is paused</p>
        <button
          className={styles.button}
          disabled={appModel.players.length < appModel.minPlayers}
          onClick={() => appModel.resumeGame()}
        >
          Resume Game
        </button>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// Presenter shell
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class Presenter extends React.Component<{
  appModel?: BidBotsPresenterModel;
  uiProperties: UIProperties;
}> {
  media: MediaHelper;

  constructor(props: Readonly<{ appModel?: BidBotsPresenterModel; uiProperties: UIProperties }>) {
    super(props);
    const { appModel } = this.props;

    this.media = new MediaHelper();
    for (const soundName in BidBotsAssets.sounds) {
      this.media.loadSound((BidBotsAssets.sounds as any)[soundName]);
    }
    const vol = 1.0;

    appModel?.subscribe(PresenterGameEvent.PlayerJoined, "join sound", () =>
      this.media.playSound(BidBotsAssets.sounds.hello, { volume: vol * 0.25 }),
    );
    appModel?.subscribe(BidBotsGameEvent.BidPlaced, "bid sound", () =>
      this.media.playSound(BidBotsAssets.sounds.ding, { volume: vol * 0.5 }),
    );
    appModel?.subscribe(BidBotsGameEvent.BotSold, "sold sound", () =>
      this.media.playSound(BidBotsAssets.sounds.sold, { volume: vol }),
    );
    let lastHit = 0;
    appModel?.subscribe(BidBotsGameEvent.BattleHit, "hit sound", () => {
      const now = Date.now();
      if (now - lastHit < 220) return; // keep the clangs from stacking
      lastHit = now;
      this.media.playSound(BidBotsAssets.sounds.hit, { volume: vol * 0.35 });
    });
    appModel?.subscribe(BidBotsGameEvent.RoundWon, "round win sound", () =>
      this.media.playSound(BidBotsAssets.sounds.hit, { volume: vol * 0.8 }),
    );
    appModel?.subscribe(BidBotsGameEvent.ChampionAnnounced, "champion sound", () =>
      this.media.playSound(BidBotsAssets.sounds.winner, { volume: vol }),
    );
  }

  private renderSubScreen() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    switch (appModel.gameState) {
      case PresenterGameState.Gathering:
        return <GatheringPage />;
      case BidBotsGameState.Auction:
        return <AuctionPage />;
      case BidBotsGameState.Battle:
        return <BattlePage />;
      case BidBotsGameState.RoundResult:
      case GeneralGameState.GameOver:
        return <ResultPage />;
      case GeneralGameState.Paused:
        return <PausedPage />;
      default:
        return <div>Whoops! No display for this state: {appModel.gameState}</div>;
    }
  }

  private renderFrame() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    return (
      <div className={classNames(styles.divRow)}>
        <button className={styles.button} onClick={() => appModel.quitApp()}>
          Quit
        </button>
        <button
          className={styles.button}
          disabled={appModel.gameState === PresenterGameState.Gathering}
          onClick={() => appModel.pauseGame()}
        >
          Pause
        </button>
        <div className={styles.roomCode}>Room: {appModel.roomId}</div>
        <DevUI context={appModel} children={<div></div>} />
        <div style={{ marginLeft: "auto" }}>
          <GameVersionTag title="BidBots" history={BIDBOTS_VERSION_HISTORY} showChanges />
        </div>
      </div>
    );
  }

  render() {
    return (
      <UINormalizer
        className={styles.gamepresenter}
        uiProperties={this.props.uiProperties}
        virtualHeight={1080}
        virtualWidth={1920}
      >
        <div style={{ padding: "24px 30px" }}>
          {this.renderFrame()}
          <div style={{ marginTop: 20 }}>{this.renderSubScreen()}</div>
        </div>
      </UINormalizer>
    );
  }
}
