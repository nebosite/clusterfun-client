import { RetroSpectroAnswerCollection } from "games/RetroSpectro/models/PresenterModel";
import { observer } from "mobx-react";
import React from "react";
import { 
    DragElementWrapper, 
    DropTarget, 
    DropTargetConnector, 
    DropTargetMonitor ,
} from "react-dnd";
import styles from './Presenter.module.css';

interface AnswerCollectionSpacerProps {
    context: RetroSpectroAnswerCollection
    connectDropTarget: DragElementWrapper<any>
    hovered: boolean
    hoveredOnSelf: boolean
    item: {id: number, item: RetroSpectroAnswerCollection } | unknown
}

// -------------------------------------------------------------------
// 
// -------------------------------------------------------------------
const answerCollectionSpacerDropSpec = {
    drop(props: AnswerCollectionSpacerProps, monitor: DropTargetMonitor, component: AnswerCollectionSpacer)
    {
        const returnMe = monitor.isOver({shallow:true})
            ? {id: props.context.id, type: "spacer", item: props.context}
            : undefined;

        return returnMe;
    } ,  

    //hover(props: AnswerCollectionSpacerProps, monitor: DropTargetMonitor, component: AnswerCollection){},

    canDrop(props: AnswerCollectionSpacerProps, monitor: DropTargetMonitor)
    {
        return true;
    }
}

// -------------------------------------------------------------------
// 
// -------------------------------------------------------------------
const answerCollectionSpacerDropCollect = (connect: DropTargetConnector, monitor: DropTargetMonitor) => {
    return {
        connectDropTarget: connect.dropTarget(),
        hovered: monitor.isOver(),
        hoveredOnSelf: monitor.isOver({shallow: true}),
        item: monitor.getItem()
    }
}

// -------------------------------------------------------------------
// AnswerCollectionSpacer
// -------------------------------------------------------------------
@observer class AnswerCollectionSpacer 
    extends React.Component<AnswerCollectionSpacerProps> {

    render() {
        const {connectDropTarget, hoveredOnSelf} = this.props;
        const spacerStyle = hoveredOnSelf
        ? {width: "120px"}
        : {width: "10px"}

//        const backgroundStyle = hoveredOnSelf ? {background: "white" } : {}
        return connectDropTarget ( <div className={styles.listSpacer} style={spacerStyle} /> )
    }
}


export default 
        DropTarget('*', answerCollectionSpacerDropSpec, answerCollectionSpacerDropCollect) (AnswerCollectionSpacer)
