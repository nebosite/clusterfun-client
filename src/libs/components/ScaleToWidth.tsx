import React from "react";
import styles from "./ScaleToWidth.module.css";

interface ScaleToWidthProps {
  virtualWidth: number; // the design width the content is authored at
  containerWidth: number; // the viewport width to scale to fill
  containerHeight: number; // the viewport height (the scroll container height)
  // The design height the content is authored at. Used as the floor for fillHeight.
  virtualHeight?: number;
  // Stretch the content to at least the full screen height (never below virtualHeight)
  // and expose that height to children as the CSS var --sw-fill-height, so a flex
  // layout can fill the screen instead of leaving a gap below short content.
  fillHeight?: boolean;
  // Reveal the scrollbar only while the pointer is over the scroll area (hidden
  // otherwise). No reflow — the gutter is only reserved when there is overflow.
  hoverScrollbar?: boolean;
  // Extra class merged onto the scroll container — e.g. to make it transparent so a
  // decorative backdrop rendered behind it shows through the space below content.
  className?: string;
  // Reports the width scale factor (containerWidth / virtualWidth) — e.g. for
  // mapping pointer coordinates into the scaled content. Mirrors UINormalizer.
  onScaleCalc?: (scale: number) => void;
  children: React.ReactNode;
}

// -------------------------------------------------------------------
// ScaleToWidth
//
// Scales authored-width content to FILL the viewport width and lets its height
// flow, scrolling inside one full-viewport container when taller than the screen
// (contrast UINormalizer, which fits BOTH dimensions and letterboxes). A
// transform-scale keeps it browser-robust; we measure the content's natural
// height and reserve `height * scale` so the scroll extent is correct.
//
// With fillHeight the content is grown to at least the full screen height, so a
// flex column can fill the screen (via `min-height: var(--sw-fill-height)`)
// instead of leaving a gap, while still scrolling when content is taller.
// -------------------------------------------------------------------
export class ScaleToWidth extends React.Component<ScaleToWidthProps, { contentHeight: number }> {
  private _content = React.createRef<HTMLDivElement>();
  private _ro: ResizeObserver | undefined;

  constructor(props: ScaleToWidthProps) {
    super(props);
    this.state = { contentHeight: 0 };
  }

  private get scale() {
    return this.props.containerWidth / this.props.virtualWidth;
  }

  componentDidMount() {
    this.measure();
    this.props.onScaleCalc?.(this.scale);
    // Re-measure when content reflows (web fonts finishing, etc.).
    if (typeof ResizeObserver !== "undefined" && this._content.current) {
      this._ro = new ResizeObserver(() => this.measure());
      this._ro.observe(this._content.current);
    }
  }

  componentDidUpdate(prev: ScaleToWidthProps) {
    if (
      prev.containerWidth !== this.props.containerWidth ||
      prev.containerHeight !== this.props.containerHeight
    )
      this.measure();
    if (
      prev.containerWidth !== this.props.containerWidth ||
      prev.virtualWidth !== this.props.virtualWidth
    )
      this.props.onScaleCalc?.(this.scale);
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
    const {
      virtualWidth,
      virtualHeight,
      containerWidth,
      containerHeight,
      fillHeight,
      hoverScrollbar,
      className,
      children,
    } = this.props;
    const scale = containerWidth / virtualWidth;
    const scaledHeight = this.state.contentHeight * scale;
    const fillH = fillHeight ? Math.max(virtualHeight ?? 0, containerHeight / scale) : undefined;

    const scrollClass = [styles.scaleScroll, hoverScrollbar ? styles.hoverScroll : "", className]
      .filter(Boolean)
      .join(" ");

    const contentStyle: React.CSSProperties = {
      position: "absolute",
      top: 0,
      left: 0,
      width: virtualWidth,
      transform: `scale(${scale})`,
      transformOrigin: "top left",
    };
    if (fillH !== undefined) {
      contentStyle.minHeight = fillH;
      // Exposed so children can fill the screen: `min-height: var(--sw-fill-height)`.
      (contentStyle as React.CSSProperties & Record<string, string>)["--sw-fill-height"] =
        `${fillH}px`;
    }

    return (
      <div className={scrollClass} style={{ width: containerWidth, height: containerHeight }}>
        {/* Sizer reserves the scaled height so the scroll extent is right. */}
        <div style={{ position: "relative", height: scaledHeight }}>
          <div ref={this._content} style={contentStyle}>
            {children}
          </div>
        </div>
      </div>
    );
  }
}
