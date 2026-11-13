import { Vector3 } from 'three';

const MIN_RADIUS = 6;
const MAX_RADIUS = 110;
const MIN_PHI = 0.12;
const MAX_PHI = Math.PI - 0.12;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Orbit camera: drag to orbit, wheel or pinch to zoom, plus eased moves
 * between saved views. Reports clicks (a press that did not turn into a drag).
 */
export class OrbitRig {
  constructor(camera, dom, { onClick, onHover, onInteract } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.onClick = onClick;
    this.onHover = onHover;
    this.onInteract = onInteract;
    this.current = { target: new Vector3(), theta: 0, phi: 1, radius: 60 };
    this.goal = { target: new Vector3(), theta: 0, phi: 1, radius: 60 };
    this.tween = null;
    this.radiusScale = 1;
    this.dragging = false;
    this.pointers = new Map();
    this.press = null;
    this.pinch = 0;
    this.bind();
  }

  bind() {
    const dom = this.dom;
    dom.addEventListener('pointerdown', (e) => {
      dom.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.press = { x: e.clientX, y: e.clientY, time: performance.now(), travel: 0 };
      } else {
        this.press = null;
        this.pinch = this.pinchDistance();
      }
      this.onInteract?.();
    });

    dom.addEventListener('pointermove', (e) => {
      const last = this.pointers.get(e.pointerId);
      if (!last) {
        if (e.pointerType === 'mouse') this.onHover?.(e);
        return;
      }
      const dx = e.clientX - last.x;
      const dy = e.clientY - last.y;
      last.x = e.clientX;
      last.y = e.clientY;

      if (this.pointers.size === 1) {
        if (this.press) {
          this.press.travel += Math.abs(dx) + Math.abs(dy);
          if (this.press.travel < 6) return;
        }
        this.cancelTween();
        this.dragging = true;
        const speed = e.pointerType === 'touch' ? 0.0065 : 0.005;
        this.goal.theta -= dx * speed;
        this.goal.phi = clamp(this.goal.phi - dy * speed, MIN_PHI, MAX_PHI);
      } else if (this.pointers.size === 2) {
        const distance = this.pinchDistance();
        if (this.pinch > 0 && distance > 0) {
          this.cancelTween();
          this.dragging = true;
          this.zoomBy(this.pinch / distance);
        }
        this.pinch = distance;
      }
    });

    const release = (e) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const press = this.press;
      if (e.type === 'pointerup' && press && press.travel < 6 && performance.now() - press.time < 600) {
        this.onClick?.(e);
      }
      if (this.pointers.size === 0) {
        this.press = null;
        this.dragging = false;
      }
      this.pinch = this.pointers.size === 2 ? this.pinchDistance() : 0;
    };
    dom.addEventListener('pointerup', release);
    dom.addEventListener('pointercancel', release);

    dom.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const unit = e.deltaMode === 1 ? 16 : 1;
        const strength = e.ctrlKey ? 0.008 : 0.0012; // ctrl+wheel is a trackpad pinch
        this.cancelTween();
        this.zoomBy(Math.exp(e.deltaY * unit * strength));
        this.onInteract?.();
      },
      { passive: false },
    );
  }

  pinchDistance() {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  zoomBy(factor) {
    this.goal.radius = clamp(this.goal.radius * factor, MIN_RADIUS, MAX_RADIUS);
  }

  orbitBy(dTheta, dPhi) {
    this.cancelTween();
    this.goal.theta += dTheta;
    this.goal.phi = clamp(this.goal.phi + dPhi, MIN_PHI, MAX_PHI);
  }

  cancelTween() {
    if (!this.tween) return;
    this.tween = null;
    copyState(this.goal, this.current);
  }

  /** Move to a saved view. duration 0 cuts straight there. */
  setView(view, duration = 1.9) {
    const to = {
      target: new Vector3(...view.target),
      theta: view.theta,
      phi: view.phi,
      radius: clamp(view.radius * this.radiusScale, MIN_RADIUS, MAX_RADIUS),
    };
    if (duration <= 0) {
      this.tween = null;
      copyState(this.current, to);
      copyState(this.goal, to);
      this.apply();
      return;
    }
    const from = { ...this.current, target: this.current.target.clone() };
    // Take the short way round.
    let turn = (to.theta - from.theta) % (Math.PI * 2);
    if (turn > Math.PI) turn -= Math.PI * 2;
    if (turn < -Math.PI) turn += Math.PI * 2;
    to.theta = from.theta + turn;
    const lift = Math.min(12, from.target.distanceTo(to.target) * 0.35 + Math.abs(turn) * 3);
    this.tween = { from, to, t: 0, duration, lift };
  }

  /** Returns true while the camera is still moving. */
  update(dt) {
    const cur = this.current;
    let moving = false;
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const k = ease(tw.t);
      cur.target.lerpVectors(tw.from.target, tw.to.target, k);
      cur.theta = tw.from.theta + (tw.to.theta - tw.from.theta) * k;
      cur.phi = tw.from.phi + (tw.to.phi - tw.from.phi) * k;
      // Pull back a little mid-flight so the move reads as an arc.
      cur.radius = tw.from.radius + (tw.to.radius - tw.from.radius) * k + Math.sin(Math.PI * k) * tw.lift;
      copyState(this.goal, cur);
      this.goal.radius = tw.to.radius;
      if (tw.t >= 1) {
        cur.radius = tw.to.radius;
        this.tween = null;
      }
      moving = true;
    } else {
      const goal = this.goal;
      const a = 1 - Math.exp(-dt * 10);
      const dTheta = goal.theta - cur.theta;
      const dPhi = goal.phi - cur.phi;
      const dRadius = goal.radius - cur.radius;
      moving = Math.abs(dTheta) > 1e-4 || Math.abs(dPhi) > 1e-4 || Math.abs(dRadius) > 1e-3;
      if (moving) {
        cur.theta += dTheta * a;
        cur.phi += dPhi * a;
        cur.radius += dRadius * a;
      } else {
        cur.theta = goal.theta;
        cur.phi = goal.phi;
        cur.radius = goal.radius;
      }
    }
    this.apply();
    return moving;
  }

  apply() {
    const { target, theta, phi, radius } = this.current;
    const s = Math.sin(phi);
    this.camera.position.set(
      target.x + radius * s * Math.sin(theta),
      target.y + radius * Math.cos(phi),
      target.z + radius * s * Math.cos(theta),
    );
    this.camera.lookAt(target);
  }
}

function copyState(to, from) {
  to.target.copy(from.target);
  to.theta = from.theta;
  to.phi = from.phi;
  to.radius = from.radius;
}
