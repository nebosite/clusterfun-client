import { observer  } from "mobx-react";
import React from "react";
import { LetterBlockModel } from "../models/LetterBlockModel";
import styles from './LetterBlock.module.css';

export interface LetterBlockProps {
    context: LetterBlockModel
    size?: number
    onClick: (block: LetterBlockModel) => void
    localPlayerId?: string
    showBadge?: boolean
}

@observer
export default class LetterBlock 
extends React.Component<LetterBlockProps> 
{
    // -------------------------------------------------------------------
    // render 
    // -------------------------------------------------------------------
    render() {
        const {context} = this.props;
        const size = this.props.size ?? 40;
        const blockSize = `${size}px`
        let fontSize = `${size * .7}px`
        const borderSize = `${size * .05}px`
        
        const handleClick = () => {
            this.props.onClick(this.props.context);
        }

        const ownershipColor = (context.team === "A" ? "yellow" : "purple")
        const blockStyle:any = {
            width: blockSize,
            height: blockSize,
            background: context.score > 0 
                ? ownershipColor
                : "#00000000",
            padding: `${size * .1}px`
        }
        
        const failHex = Math.floor((1-context.failFade) * 255).toString(16).padStart(2,"0")
        let background = context.failFade > 0
            ? `#FF${failHex}${failHex}`
            : context.score > 0
                ? "#00000080"
                : context.selected ? "cyan" : "#eee"


        const innerStyle:any = {
            borderRadius: `${size * .2}px`,
            borderTop: `#ccc ${borderSize} solid`,
            borderRight: `#444 ${borderSize} solid`,
            borderBottom: `#333 ${borderSize} solid`,
            borderLeft: `#aaa ${borderSize} solid`,
            background
        } 

        if(context.letter.length > 1) {
            fontSize = `${size * .6}px`
        }
        const letterStyle:any = {
            fontSize: fontSize,
            color: context.score > 0 
                ? "#ffffff80"
                : "#333",

        }

        let badgeUI: JSX.Element | null = null
        if(context.score > 0 && this.props.showBadge) {
            const dimension = size * .9;
            const badgeSize = `${dimension * .4}px`
            const badgeFontSize = `${dimension * .35}px`
            const badgeBorderRadius = `${dimension * .2}px`
            const badgeStyle:any = {
                width: badgeSize,
                height: badgeSize,
                fontSize: badgeFontSize,
                borderRadius: badgeBorderRadius,
            }
            badgeUI = <div className={styles.badge} style={badgeStyle}>{context.score}</div>
        }


        return <div className={styles.letterBlock} style={blockStyle} key={context.__blockid}> 
            <div className={styles.letterBlockInner} style={innerStyle} onClick={handleClick}>
                <div className={styles.letterBlockText} style={letterStyle}>
                    {context.letter}
                </div>
            </div>
            { badgeUI }
        </div> 
    } 
}
