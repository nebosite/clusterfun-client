import { RetroSpectroAnswerCollection } from "games/RetroSpectro/models/PresenterModel";
import { observer } from "mobx-react";
import React from "react";
import { 
    DragElementWrapper, 
    DragPreviewOptions, 
    DragSourceOptions, 
    DropTarget, 
    DropTargetConnector, 
    DropTargetMonitor ,
    DragSourceMonitor,
    DragSource,
    DragSourceConnector
} from "react-dnd";
import AnswerCard from "./AnswerCard";
import styles from './Presenter.module.css';
import { LabelBox } from "libs";

interface AnswercollectionProps {
    context: RetroSpectroAnswerCollection;
    connectDragSource: DragElementWrapper<DragSourceOptions>;
    connectDragPreview: DragElementWrapper<DragPreviewOptions>;
    isDragging: boolean;
    connectDropTarget: DragElementWrapper<any>,
    hovered: boolean
    hoveredOnSelf: boolean
    item: {id: number, item: RetroSpectroAnswerCollection } | unknown
}

// -------------------------------------------------------------------
// 
// -------------------------------------------------------------------
const collectionDragSpec = {
    beginDrag(props: AnswercollectionProps, monitor: DragSourceMonitor, component: AnswerCollection)
    {
        return {id: props.context.id, item: props.context};
    },

    endDrag(props: AnswercollectionProps, monitor: DragSourceMonitor, component: AnswerCollection)
    {

        if(monitor.didDrop()) {
            const target = monitor.getDropResult() as any;
            //console.log(`DropTarget: AnswerCollection Item:${stringify(target.item)}`)
            if(target.type === "spacer")
            {
                target.item?.insertCollection(props.context);   
            }
            else target.item?.handleDrop(props.context);
        }
    },

    //canDrag(props: TaskCardProps, monitor: DragSourceMonitor){},

    isDragging(props: AnswercollectionProps, monitor: DragSourceMonitor)
    {
        return monitor.getItemType() === '*'
            && props.context.id === monitor.getItem<{id: number}>().id;
    }
}

// -------------------------------------------------------------------
// 
// -------------------------------------------------------------------
const collectionDragCollect = (connect: DragSourceConnector, monitor: DragSourceMonitor) => {
    return {
        connectDragSource: connect.dragSource(),
        connectDragPreview: connect.dragPreview(),
        isDragging: monitor.isDragging()
    }
}

// -------------------------------------------------------------------
// 
// -------------------------------------------------------------------
const answerDropSpec = {
    drop(props: AnswercollectionProps, monitor: DropTargetMonitor, component: AnswerCollection)
    {
        console.log(`OVER: AnswerCollection`)

        return monitor.isOver({shallow:true})
            ? {id: props.context.id, item: props.context}
            : undefined;
    } ,  

    //hover(props: AnswercollectionProps, monitor: DropTargetMonitor, component: AnswerCollection){},

    canDrop(props: AnswercollectionProps, monitor: DropTargetMonitor)
    {
        return true;
    }
}

// -------------------------------------------------------------------
// 
// -------------------------------------------------------------------
const answerDropCollect = (connect: DropTargetConnector, monitor: DropTargetMonitor) => {
    return {
        connectDropTarget: connect.dropTarget(),
        hovered: monitor.isOver(),
        hoveredOnSelf: monitor.isOver({shallow: true}),
        item: monitor.getItem()
    }
}


// -------------------------------------------------------------------
// AnswerCollection
// -------------------------------------------------------------------
@observer class AnswerCollection 
    extends React.Component<AnswercollectionProps> {

    // -------------------------------------------------------------------
    // render
    // -------------------------------------------------------------------
    render() {
        const {context, connectDropTarget, connectDragSource, hoveredOnSelf} = this.props;
        const backgroundStyle = hoveredOnSelf ? {background: "rgba(0, 0, 0, 0.1)" } : {}

        return connectDropTarget (
             connectDragSource(
                <div className={styles.answerCollection} style={backgroundStyle}>                   
                    {
                        context.answers.length > 1 
                        ? <LabelBox
                            labelClassName={styles.answerCardTitle}
                            inputClassName={styles.answerCardTitleEdit}
                            text={context.name}
                            onSubmit={(value: string) => { context.name = value; }}

                            />
                        : <div className={styles.answerCollectionHandle} />
                    }
                    <div className={styles.cardAnswerList}>
                        {context.answers.map(c => <AnswerCard context={c} key={c.id} />)}
                    </div>
                </div>
            )
        );

    }
}

export default 
    DragSource('*', collectionDragSpec, collectionDragCollect)( 
        DropTarget('*', answerDropSpec, answerDropCollect) (AnswerCollection)
    )
