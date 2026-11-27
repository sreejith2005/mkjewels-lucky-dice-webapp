// Runs the throw planner off the main thread so the UI never freezes while a roll is prepared.
import { planThrow } from './physics.js';

self.onmessage = (e) => {
  const { id, tray, hand, velocity, power } = e.data;
  let plan = null;
  try { plan = planThrow(tray, hand, velocity, { power }); } catch (err) { plan = null; }
  self.postMessage({ id, plan }, plan ? [plan.frames.buffer] : []);
};
