import { shouldUseInAppCamera, nextDeviceIndex } from "./cameraSupport";

// ==========================================================================================
// "Take a Photo" opened a FILE BROWSER on a PC.
//
// The button is a file input carrying capture="environment". On a phone that hands over to
// the camera app, which is what it is for. On a desktop the attribute is simply ignored and
// the input behaves as a plain file picker - so the two buttons on the phone screen, "Take a
// Photo" and "Upload a photo", did exactly the same thing on every PC in the room.
// ==========================================================================================
describe("choosing between the in-app camera and the file input", () => {
  it("opens the in-app camera on a PC that has getUserMedia", () => {
    expect(shouldUseInAppCamera(false, true)).toBe(true);
  });

  it("leaves a phone on the file input, which hands over to the real camera app", () => {
    // Better optics handling, orientation and no second permission prompt than anything we
    // can draw ourselves.
    expect(shouldUseInAppCamera(true, true)).toBe(false);
  });

  it("falls back to the file input when there is no getUserMedia at all", () => {
    // Also the insecure-origin case: the API is absent over plain http, and a PC with no
    // camera path at all still has to be able to post a picture.
    expect(shouldUseInAppCamera(false, false)).toBe(false);
    expect(shouldUseInAppCamera(true, false)).toBe(false);
  });
});

describe("walking between a machine's cameras", () => {
  it("cycles back to the first after the last", () => {
    expect(nextDeviceIndex(0, 3)).toBe(1);
    expect(nextDeviceIndex(1, 3)).toBe(2);
    expect(nextDeviceIndex(2, 3)).toBe(0);
  });

  it("stays at zero when there is nothing to switch to", () => {
    // Called unguarded by the switch button, which is hidden in this case anyway.
    expect(nextDeviceIndex(0, 1)).toBe(0);
    expect(nextDeviceIndex(0, 0)).toBe(0);
    expect(nextDeviceIndex(5, 0)).toBe(0);
  });

  it("survives an index that has gone out of range", () => {
    // The device list changes under us when a webcam is unplugged mid-session.
    expect(nextDeviceIndex(9, 2)).toBe(0);
    expect(nextDeviceIndex(-1, 2)).toBe(1);
  });
});
