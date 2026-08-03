import { Vector2, SafeBrowser, Row, Slider } from "libs";
import { action, observable } from "mobx";
import { inject, observer } from "mobx-react";
import React from "react";
import { LetterBlockModel } from "../models/LetterBlockModel";
import { LexibleClientModel } from "../models/ClientModel";
import { LexibleGameEvent } from "../models/PresenterModel";
import LetterBlock from "./LetterBlock";
import styles from "./Client.module.css";

interface ClientGameComponentProps {
  appModel?: LexibleClientModel;
  mouseScale: number;
  clientId: string;
  playerId: string;
}

class GameComponentState {
  @observable private _sliderLocation = new Vector2(0, 0);
  get sliderLocation() {
    return this._sliderLocation;
  }
  set sliderLocation(value) {
    action(() => (this._sliderLocation = value))();
  }
}

const SLIDER_BLOCK_SIZE = 120;
/** The phone's scroll viewport, in the same units - see the Slider below. */
const SLIDER_VIEW_SIZE = 950;
// -------------------------------------------------------------------
// Game Component -  Client play UI
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class LexibleClientGameComponent extends React.Component<ClientGameComponentProps> {
  sliderId: string;
  canClick = true;
  st: GameComponentState;

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(props: ClientGameComponentProps) {
    super(props);
    this.sliderId = props.clientId + "_LexibleSlider";

    props.appModel!.subscribe(LexibleGameEvent.WordAccepted, "game Client", () => {
      SafeBrowser.vibrate([50]);
    });

    this.st = new GameComponentState();
    // Open on the left edge for BOTH teams: both now start there (see
    // models/teamAreas.ts), where team B used to open on the right - which
    // after the board change is the far side of the map from its own squares.
    //
    // Vertically, centre the board and never scroll past its top.  The old
    // half-the-height offset assumed a tall board; now that the host can ask
    // for as few as 8 rows, it scrolled a board that nearly fits clean off the
    // top and left the bottom two thirds of the phone empty.
    const contentHeight = props.appModel!.theGrid.height * SLIDER_BLOCK_SIZE;
    this.st.sliderLocation = new Vector2(
      SLIDER_BLOCK_SIZE,
      Math.min(0, (SLIDER_VIEW_SIZE - contentHeight) / 2),
    );
  }

  // -------------------------------------------------------------------
  // Drag-to-spell.
  //
  // Which it is - spelling or scrolling - is decided once, on touch-down, by
  // the letter under the finger.  A letter you may start a word from spells;
  // anything else falls through to the Slider and pans, exactly as before.
  //
  // The decision has to be made here rather than on the tile, because it works
  // by NOT letting the event reach the Slider: Touchable listens for
  // onMouseDown/onTouchStart on its own container, so stopping propagation on
  // the way up is what keeps the board still while a word is being spelled.
  // -------------------------------------------------------------------
  private selectDragging = false;

  /** The tile under a screen point, via the data-cell attribute on each tile. */
  private blockAtPoint(clientX: number, clientY: number): LetterBlockModel | undefined {
    const { appModel } = this.props;
    if (!appModel) return undefined;
    const element = document.elementFromPoint(clientX, clientY);
    const cellHost = element?.closest("[data-cell]");
    const cell = cellHost?.getAttribute("data-cell");
    if (!cell) return undefined;
    const [x, y] = cell.split(",").map((n) => parseInt(n, 10));
    if (Number.isNaN(x) || Number.isNaN(y)) return undefined;
    return appModel.theGrid.getBlock(new Vector2(x, y)) ?? undefined;
  }

  private pointOf(ev: React.MouseEvent | React.TouchEvent): { x: number; y: number } | undefined {
    if ("touches" in ev) {
      const touch = ev.touches[0];
      return touch ? { x: touch.clientX, y: touch.clientY } : undefined;
    }
    return { x: ev.clientX, y: ev.clientY };
  }

  handleSelectDragStart = (ev: React.MouseEvent | React.TouchEvent) => {
    const { appModel } = this.props;
    if (!appModel) return;
    const point = this.pointOf(ev);
    if (!point) return;
    const block = this.blockAtPoint(point.x, point.y);
    // Not a letter, or not a letter this player may begin on: leave the event
    // alone and let the board scroll.
    if (!block || !appModel.canStartWordAt(block)) return;

    ev.stopPropagation();
    this.selectDragging = true;
    // The tile's own pointerup would toggle the letter straight back off again;
    // the existing click guard is exactly the right tool for that.
    this.canClick = false;
    appModel.dragSelectTo(block, this.props.playerId);

    window.addEventListener("mousemove", this.handleSelectDragMove);
    window.addEventListener("touchmove", this.handleSelectDragMove, { passive: false });
    window.addEventListener("mouseup", this.handleSelectDragEnd);
    window.addEventListener("touchend", this.handleSelectDragEnd);
    window.addEventListener("touchcancel", this.handleSelectDragEnd);
  };

  private handleSelectDragMove = (ev: MouseEvent | TouchEvent) => {
    const { appModel } = this.props;
    if (!this.selectDragging || !appModel) return;
    const source = "touches" in ev ? ev.touches[0] : ev;
    if (!source) return;
    // Stops the page itself from scrolling under the finger on a phone.
    if (ev.cancelable) ev.preventDefault();
    const block = this.blockAtPoint(source.clientX, source.clientY);
    if (block) appModel.dragSelectTo(block, this.props.playerId);
  };

  private handleSelectDragEnd = () => {
    this.selectDragging = false;
    window.removeEventListener("mousemove", this.handleSelectDragMove);
    window.removeEventListener("touchmove", this.handleSelectDragMove);
    window.removeEventListener("mouseup", this.handleSelectDragEnd);
    window.removeEventListener("touchend", this.handleSelectDragEnd);
    window.removeEventListener("touchcancel", this.handleSelectDragEnd);
    // Match the pan guard's delay so the tile's own pointerup, which fires
    // right after this, does not undo the last letter.
    setTimeout(() => (this.canClick = true), 50);
  };

  componentWillUnmount() {
    this.handleSelectDragEnd();
  }

  // -------------------------------------------------------------------
  // renderLetterGrid
  // -------------------------------------------------------------------
  renderLetterGrid() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    const handleClick = (block: LetterBlockModel) => {
      if (this.canClick) {
        appModel.toggleSelect(block, this.props.playerId);
      }
    };

    return (
      <div
        className={styles.letterFrame}
        onMouseDown={this.handleSelectDragStart}
        onTouchStart={this.handleSelectDragStart}
      >
        {appModel.theGrid.rows.map((r, i) => {
          return (
            <Row className={styles.letterRow} key={i}>
              {r.map((l) => (
                <LetterBlock
                  showBadge={true}
                  key={l.__blockid}
                  context={l}
                  onClick={handleClick}
                  size={SLIDER_BLOCK_SIZE}
                />
              ))}
            </Row>
          );
        })}
      </div>
    );
  }

  // -------------------------------------------------------------------
  // renderSelectedLetters
  // -------------------------------------------------------------------
  renderSelectedLetters() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;

    const handleClick = (block: LetterBlockModel) => {
      block.selectForPlayer(this.props.playerId, !block.isSelectedByPlayer(this.props.playerId));
    };

    return (
      <div className={styles.selectedLetterRow}>
        <Row>
          {appModel.letterChain.map((l) => (
            <LetterBlock key={l.__blockid} context={l} onClick={handleClick} size={90} />
          ))}
        </Row>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // render
  // -------------------------------------------------------------------
  render() {
    const { appModel } = this.props;
    if (!appModel) return <div>NO APP MODEL</div>;
    // TODO: https://www.npmjs.com/package/react-swipe-component

    const onDragStart = () => {
      this.canClick = false;
    };

    const onDragEnd = () => {
      setTimeout(() => (this.canClick = true), 50);
    };

    const onWordSubmitClick = () => {
      appModel.submitWord();
    };

    return (
      <div className={styles.gameComponent}>
        <div style={{ position: "relative" }}>
          <Slider
            className={styles.letterSlider}
            sliderId={this.sliderId}
            width={SLIDER_VIEW_SIZE}
            height={SLIDER_VIEW_SIZE}
            overscroll={0.5}
            startLocation={this.st.sliderLocation}
            contentWidth={appModel.theGrid.width * SLIDER_BLOCK_SIZE}
            contentHeight={appModel.theGrid.height * SLIDER_BLOCK_SIZE}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
          >
            {this.renderLetterGrid()}
          </Slider>
          <div className={styles.sliderOverlay}></div>
        </div>
        {this.renderSelectedLetters()}
        {appModel.letterChain.length > 2 ? (
          <button className={styles.submitButton} onClick={onWordSubmitClick}>
            Submit Word
          </button>
        ) : null}
        <div style={{ margin: "20px" }}>
          {appModel.letterChain.length === 0 ? (
            <div style={{ margin: "60px", textAlign: "center", fontSize: "140%" }}>
              Tap on any letter to begin spelling a word.
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: "20px" }}>Words you can spell from here: </div>
              <div className={styles.hintList}>
                {appModel.wordList.map((w) => (
                  <div className={styles.hintWord} key={w}>
                    {w}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}
