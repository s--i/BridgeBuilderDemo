// Pointer transport only. Selection, snapping and topology belong to Wasm.
class EditorControls {
  constructor(canvas, options) {
    this.canvas = canvas;
    this.options = options;
    this.pan = null;
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', event => this.down(event));
    canvas.addEventListener('pointermove', event => this.move(event));
    canvas.addEventListener('pointerup', event => this.up(event));
    canvas.addEventListener('pointercancel', event => {
      this.up(event);
      if (options.leave) options.leave();
    });
    canvas.addEventListener('pointerleave', () => {
      if (options.leave) options.leave();
    });
    canvas.addEventListener('lostpointercapture', () => { this.pan = null; });
    canvas.addEventListener('contextmenu', event => event.preventDefault());

    const handleWheel = event => {
      const isGameplay = options.isGameplay ? options.isGameplay() : true;
      if (!isGameplay) return;
      event.preventDefault();
      options.zoom(event.deltaY < 0 ? 1.15 : 0.87);
      this.hover(event);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    if (typeof document !== 'undefined') {
      const stage = document.getElementById('game-stage');
      if (stage && stage !== canvas) {
        stage.addEventListener('wheel', handleWheel, { passive: false });
      }
    }

    // Window/document-level tracking for letterbox and screen-edge overrun
    if (typeof window !== 'undefined') {
      window.addEventListener('pointermove', event => {
        if (event.target !== canvas) this.move(event);
      });
      window.addEventListener('pointerup', event => {
        if (event.target !== canvas) this.up(event);
      });
      window.addEventListener('blur', () => {
        this.pan = null;
        if (options.leaveWindow) options.leaveWindow();
        else if (options.leave) options.leave();
      });
    }

    if (typeof document !== 'undefined' && document.addEventListener) {
      document.addEventListener('mouseleave', () => {
        this.pan = null;
        if (options.leaveWindow) options.leaveWindow();
        else if (options.leave) options.leave();
      });
    }
  }

  point(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (640.0 / rect.width),
      y: (event.clientY - rect.top) * (480.0 / rect.height)
    };
  }

  hover(event) {
    const isGameplay = this.options.isGameplay ? this.options.isGameplay() : true;
    const point = this.point(event);
    const world = this.options.world(point.x, point.y);
    if (!isGameplay) return world;
    this.options.hover(world.x, world.y, point.x, point.y, event.buttons || 0);
    return world;
  }

  down(event) {
    const engine = this.options.engine();
    if (!engine || !event.isPrimary) return;
    const isGameplay = this.options.isGameplay ? this.options.isGameplay() : true;
    if (!isGameplay) return;

    event.preventDefault();
    const point = this.point(event);
    if (event.button === 1 || (event.button === 2 && event.shiftKey)) {
      this.pan = { id: event.pointerId, point };
      if (this.canvas.setPointerCapture) {
        try { this.canvas.setPointerCapture(event.pointerId); } catch (_) {}
      }
      return;
    }
    const inCanvas = point.x >= 0 && point.x < 640 && point.y >= 0 && point.y < 480;
    const isEditor = this.options.isEditor ? this.options.isEditor() : !engine.simulationActive;
    if (isEditor && !engine.simulationActive && inCanvas) {
      const world = this.hover(event);
      if (event.button === 0) engine.editorClick(world.x, world.y);
      else if (event.button === 2) engine.editorDeleteAt(world.x, world.y);
      if (this.options.changed) this.options.changed();
    }
  }

  move(event) {
    const isGameplay = this.options.isGameplay ? this.options.isGameplay() : true;
    if (!isGameplay) return;
    if (this.pan && this.pan.id === event.pointerId) {
      const point = this.point(event);
      this.options.pan(point.x - this.pan.point.x, point.y - this.pan.point.y);
      this.pan.point = point;
    }
    this.hover(event);
  }

  up(event) {
    this.hover(event);
    if (!this.pan || this.pan.id !== event.pointerId) return;
    this.pan = null;
    if (this.canvas.hasPointerCapture && this.canvas.hasPointerCapture(event.pointerId)) {
      try { this.canvas.releasePointerCapture(event.pointerId); } catch (_) {}
    }
  }
}
window.EditorControls = EditorControls;
