import Logger from "js-logger";
import { Vector2 } from "libs";
import { action, makeObservable, observable } from "mobx";

export type BlockSelectHandler = (playerId: string, selectedValue: boolean) => void;
export type BlockSelectAuthroizer = (block: LetterBlockModel) => boolean;

let blockIdSeed = Date.now();
export class LetterBlockModel {
  __blockid = blockIdSeed++;
  coordinates: Vector2;

  @observable private _letter: string = "#";
  get letter() {
    return this._letter;
  }
  set letter(value) {
    action(() => (this._letter = value))();
  }

  @observable private _score = 0;
  get score() {
    return this._score;
  }

  @observable selectedMap = observable(new Array<string>());
  get selected() {
    return this.selectedMap.length > 0;
  }

  @observable private _failFade: number = 0;
  get failFade() {
    return this._failFade;
  }
  set failFade(value) {
    action(() => (this._failFade = value))();
  }

  // Is this tile joined to its own team's starting area, walking only through
  // its team's tiles?  A tile that is not is an island: it counts for nothing
  // towards crossing the board.  The presenter outlines the joined region so a
  // gap in the chain is obvious from across the room - see teamAreas.ts.
  @observable private _connectedToLeftEdge = false;
  get connectedToLeftEdge() {
    return this._connectedToLeftEdge;
  }

  // Which SIDES of this tile face out of that region: bit 1 top, 2 right,
  // 4 bottom, 8 left.  Drawing only the outward-facing edges turns a set of
  // squares into one outline around the whole region, rather than a box around
  // every tile - which at this size would read as noise.
  @observable private _homeEdgeMask = 0;
  get homeEdgeMask() {
    return this._homeEdgeMask;
  }

  setHomeConnection(connected: boolean, edgeMask: number) {
    if (this._connectedToLeftEdge === connected && this._homeEdgeMask === edgeMask) return;
    action(() => {
      this._connectedToLeftEdge = connected;
      this._homeEdgeMask = edgeMask;
    })();
  }

  @observable private _onPath = false;
  get onPath() {
    return this._onPath;
  }
  set onPath(value) {
    action(() => {
      this._onPath = value;
    })();
  }

  @observable team: string = "_";

  onSelectedChanged: BlockSelectHandler = () => {
    Logger.warn("WEIRD: Default select action happening");
  };

  // -------------------------------------------------------------------
  // ctor
  // -------------------------------------------------------------------
  constructor(letter: string = "_", coordinates: Vector2 = new Vector2(0, 0)) {
    this.letter = letter;
    this.coordinates = coordinates;
    makeObservable(this);
  }

  // -------------------------------------------------------------------
  // selectForPlayer
  // -------------------------------------------------------------------
  selectForPlayer(playerId: string, value: boolean) {
    action(() => {
      if (value === this.isSelectedByPlayer(playerId)) return;

      if (!value) {
        const index = this.selectedMap.findIndex((i) => i === playerId);
        if (index > -1) this.selectedMap.splice(index, 1);
      } else {
        this.selectedMap.push(playerId);
      }
      this.onSelectedChanged(playerId, value);
    })();
  }

  // -------------------------------------------------------------------
  // isSelectedByPlayer
  // -------------------------------------------------------------------
  isSelectedByPlayer(playerId: string) {
    return this.selectedMap.findIndex((i) => i === playerId) > -1;
  }

  // -------------------------------------------------------------------
  // setScore
  // -------------------------------------------------------------------
  setScore(value: number, team: string) {
    action(() => {
      this._score = value;
      this.team = team;
    })();
  }

  // -------------------------------------------------------------------
  // fail
  // -------------------------------------------------------------------
  fail() {
    const animator = () => {
      action(() => {
        this.failFade *= 0.9;
        if (this.failFade < 0.1) {
          this.failFade = 0;
        } else {
          setTimeout(animator, 30);
        }
      })();
    };
    this.failFade = 1;
    setTimeout(animator, 30);
  }
}
