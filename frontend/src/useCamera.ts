// Live camera preview + sends a small JPEG frame to the backend every 1.5 s.
// The AI only "looks" at the latest frame when it needs to (look_at_camera tool).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

const FRAME_EVERY_MS = 1500;
const FRAME_WIDTH = 768; // enough detail to read brand names and labels

export function useCamera() {
  // The page can show the camera in TWO places (desktop side panel + mobile panel). Every <video>
  // gets the stream, and frames are captured from whichever one is actually playing.
  const videos = useRef(new Set<HTMLVideoElement>());
  const streamRef = useRef<MediaStream | null>(null);
  const attach = (el: HTMLVideoElement) => {
    if (streamRef.current && el.srcObject !== streamRef.current) {
      el.srcObject = streamRef.current;
      el.play().catch(() => {});
    }
  };
  const videoRef = useCallback((el: HTMLVideoElement | null) => {
    // Callback ref: called with the element on mount and null on unmount.
    videos.current.forEach((v) => !v.isConnected && videos.current.delete(v));
    if (el) {
      videos.current.add(el);
      attach(el);
    }
  }, []);
  const [on, setOn] = useState(false);
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setOn(false);
  }, []);

  const start = useCallback(async (mode: 'environment' | 'user' = facing) => {
    setError(null);
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      videos.current.forEach((v) => attach(v));
      setFacing(mode);
      setOn(true);
    } catch (err) {
      setError(
        window.isSecureContext
          ? `Camera blocked: ${(err as Error).message}`
          : 'Camera needs HTTPS. Open the app on localhost or through your tunnel URL.',
      );
      setOn(false);
    }
  }, [facing]);

  const flip = useCallback(() => start(facing === 'environment' ? 'user' : 'environment'), [facing, start]);

  /** Grab the current video frame as a compressed JPEG data URL. */
  const capture = useCallback((): string | null => {
    // Prefer a video that is playing and visible; a hidden one still has frames, so it's the fallback.
    const playing = [...videos.current].filter((v) => v.isConnected && v.videoWidth > 0);
    const video = playing.find((v) => v.offsetParent !== null) ?? playing[0];
    if (!video) {
      // Stream is on but no element has it yet: attach and try again on the next tick.
      videos.current.forEach((v) => attach(v));
      return null;
    }
    const scale = FRAME_WIDTH / video.videoWidth;
    const canvas = document.createElement('canvas');
    canvas.width = FRAME_WIDTH;
    canvas.height = Math.round(video.videoHeight * scale);
    canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.7);
  }, []);

  // Keep the backend's "latest frame" fresh while the camera is on.
  useEffect(() => {
    if (!on) return;
    const id = setInterval(() => {
      const image = capture();
      if (image) api.post('/api/frame', { image }).catch(() => {});
    }, FRAME_EVERY_MS);
    return () => clearInterval(id);
  }, [on, capture]);

  useEffect(() => stop, [stop]);

  return { videoRef, on, start, stop, flip, error, capture };
}

/** Fallback: turn a photo picked from the phone into a small JPEG and send it as the latest frame. */
export async function uploadPhoto(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, FRAME_WIDTH / bitmap.width);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = canvas.toDataURL('image/jpeg', 0.8);
  await api.post('/api/frame', { image, source: 'photo' });
  return image;
}
