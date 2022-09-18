import React from "react"

export default class Row extends React.Component<{className?: string, style?: any}>
{
    render()
    {

        return <div className={this.props.className} style={this.props.style}> 
            {
                React.Children.map(this.props.children, c => {
                    return <div style={{display:"inline-block", whiteSpace: "nowrap"}}>{c}</div>
                })
            }
            </div>
    }
}  
