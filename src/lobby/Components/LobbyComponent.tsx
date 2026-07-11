// App Navigation handled here
import React from "react";
import { observer, inject } from "mobx-react";
import { LobbyMode, LobbyModel } from "../models/LobbyModel";
import classNames from "classnames";
import { GLOBALS } from "../../Globals";
import styles from "./LobbyComponent.module.css";
import { UIProperties, UINormalizer } from "libs";
import Logger from "js-logger";
import { GameDescriptor } from "games/lists/GameDescriptor";
import { PartyBurstLogo } from "./PartyBurstLogo";
import { ScaleToWidth } from "./ScaleToWidth";
import { GameThumbnail } from "./GameThumbnail";
import {
  CATEGORIES,
  TILE_PALETTE,
  AVATAR_TONES,
  presentationFor,
  GamePresentation,
} from "../LobbyPresentation";

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
  { selectedAvatar: number; selectedColor: number; nameRemembered: boolean; popped: boolean[] }
> {
  constructor(props: { lobbyModel?: LobbyModel }) {
    super(props);
    this.state = {
      selectedAvatar: 0,
      selectedColor: 1,
      nameRemembered: !!props.lobbyModel?.playerName?.trim(),
      popped: new Array(12).fill(false),
    };
  }

  // 8 neutral, abstract avatar marks. The player's chosen *color* provides
  // the pop, not the shape, so these stay grayscale.
  private renderAvatar(i: number) {
    const tone = AVATAR_TONES[i % AVATAR_TONES.length];
    const cut = "#12121a";
    switch (i) {
      case 0:
        return (
          <svg viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" fill={tone} />
            <circle cx="20" cy="20" r="6" fill={cut} />
          </svg>
        );
      case 1:
        return (
          <svg viewBox="0 0 40 40">
            <rect x="5" y="5" width="30" height="30" rx="8" fill={tone} />
            <circle cx="20" cy="20" r="7" fill={cut} />
          </svg>
        );
      case 2:
        return (
          <svg viewBox="0 0 40 40">
            <polygon points="20,4 36,34 4,34" fill={tone} />
            <circle cx="20" cy="25" r="5" fill={cut} />
          </svg>
        );
      case 3:
        return (
          <svg viewBox="0 0 40 40">
            <polygon points="20,3 37,20 20,37 3,20" fill={tone} />
            <rect x="14" y="14" width="12" height="12" fill={cut} />
          </svg>
        );
      case 4:
        return (
          <svg viewBox="0 0 40 40">
            <circle cx="20" cy="20" r="16" fill={tone} />
            <circle cx="20" cy="20" r="9" fill={cut} />
          </svg>
        );
      case 5:
        return (
          <svg viewBox="0 0 40 40">
            <rect x="6" y="8" width="28" height="10" rx="5" fill={tone} />
            <rect x="6" y="22" width="28" height="10" rx="5" fill={tone} />
          </svg>
        );
      case 6:
        return (
          <svg viewBox="0 0 40 40">
            <circle cx="13" cy="13" r="8" fill={tone} />
            <circle cx="27" cy="13" r="8" fill={tone} />
            <circle cx="13" cy="27" r="8" fill={tone} />
            <circle cx="27" cy="27" r="8" fill={tone} />
          </svg>
        );
      default:
        return (
          <svg viewBox="0 0 40 40">
            <polygon points="20,4 34,12 34,28 20,36 6,28 6,12" fill={tone} />
            <circle cx="20" cy="20" r="6" fill={cut} />
          </svg>
        );
    }
  }

  render() {
    const { lobbyModel } = this.props;

    if (!lobbyModel) return <div>Loading lobby...</div>;

    const handleJoinGameClick = () => {
      Logger.debug("Attempting to join room " + this.props.lobbyModel?.roomId);
      this.props.lobbyModel?.joinGame();
    };

    const code = lobbyModel.roomId;
    const cells = [0, 1, 2, 3];

    return (
      <div className={classNames(styles.root, styles.client)}>
        <div className={styles.glowCyan} />
        <div className={styles.glowMagenta} />

        {lobbyModel.lobbyErrorMessage ? (
          <div className={styles.errorMessage}>{lobbyModel.lobbyErrorMessage}</div>
        ) : null}

        <PartyBurstLogo size={26} fontSize={45} />

        <div className={styles.clientHeading}>
          <span className={styles.clientTitle}>Jump in</span>
          <span className={styles.clientSub}>Grab the code off the big screen</span>
        </div>

        <div className={styles.joinCard}>
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
            {this.state.nameRemembered ? (
              <button
                className={styles.resetLink}
                onClick={() => {
                  lobbyModel.playerName = "";
                  this.setState({ nameRemembered: false });
                }}
              >
                not you?
              </button>
            ) : null}
          </div>

          {/* Avatar */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Pick your avatar</span>
            <div className={styles.avatarGrid}>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                <button
                  key={i}
                  className={classNames(styles.avatarButton, {
                    [styles.avatarSelected]: this.state.selectedAvatar === i,
                  })}
                  onClick={() => this.setState({ selectedAvatar: i })}
                  aria-label={`Avatar ${i + 1}`}
                >
                  {this.renderAvatar(i)}
                </button>
              ))}
            </div>
          </div>

          {/* Color */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>…and a color</span>
            <div className={styles.colorGrid}>
              {TILE_PALETTE.map((color, i) => (
                <button
                  key={color}
                  className={styles.colorSwatch}
                  style={{
                    background: color,
                    ...(this.state.selectedColor === i
                      ? {
                          boxShadow: `0 0 0 3px #08080d, 0 0 0 6px ${color}`,
                          transform: "scale(1.1)",
                        }
                      : {}),
                  }}
                  onClick={() => this.setState({ selectedColor: i })}
                  aria-label={`Color ${i + 1}`}
                />
              ))}
            </div>
          </div>

          {/* Game code */}
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Game code</span>
            <div className={styles.codeField}>
              <div className={styles.codeCells}>
                {cells.map((i) => (
                  <div
                    key={i}
                    className={classNames(styles.codeCell, {
                      [styles.codeCellActive]: i === code.length && code.length < 4,
                    })}
                  >
                    {code[i] ?? ""}
                  </div>
                ))}
              </div>
              <input
                className={styles.codeInput}
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                maxLength={4}
                aria-label="Game code"
                value={code}
                onChange={(ev) => (lobbyModel.roomId = ev.target.value.toUpperCase())}
              />
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
          <span className={styles.fidgetLabel}>Bored? Pop 'em while you wait</span>
          <div className={styles.fidgetGrid}>
            {this.state.popped.map((isPopped, i) => (
              <button
                key={i}
                className={classNames(styles.fidgetBubble, {
                  [styles.fidgetPopped]: isPopped,
                })}
                style={{ background: TILE_PALETTE[i % TILE_PALETTE.length] }}
                onClick={() =>
                  this.setState((s) => {
                    const popped = s.popped.slice();
                    popped[i] = !popped[i];
                    return { popped };
                  })
                }
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
