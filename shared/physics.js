// Ship movement shared by the server simulation and the client's local prediction.
// Both sides must run exactly this code so the client's predicted ship matches the
// server's authoritative one.

import { WORLD } from './stats.js';

const DRAG_PER_SEC = 0.45;

/**
 * Advance a ship's rotation, velocity and position by one step.
 * @param {{x:number,y:number,vx:number,vy:number,angle:number}} s mutated in place
 * @param {{thrust?:boolean,reverse?:boolean,left?:boolean,right?:boolean}} inp
 * @param {{turnRate:number,accel:number,maxSpeed:number}} st
 */
export function moveShip(s, inp, st, dt) {
  if (inp.left) s.angle -= st.turnRate * dt;
  if (inp.right) s.angle += st.turnRate * dt;
  if (s.angle > Math.PI) s.angle -= Math.PI * 2;
  else if (s.angle < -Math.PI) s.angle += Math.PI * 2;

  if (inp.thrust) {
    s.vx += Math.cos(s.angle) * st.accel * dt;
    s.vy += Math.sin(s.angle) * st.accel * dt;
  } else if (inp.reverse) {
    s.vx -= Math.cos(s.angle) * st.accel * 0.5 * dt;
    s.vy -= Math.sin(s.angle) * st.accel * 0.5 * dt;
  }
  // Light drag so ships are controllable but still drift.
  const drag = Math.exp(-DRAG_PER_SEC * dt);
  s.vx *= drag; s.vy *= drag;
  const speed = Math.hypot(s.vx, s.vy);
  if (speed > st.maxSpeed) { s.vx *= st.maxSpeed / speed; s.vy *= st.maxSpeed / speed; }
  s.x += s.vx * dt; s.y += s.vy * dt;

  const { width, height } = WORLD;
  if (s.x < 0) s.x += width; else if (s.x >= width) s.x -= width;
  if (s.y < 0) s.y += height; else if (s.y >= height) s.y -= height;
}
