import React from "react";

// -------------------------------------------------------------------
// DragScroller - a scroll container you can drag with a finger (or the
// mouse) instead of hunting for a scrollbar.  Used for the avatar picker,
// which is too long to fit on a phone.
//
// A drag that moves more than a few pixels suppresses the click on the
// child underneath, so scrolling past a button doesn't select it.
// -------------------------------------------------------------------
export class DragScroller extends React.Component<{
  className?: string;
  children?: React.ReactNode;
}> {
  private ref = React.createRef<HTMLDivElement>();
  private dragging = false;
  private moved = false;
  private startX = 0;
  private startY = 0;
  private startLeft = 0;
  private startTop = 0;

  private onPointerDown = (e: React.PointerEvent) => {
    const el = this.ref.current;
    if (!el) return;
    this.dragging = true;
    this.moved = false;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.startLeft = el.scrollLeft;
    this.startTop = el.scrollTop;
  };

  private onPointerMove = (e: React.PointerEvent) => {
    const el = this.ref.current;
    if (!el || !this.dragging) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (!this.moved && Math.hypot(dx, dy) > 6) {
      this.moved = true;
      // Take the pointer once we know it's a scroll, not a tap
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
    if (this.moved) {
      el.scrollLeft = this.startLeft - dx;
      el.scrollTop = this.startTop - dy;
    }
  };

  private endDrag = () => {
    this.dragging = false;
  };

  // Swallow the click that ends a drag so it doesn't hit a child button
  private onClickCapture = (e: React.MouseEvent) => {
    if (this.moved) {
      e.preventDefault();
      e.stopPropagation();
      this.moved = false;
    }
  };

  render() {
    return (
      <div
        ref={this.ref}
        className={this.props.className}
        style={{ touchAction: "pan-x pan-y", cursor: "grab" }}
        onPointerDown={this.onPointerDown}
        onPointerMove={this.onPointerMove}
        onPointerUp={this.endDrag}
        onPointerCancel={this.endDrag}
        onClickCapture={this.onClickCapture}
      >
        {this.props.children}
      </div>
    );
  }
}

export default DragScroller;
