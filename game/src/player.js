// The player controller: mouse-look first-person movement with acceleration, a low
// air-control factor, crouching and a jump, colliding against the world's AABBs.
// Stepped at a fixed rate by main.js, so feel does not depend on the frame rate.
import { collideMove } from './world.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
const RADIUS = 0.35;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.6;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 4.5;
const GRAVITY = 13.5;
const JUMP_VEL = 4.9;

export function createPlayer() {
  return {
    pos: { x: 0, y: 0, z: 29 }, // feet position; y is height above the ground plane
    vel: { x: 0, y: 0, z: 0 },
    yaw: Math.PI,               // facing -z is yaw 0 in three.js; spawn faces the yard
    pitch: 0,
    crouched: false,
    grounded: true,
    speed2D: 0,
    bobPhase: 0,
    bobAmount: 0,
  };
}

export function placeAtSpawn(player, x, z, faceX, faceZ) {
  player.pos.x = x;
  player.pos.z = z;
  player.pos.y = 0;
  player.vel.x = 0;
  player.vel.y = 0;
  player.vel.z = 0;
  player.yaw = Math.atan2(-(faceX - x), -(faceZ - z));
  player.pitch = 0;
  player.crouched = false;
  player.grounded = true;
}

// One fixed step. input is the input.js object; sensitivity in radians per pixel.
export function stepPlayer(player, input, dt, sensitivity) {
  const look = input.takeLook();
  player.yaw -= look.x * sensitivity;
  player.pitch -= look.y * sensitivity;
  const maxPitch = Math.PI / 2 - 0.01;
  player.pitch = Math.max(-maxPitch, Math.min(maxPitch, player.pitch));

  player.crouched = input.down('ControlLeft') || input.down('ControlRight') || input.down('KeyC');
  const axes = input.moveAxes();
  const maxSpeed = player.crouched ? CROUCH_SPEED : WALK_SPEED;

  // Wish direction in world space from yaw.
  const sin = Math.sin(player.yaw);
  const cos = Math.cos(player.yaw);
  let wishX = (-sin * axes.f + cos * axes.s);
  let wishZ = (-cos * axes.f - sin * axes.s);
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1) { wishX /= wishLen; wishZ /= wishLen; }

  const accel = player.grounded ? GROUND_ACCEL : AIR_ACCEL;
  player.vel.x += wishX * accel * dt;
  player.vel.z += wishZ * accel * dt;

  // Ground friction: exponential damp toward the wish speed cap.
  const speed = Math.hypot(player.vel.x, player.vel.z);
  if (player.grounded) {
    const target = wishLen > 0 ? maxSpeed : 0;
    if (speed > target && target >= 0) {
      const damp = Math.pow(0.0001, dt * 1.6);
      const newSpeed = Math.max(target, speed * damp);
      if (speed > 1e-4) {
        player.vel.x *= newSpeed / speed;
        player.vel.z *= newSpeed / speed;
      }
    }
  } else if (speed > WALK_SPEED * 1.05) {
    player.vel.x *= WALK_SPEED * 1.05 / speed;
    player.vel.z *= WALK_SPEED * 1.05 / speed;
  }

  if (player.grounded && input.down('Space') && !player.crouched) {
    player.vel.y = JUMP_VEL;
    player.grounded = false;
  }
  player.vel.y -= GRAVITY * dt;
  player.pos.y += player.vel.y * dt;
  if (player.pos.y <= 0) {
    player.pos.y = 0;
    player.vel.y = 0;
    player.grounded = true;
  }

  const moved = collideMove(player.pos.x, player.pos.z, RADIUS, player.vel.x * dt, player.vel.z * dt);
  player.pos.x = moved.x;
  player.pos.z = moved.z;

  player.speed2D = Math.hypot(player.vel.x, player.vel.z);
  // View bob: advances with distance travelled, eases in and out with speed.
  player.bobPhase += player.speed2D * dt * 1.6;
  const bobTarget = player.grounded ? Math.min(1, player.speed2D / WALK_SPEED) : 0;
  player.bobAmount += (bobTarget - player.bobAmount) * Math.min(1, dt * 8);
}

export function eyeHeight(player) {
  return player.crouched ? EYE_CROUCH : EYE_STAND;
}

// Camera-ready eye position including the bob offset.
export function eyePosition(player, out) {
  const bobY = Math.sin(player.bobPhase * 2) * 0.028 * player.bobAmount;
  out.set(player.pos.x, player.pos.y + eyeHeight(player) + bobY, player.pos.z);
  return out;
}
