// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { LobbyMode, LobbyModel } from "../models/LobbyModel";
import classNames from "classnames";
import { GLOBALS } from "../../Globals";
import styles from "./LobbyComponent.module.css";
import {
  AVATAR_COLORS,
  AVATAR_COUNT,
  PlayerAvatar,
  SafeBrowser,
  UIProperties,
  UINormalizer,
} from "libs";
import Logger from "js-logger";
import { GameDescriptor } from "games/lists/GameDescriptor";
import { PartyBurstLogo } from "./PartyBurstLogo";
import { ScaleToWidth } from "./ScaleToWidth";
import { DragScroller } from "./DragScroller";
import { GameThumbnail } from "./GameThumbnail";
import { CATEGORIES, TILE_PALETTE, presentationFor, GamePresentation } from "../LobbyPresentation";

// Every avatar in the sheet, for the picker
const AVATAR_IDS = Array.from({ length: AVATAR_COUNT }, (_, i) => i);

interface DecoratedGame {
  game: GameDescriptor;
  pres: GamePresentation;
}

// -------------------------------------------------------------------
// PresenterComponent — the shared "big screen" (wide viewport):
// logo + a gallery of games to choose from.
// -------------------------------------------------------------------
@inject("lobbyModel")
@observer
class PresenterComponent extends React.Component<
  {
    lobbyModel?: LobbyModel;
    games: GameDescriptor[];
  },
  { activeCategory: string }
> {
  private _urlParams: URLSearchParams = new URLSearchParams(window.location.search);

  constructor(props: { lobbyModel?: LobbyModel; games: GameDescriptor[] }) {
    super(props);
    this.state = { activeCategory: "All" };
    const showParam = this._urlParams.get("show");
    if (showParam)
      showParam.split(",").forEach((p) => props.lobbyModel?.showTags.push(p.toLowerCase()));
  }

  //--------------------------------------------------------------------------------------
  //
  //--------------------------------------------------------------------------------------
  render() {
    const { lobbyModel, games } = this.props;

    if (!lobbyModel) return <div>Loading client...</div>;

    const startGameClick = (gameName: string) => {
      Logger.debug("Attempting to start " + gameName);
      this.props.lobbyModel?.startGame(gameName);
    };

    // Keep the existing tag-based visibility filter (hides debug/beta games
    // unless enabled), then decorate each survivor with presentation data.
    const visible: DecoratedGame[] = games
      .map((game, index) => ({ game, pres: presentationFor(game, index) }))
      .filter(({ game }) => {
        if (game.tags.length === 0) return true;
        return game.tags.some((tag) => lobbyModel.showTags.find((t) => t === tag));
      });

    const featured = visible[0];
    const { activeCategory } = this.state;
    const gridGames =
      activeCategory === "All"
        ? visible
        : visible.filter(({ pres }) => pres.category === activeCategory);

    // Only show category chips that actually have a game behind them (plus the
    // "All" default); hide the empties so we don't advertise sections we don't
    // have games for yet. If nothing but "All" is left, drop the row entirely.
    const presentCategories = new Set(visible.map(({ pres }) => pres.category));
    const shownCategories = CATEGORIES.filter((cat) => cat === "All" || presentCategories.has(cat));

    return (
      <div className={classNames(styles.root, styles.presenter)}>
        <div className={styles.glowCyan} />
        <div className={styles.glowMagenta} />

        {/* Top bar */}
        <div className={styles.presenterTopBar}>
          <PartyBurstLogo size={40} fontSize={60} />
          <div className={styles.topBarRight}>
            <span className={styles.liveBadge}>
              <span className={styles.liveDot} /> live
            </span>
            <span className={styles.dropsNote}>{visible.length} games · new drops weekly</span>
            <span className={styles.joinPill}>join at cluster.fun</span>
          </div>
        </div>

        {/* Featured spotlight */}
        {featured && (
          <div className={styles.spotlight}>
            <GameThumbnail
              kind={featured.pres.thumbKind}
              accent={featured.pres.accent}
              size={172}
            />
            <div className={styles.spotlightBody}>
              <span className={styles.spotlightKicker}>★ Featured tonight</span>
              <span className={styles.spotlightName}>
                {featured.game.displayName ?? featured.game.name}
              </span>
              <span className={styles.spotlightBlurb}>{featured.pres.blurb}</span>
              <div className={styles.spotlightActions}>
                <button
                  className={styles.playNow}
                  onClick={() => startGameClick(featured.game.name)}
                >
                  Play now ▸
                </button>
                <span className={styles.badge}>{featured.pres.players} players</span>
                <span className={styles.badge}>{featured.pres.playTime}</span>
              </div>
            </div>
          </div>
        )}

        {/* Category tabs (only those with games behind them) */}
        {shownCategories.length > 1 && (
          <div className={styles.tabRow}>
            {shownCategories.map((cat) => (
              <button
                key={cat}
                className={classNames(styles.tab, {
                  [styles.tabActive]: cat === activeCategory,
                })}
                onClick={() => this.setState({ activeCategory: cat })}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        {/* Game grid */}
        <ul className={styles.gameGrid}>
          {gridGames.map(({ game, pres }) => (
            <li key={game.name}>
              <div
                className={styles.gameCard}
                onClick={() => startGameClick(game.name)}
                role="button"
                aria-label={`Start ${game.displayName ?? game.name}`}
              >
                <GameThumbnail kind={pres.thumbKind} accent={pres.accent} size={68} />
                <div className={styles.cardBody}>
                  <span className={styles.cardName}>{game.displayName ?? game.name}</span>
                  <span className={styles.cardCategory} style={{ color: pres.accent }}>
                    {pres.category}
                  </span>
                  <span className={styles.cardBlurb}>{pres.blurb}</span>
                  <div className={styles.cardBadges}>
                    <span className={styles.cardBadge}>{pres.players}</span>
                    <span className={styles.cardBadge}>{pres.playTime}</span>
                    {game.tags.indexOf("beta") > -1 ? (
                      <span className={styles.gameTag}>beta</span>
                    ) : null}
                    {game.tags.indexOf("alpha") > -1 ? (
                      <span className={styles.gameTag}>alpha</span>
                    ) : null}
                    {game.tags.indexOf("debug") > -1 ? (
                      <span className={styles.gameTag}>debug</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {/* Footer */}
        <div className={styles.presenterFooter}>
          <button
            className={styles.roomCodeButton}
            onClick={() => (lobbyModel.userChosenMode = LobbyMode.Client)}
          >
            I have a room code
          </button>
          <span className={styles.version}>v{GLOBALS.Version}</span>
        </div>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// GameClientComponent — the phone (tall viewport): enter name + code to
// join, or start a new game as the presenter.
// -------------------------------------------------------------------
@inject("lobbyModel")
@observer
class GameClientComponent extends React.Component<
  { lobbyModel?: LobbyModel },
  { nameRemembered: boolean; popped: boolean[] }
> {
  constructor(props: { lobbyModel?: LobbyModel }) {
    super(props);
    this.state = {
      nameRemembered: !!props.lobbyModel?.playerName?.trim(),
      popped: new Array(12).fill(false),
    };
  }

  render() {
    const { lobbyModel } = this.props;

    if (!lobbyModel) return <div>Loading lobby...</div>;

    const handleJoinGameClick = () => {
      Logger.debug("Attempting to join room " + this.props.lobbyModel?.roomId);
      this.props.lobbyModel?.joinGame();
    };

    return (
      <div className={classNames(styles.root, styles.client)}>
        <div className={styles.glowCyan} />
        <div className={styles.glowMagenta} />

        {lobbyModel.lobbyErrorMessage ? (
          <div className={styles.errorMessage}>
            {lobbyModel.lobbyErrorMessage}
            {/* The details behind a failed join, collapsed.  A join problem
                happens on someone else's phone, once - so the specifics have
                to be reachable there, not only in the server's log. */}
            {lobbyModel.joinDiagnostics ? (
              <details className={styles.diagnostics}>
                <summary>What went wrong?</summary>
                <pre className={styles.diagnosticsBody}>{lobbyModel.joinDiagnosticsText()}</pre>
                <button
                  className={styles.diagnosticsCopy}
                  onClick={() => {
                    const text = lobbyModel.joinDiagnosticsText();
                    navigator.clipboard?.writeText(text).catch(() => {
                      /* clipboard is blocked on some phones - the text is on
                         screen either way, which is the point */
                    });
                  }}
                >
                  Copy details
                </button>
              </details>
            ) : null}
          </div>
        ) : null}

        <PartyBurstLogo size={26} fontSize={45} />

        <div className={styles.joinCard}>
          {/* Room code first - it is the one thing you cannot play without */}
          <RoomCodeField lobbyModel={lobbyModel} />

          {/* Your name */}
          <div className={styles.field}>
            <div className={styles.fieldHead}>
              <span className={styles.fieldLabel}>Your name</span>
              {this.state.nameRemembered ? (
                <span className={styles.welcomeBadge}>welcome back</span>
              ) : null}
            </div>
            <input
              placeholder="Nickname"
              type="text"
              className={styles.textInput}
              value={lobbyModel.playerName}
              onChange={(ev) => (lobbyModel.playerName = ev.target.value)}
            />
          </div>

          {/* Avatar */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Pick your avatar</span>
            <DragScroller className={styles.avatarGrid}>
              {AVATAR_IDS.map((i) => (
                <button
                  key={i}
                  className={classNames(styles.avatarButton, {
                    [styles.avatarSelected]: lobbyModel.avatarId === i,
                  })}
                  onClick={() => (lobbyModel.avatarId = i)}
                  aria-label={`Avatar ${i + 1}`}
                  aria-pressed={lobbyModel.avatarId === i}
                >
                  <PlayerAvatar avatarId={i} colorIndex={lobbyModel.avatarColor} size={88} />
                </button>
              ))}
            </DragScroller>
          </div>

          {/* Color */}
          <div className={styles.field}>
            <div className={styles.colorGrid}>
              {AVATAR_COLORS.map((color, i) => (
                <button
                  key={color}
                  className={styles.colorSwatch}
                  style={{
                    background: color,
                    ...(lobbyModel.avatarColor === i
                      ? {
                          boxShadow: `0 0 0 3px #08080d, 0 0 0 6px ${color}`,
                          transform: "scale(1.1)",
                        }
                      : {}),
                  }}
                  onClick={() => (lobbyModel.avatarColor = i)}
                  aria-label={`Color ${i + 1}`}
                />
              ))}
            </div>
          </div>

          <button
            disabled={!lobbyModel.canJoin}
            className={styles.joinButton}
            onClick={() => handleJoinGameClick()}
          >
            Join game →
          </button>
        </div>

        <div className={styles.orDivider}>or</div>

        <button
          className={styles.hostButton}
          onClick={() => (lobbyModel.userChosenMode = LobbyMode.Presenter)}
        >
          Start a new game
          <span className={styles.hostSub}>Be the presenter on this screen</span>
        </button>

        {/* Fidget toy */}
        <div className={styles.fidget}>
          <div className={styles.fidgetGrid}>
            {this.state.popped.map((isPopped, i) => (
              <button
                key={i}
                className={classNames(styles.fidgetBubble, {
                  [styles.fidgetPopped]: isPopped,
                })}
                style={{ background: TILE_PALETTE[i % TILE_PALETTE.length] }}
                onClick={() => {
                  SafeBrowser.vibrate([12]); // tiny pop
                  this.setState((s) => {
                    const popped = s.popped.slice();
                    popped[i] = !popped[i];
                    return { popped };
                  });
                }}
                aria-label={isPopped ? "Pop back" : "Sink bubble"}
              />
            ))}
          </div>
        </div>

        <span className={styles.clientVersion}>v{GLOBALS.Version}</span>
      </div>
    );
  }
}

// -------------------------------------------------------------------
// RoomCodeField - four big letter boxes over one invisible input.
//
// Tapping ANY box focuses the input and puts the caret there, and the box
// under the caret shows a blinking cursor - so it is obvious that typing
// works, and where it will land.  Without that, the boxes look like
// decoration and people do not realise the keyboard applies to them.
// -------------------------------------------------------------------
class RoomCodeField extends React.Component<{ lobbyModel: LobbyModel }, { caret: number }> {
  private input = React.createRef<HTMLInputElement>();
  state = { caret: -1 }; // -1 = not focused, so no cursor is drawn

  private focusAt = (index: number) => {
    const el = this.input.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    // Never past the end of what has been typed - a caret floating in an
    // empty box you cannot type into yet would be a lie.  A full code can put
    // the caret on the last box, which is where overwriting happens.
    const at = Math.min(index, Math.max(0, Math.min(3, this.props.lobbyModel.roomId.length)));
    this.setState({ caret: at });
  };

  // -------------------------------------------------------------------
  // handleKey - a code box overwrites rather than inserts.  With four
  // characters already there, a plain <input maxLength=4> silently refuses
  // every keystroke, so correcting one letter meant deleting the lot.  Typing
  // now replaces the character under the caret and steps to the next box.
  // -------------------------------------------------------------------
  private handleKey = (ev: React.KeyboardEvent<HTMLInputElement>) => {
    const { lobbyModel } = this.props;
    const code = lobbyModel.roomId;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;

    // OUR caret, not the DOM's.  React resets an input's selection to the end
    // every time the value changes, so the browser's idea of where the caret
    // is bears no relation to the box the player tapped.  The cells own the
    // hit-testing (the input is pointer-events: none), so the component's own
    // caret is the only honest answer.
    const caret = Math.max(0, Math.min(this.state.caret < 0 ? code.length : this.state.caret, 3));

    if (/^[a-zA-Z0-9]$/.test(ev.key)) {
      ev.preventDefault();
      const chars = code.padEnd(4, " ").split("");
      chars[caret] = ev.key.toUpperCase();
      lobbyModel.roomId = chars.join("").trimEnd();
      // Step along, and stop at the last box rather than wrapping
      this.setState({ caret: Math.min(caret + 1, 3) });
      return;
    }

    if (ev.key === "Backspace") {
      ev.preventDefault();
      // Clear the box we are in if it has something, else step back and clear
      const target = code[caret] ? caret : Math.max(0, caret - 1);
      const chars = code.padEnd(4, " ").split("");
      chars[target] = " ";
      lobbyModel.roomId = chars.join("").trimEnd();
      this.setState({ caret: target });
      return;
    }

    if (ev.key === "Delete") {
      ev.preventDefault();
      const chars = code.padEnd(4, " ").split("");
      chars[caret] = " ";
      lobbyModel.roomId = chars.join("").trimEnd();
      this.setState({ caret });
    }
  };

  // Only used to LIGHT the field up on focus - the caret position itself is
  // ours to decide (see handleKey).
  private syncCaret = () => {
    if (this.state.caret < 0) {
      this.setState({ caret: Math.min(this.props.lobbyModel.roomId.length, 3) });
    }
  };

  render() {
    const { lobbyModel } = this.props;
    const code = lobbyModel.roomId;
    const focused = this.state.caret >= 0;

    return (
      <div className={styles.field}>
        <span className={styles.fieldLabel}>Room Code</span>
        <div className={styles.codeField}>
          {/* Taps land on the cells; the input below is only a keyboard sink */}
          <div
            className={styles.codeCells}
            onPointerDown={(ev) => {
              // A tap in the gaps between cells still opens the keyboard
              if (ev.target === ev.currentTarget) {
                ev.preventDefault();
                this.focusAt(lobbyModel.roomId.length);
              }
            }}
          >
            {[0, 1, 2, 3].map((i) => {
              const showCaret = focused && i === Math.min(this.state.caret, code.length);
              return (
                <div
                  key={i}
                  className={classNames(styles.codeCell, {
                    [styles.codeCellActive]: showCaret,
                  })}
                  onPointerDown={(ev) => {
                    // Take the tap ourselves so focus lands where they touched
                    ev.preventDefault();
                    this.focusAt(i);
                  }}
                >
                  {code[i] ?? ""}
                  {showCaret ? <span className={styles.codeCaret} /> : null}
                </div>
              );
            })}
          </div>
          <input
            ref={this.input}
            className={styles.codeInput}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={4}
            aria-label="Room code"
            value={code}
            onKeyDown={this.handleKey}
            onChange={(ev) => {
              // Only reached for input we did not handle ourselves (a paste,
              // or a mobile keyboard that does not raise keydown)
              lobbyModel.roomId = ev.target.value.toUpperCase();
              setTimeout(this.syncCaret, 0);
            }}
            onFocus={this.syncCaret}
            onBlur={() => this.setState({ caret: -1 })}
            onSelect={this.syncCaret}
            onKeyUp={this.syncCaret}
          />
        </div>
      </div>
    );
  }
}

interface LobbyComponentProps {
  lobbyModel?: LobbyModel;
  uiProperties: UIProperties;
  games: GameDescriptor[];
}

// -------------------------------------------------------------------
// LobbyComponent
// -------------------------------------------------------------------
@inject("lobbyModel")
@observer
export class LobbyComponent extends React.Component<LobbyComponentProps> {
  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { lobbyModel, uiProperties, games } = this.props;
    if (!lobbyModel) return <div>NO LOBBY MODEL???</div>;

    const isPortrait = uiProperties.containerHeight > uiProperties.containerWidth;
    let displayMode = lobbyModel.userChosenMode;
    if (displayMode === LobbyMode.Unchosen) {
      displayMode = isPortrait ? LobbyMode.Client : LobbyMode.Presenter;
      lobbyModel.userChosenMode = displayMode;
      if (displayMode === LobbyMode.Client && GLOBALS.IsMobile) {
        setTimeout(() => {
          document.body.style.transform = "scale(1)"; // General
          window.document.documentElement.requestFullscreen();
        }, 300);
      }
    }

    return displayMode === LobbyMode.Presenter ? (
      <ScaleToWidth
        virtualWidth={1920}
        containerWidth={uiProperties.containerWidth}
        containerHeight={uiProperties.containerHeight}
      >
        <PresenterComponent games={games} />
      </ScaleToWidth>
    ) : (
      <UINormalizer uiProperties={uiProperties} virtualWidth={1080} virtualHeight={1920}>
        <GameClientComponent />
      </UINormalizer>
    );
  }
}
