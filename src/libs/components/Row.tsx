import React from "react"

export class Row extends React.Component<{className?: string, style?: React.CSSProperties, children: React.ReactNode}>
{
    render()
    {

        return <div className={this.props.className} style={{display: "flex", ...this.props.style}}> 
            {
                React.Children.map(this.props.children, c => {
                    return <div style={{display:"inline-block", whiteSpace: "nowrap"}}>{c}</div>
                })
            }
            </div>
    }
}  
