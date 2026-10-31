import {EventDispatcher} from 'three';
// The mini-tool has no XR capability. Keep renderer's lifecycle interface only.
export class WebXRManager extends EventDispatcher {
  enabled = false; isPresenting = false; cameraAutoUpdate = false;
  constructor(..._args: unknown[]) { super(); }
  getSession() { return null; }
  setAnimationLoop(_callback: unknown) {}
  dispose() {}
  getCamera(camera: unknown) { return camera; }
  updateCamera(_camera: unknown) {}
  hasDepthSensing() { return false; }
}
