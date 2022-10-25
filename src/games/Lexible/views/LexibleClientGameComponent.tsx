import { SafeBrowser } from "libs/Browser/SafeBrowser";
import Row from "libs/components/Row";
import Slider from "libs/components/Slider";
import { Vector2 } from "libs/types/Vector2";
import { action, observable } from "mobx";
import { inject, observer } from "mobx-react";
import React from "react";
import { LetterBlockModel } from "../models/LetterBlockModel";
import { LexibleClientModel } from "../models/LexibleClientModel";
import { LexibleGameEvent } from "../models/LexiblePresenterModel";
import LetterBlock from "./LetterBlock";
import styles from './LexibleClient.module.css';

interface ClientGameComponentProps {
    appModel?: LexibleClientModel, 
    mouseScale: number,
    clientId: string,
    playerId: string,
}

class GameComponentState {
    @observable private _sliderLocation = new Vector2(0,0);
    get sliderLocation() { return this._sliderLocation}
    set sliderLocation(value) {action(()=> this._sliderLocation = value)()}
}

const SLIDER_BLOCK_SIZE = 120
// -------------------------------------------------------------------
// Game Component -  Client play UI
// -------------------------------------------------------------------
@inject("appModel")
@observer
export default class LexibleClientGameComponent extends React.Component<ClientGameComponentProps> 
{
    sliderId: string
    canClick = true;
    st:GameComponentState 

    // -------------------------------------------------------------------
    // ctor
    // ------------------------------------------------------------------- 
    constructor(props: ClientGameComponentProps)
    {
        super(props);
        this.sliderId = props.clientId + "_LexibleSlider" 

        props.appModel.subscribe(LexibleGameEvent.WordAccepted, "game Client", () => {
            SafeBrowser.vibrate([50])
        })

        this.st = new GameComponentState();
        this.st.sliderLocation = new Vector2(
            props.appModel.myTeam === "A" ? SLIDER_BLOCK_SIZE : (-(props.appModel.theGrid.width-7) * SLIDER_BLOCK_SIZE)
            ,-props.appModel.theGrid.height * SLIDER_BLOCK_SIZE/2)

    }

    // -------------------------------------------------------------------
    // renderLetterGrid
    // ------------------------------------------------------------------- 
    renderLetterGrid() {
        const {appModel} = this.props;  

        const handleClick = (block: LetterBlockModel) => {
            if(this.canClick) {
                block.selectForPlayer(this.props.playerId, !block.isSelectedByPlayer(this.props.playerId))
            }
        }

        return <div className={styles.letterFrame}>
            {
                appModel.theGrid.rows.map((r,i) => {
                    return <Row className={styles.letterRow} key={i}>
                        {
                            r.map(l => 
                                    <LetterBlock 
                                        showBadge={true}
                                        key={l.__blockid} 
                                        context={l} 
                                        onClick={handleClick}
                                        size={SLIDER_BLOCK_SIZE}/>
                            )
                        }
                    </Row> 
                })
            } 
        </div>                      
    }

    // -------------------------------------------------------------------
    // renderSelectedLetters
    // ------------------------------------------------------------------- 
    renderSelectedLetters() {
        const {appModel} = this.props;  

        const handleClick = (block: LetterBlockModel) => {
            block.selectForPlayer(this.props.playerId, !block.isSelectedByPlayer(this.props.playerId))
        }

        return <div className={styles.selectedLetterRow}>
            <Row>
            {
                appModel.letterChain.map(l => (
                    <LetterBlock 
                        key={l.__blockid}
                        context={l} 
                        onClick={handleClick}
                        size={90}/>
                    ))
            } 
            </Row> 
        </div>                      
    }


    // -------------------------------------------------------------------
    // render
    // ------------------------------------------------------------------- 
    render() {
        const {appModel} = this.props;  
        // TODO: https://www.npmjs.com/package/react-swipe-component

        const onDragStart = () => {
            this.canClick = false;
        }

        const onDragEnd = () => {
            setTimeout(()=> this.canClick = true,50);
        }

        const onWordSubmitClick = () => {
            appModel.submitWord();
        }

        return (
            <div className={styles.gameComponent}>
                <div style={{position: "relative"}}>
                    <Slider 
                        className={styles.letterSlider}
                        sliderId={this.sliderId}
                        width={950}
                        height={950}
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
                { appModel.letterChain.length > 2
                    ? <button onClick={onWordSubmitClick}>Submit Word</button>
                    : null
                }
                <div style={{margin: "20px"}}>
                    {
                        appModel.letterChain.length === 0
                        ? <div style={{margin: "60px", textAlign: "center", fontSize: "140%"}}>Tap on any letter to begin spelling a word.</div>
                        : <div>
                            <div style={{marginBottom: "20px"}}>Words you can spell from here: </div>
                            <div  className={styles.hintList}>
                                {appModel.wordList.map(w => <div className={styles.hintWord} key={w}>{w}</div>)}
                            </div>
                        </div>

                    }

                </div>
   
            </div>
        );
    };

}
