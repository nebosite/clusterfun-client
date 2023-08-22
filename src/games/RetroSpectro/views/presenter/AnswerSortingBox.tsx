import { RetroSpectroAnswerCollection, RetroSpectroPresenterModel } from "games/RetroSpectro/models/RetroSpectroPresenterModel";
import { observer } from "mobx-react";
import React from "react";
import { 
    DragElementWrapper, 
    DropTarget, 
    DropTargetConnector, 
    DropTargetMonitor ,
} from "react-dnd";
import AnswerCollection from "./AnswerCollection";
import AnswerCollectionSpacer from "./AnswerCollectionSpacer";
import styles from './RetroSpectroPresenter.module.css';

interface AnswerSortingBoxProps {
    context: RetroSpectroPresenterModel
    connectDropTarget: DragElementWrapper<any>
    hovered: boolean
    hoveredOnSelf: boolean
    item: {id: number, item: RetroSpectroAnswerCollection }
}

// -------------------------------------------------------------------
// 
// -------------------------------------------------------------------
const answerSortingBoxDropSpec = {
    drop(props: AnswerSortingBoxProps, monitor: DropTargetMonitor, component: AnswerSortingBox)
    {
        const returnMe = monitor.isOver({shallow:true})
            ? {id: -1, type: "container", item: props.context}
            : undefined;

        return returnMe;
    } ,  

    //hover(props: AnswerSortingBoxProps, monitor: DropTargetMonitor, component: AnswerCollection){},

    canDrop(props: AnswerSortingBoxProps, monitor: DropTargetMonitor)
    {
        return true;
    }
}

// -------------------------------------------------------------------
// 
// -------------------------------------------------------------------
const answerSortingBoxDropCollect = (connect: DropTargetConnector, monitor: DropTargetMonitor) => {
    return {
        connectDropTarget: connect.dropTarget(),
        hovered: monitor.isOver(),
        hoveredOnSelf: monitor.isOver({shallow: true}),
        item: monitor.getItem()
    }
}

// -------------------------------------------------------------------
// AnswerSortingBox
// -------------------------------------------------------------------
@observer class AnswerSortingBox 
    extends React.Component<AnswerSortingBoxProps> {

    render() {
        const {connectDropTarget, context} = this.props;

        return connectDropTarget (   
            <div className={`${styles.sortList}`}>
                {context.answerCollections.map(a => (
                    <div key={a.id} className={styles.basicRow}>
                        <AnswerCollectionSpacer context={a} /> 
                        <AnswerCollection context={a} />
                     </div> ))   
                }
            </div>
        )
    }
}


export default 
        DropTarget('*', answerSortingBoxDropSpec, answerSortingBoxDropCollect) (AnswerSortingBox)
