import { RetroSpectroAnswer } from "games/RetroSpectro/models/PresenterModel";
import { observer } from "mobx-react";
import React from "react";
import { 
    DragElementWrapper, 
    DragPreviewOptions, 
    DragSource, 
    DragSourceConnector, 
    DragSourceMonitor, 
    DragSourceOptions 
} from "react-dnd";
import styles from './Presenter.module.css';

interface AnswerCardProps {
    context: RetroSpectroAnswer;
    connectDragSource: DragElementWrapper<DragSourceOptions>;
    connectDragPreview: DragElementWrapper<DragPreviewOptions>;
    isDragging: boolean;
    connectDropTarget: DragElementWrapper<any>,
    hovered: boolean
    hoveredOnSelf: boolean
    item: {id: number, item: RetroSpectroAnswer }
}

const answerDragSpec = {
    beginDrag(props: AnswerCardProps, monitor: DragSourceMonitor, component: AnswerCard)
    {
        return {id: props.context.id, item: props.context};
    },

    endDrag(props: AnswerCardProps, monitor: DragSourceMonitor, component: AnswerCard)
    {
        if(monitor.didDrop()) {
            const target = monitor.getDropResult() as any;
            //console.log(`DropTarget: AnswerCard  Item:${stringify(target.item)}`)
            if(target.type === "spacer")
            {
                target.item?.insertCollection(props.context);   
            }
            else target.item?.handleDrop(props.context);
        }
    },

    //canDrag(props: TaskCardProps, monitor: DragSourceMonitor){},

    isDragging(props: AnswerCardProps, monitor: DragSourceMonitor)
    {
        return monitor.getItemType() === '*'
            && props.context.id === monitor.getItem<{id: number}>().id;  
    }
}

const answerDragCollect = (connect: DragSourceConnector, monitor: DragSourceMonitor) => {
    return {
        connectDragSource: connect.dragSource(),
        connectDragPreview: connect.dragPreview(),
        isDragging: monitor.isDragging()
    }
}

// -------------------------------------------------------------------
// AnswerCard
// -------------------------------------------------------------------
@observer class AnswerCard 
    extends React.Component<AnswerCardProps> {

    render() {
        const {context,connectDragSource} = this.props;

        if(!context) return <div>No Context</div>

        return connectDragSource(
            <div className={styles.answerCard}>
                <div className={styles.answerBox} 
                    style={{background: (context.answerType === "Positive" ? "limegreen": "red")}} 
                    key={context.id}>
                    {context.text}
                </div>
            </div>
        );

    }
}

export default  DragSource('*', answerDragSpec, answerDragCollect) (AnswerCard)
