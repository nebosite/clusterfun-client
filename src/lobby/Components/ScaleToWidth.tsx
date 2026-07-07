import React from "react";
import styles from "./LobbyComponent.module.css";

interface ScaleToWidthProps {
  virtualWidth: number; // the design width the content is authored at
  containerWidth: number; // the viewport width to scale to fill
  containerHeight: number; // the viewport height (the scroll container height)
  children: React.ReactNode;
}

// -------------------------------------------------------------------
// ScaleToWidth
//
// Lobby-local alternative to UINormalizer for the presenter landing page.
// UINormalizer scales the whole design to FIT the viewport (both dimensions),
// so nothing ever overflows and long content has to scroll in an inner box.
// Here we instead scale the design to fill the viewport WIDTH and let its
// natural height flow, so the entire page scrolls inside one full-viewport
// (styled) scroll container. A transform-scale keeps it browser-robust; we
// measure the content's natural height and reserve `height * scale` so the
// scroll extent is correct.
// -------------------------------------------------------------------
export class ScaleToWidth extends React.Component<ScaleToWidthProps, { contentHeight: number }> {
  private _content = React.createRef<HTMLDivElement>();
  private _ro: ResizeObserver | undefined;

  constructor(props: ScaleToWidthProps) {
    super(props);
    this.state = { contentHeight: 0 };
  }

  componentDidMount() {
    this.measure();
    // Re-measure when content reflows (web fonts finishing, etc.).
    if (typeof ResizeObserver !== "undefined" && this._content.current) {
      this._ro = new ResizeObserver(() => this.measure());
      this._ro.observe(this._content.current);
    }
  }

  componentDidUpdate(prev: ScaleToWidthProps) {
    if (prev.containerWidth !== this.props.containerWidth) this.measure();
  }

  componentWillUnmount() {
    this._ro?.disconnect();
  }

  private measure = () => {
    const el = this._content.current;
    if (!el) return;
    const h = el.offsetHeight; // natural (untransformed) height in design px
    if (h !== this.state.contentHeight) this.setState({ contentHeight: h });
  };

  render() {
    const { virtualWidth, containerWidth, containerHeight, children } = this.props;
    const scale = containerWidth / virtualWidth;
    const scaledHeight = this.state.contentHeight * scale;

    return (
      <div
        className={styles.scaleScroll}
        style={{ width: containerWidth, height: containerHeight }}
      >
        {/* Sizer reserves the scaled height so the scroll extent is right. */}
        <div style={{ position: "relative", height: scaledHeight }}>
          <div
            ref={this._content}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: virtualWidth,
              transform: `scale(${scale})`,
              transformOrigin: "top left",
            }}
          >
            {children}
          </div>
        </div>
      </div>
    );
  }
}
