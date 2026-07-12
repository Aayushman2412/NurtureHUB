import React, { useEffect, useRef, useCallback } from 'react';

/**
 * Unified tutorial player with watch-time tracking.
 *
 * Plays either a YouTube clip (IFrame Player API, honoring start/end seconds)
 * or a plain video file (HTML5 <video>). While the video is actually playing
 * it accumulates watched seconds and reports a "beat" upstream every
 * BEAT_INTERVAL seconds (plus on pause/end/unmount) so the backend can track
 * real watch time and percentage — skipping ahead does not earn watch time.
 */

const BEAT_INTERVAL_SECONDS = 10;

export interface PlayerBeat {
  position_seconds: number;
  watched_delta_seconds: number;
  duration_seconds?: number | null;
}

interface TrackedVideoPlayerProps {
  videoUrl?: string | null;
  youtubeUrl?: string | null;
  startSeconds?: number | null;
  endSeconds?: number | null;
  onBeat: (beat: PlayerBeat) => void;
  onEnded: () => void;
}

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeApiPromise: Promise<any> | null = null;

const loadYouTubeApi = (): Promise<any> => {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT);
      };
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(tag);
    });
  }
  return youtubeApiPromise;
};

export const parseYouTubeId = (url: string): string | null => {
  const patterns = [
    /(?:youtube\.com\/watch\?(?:.*&)?v=)([\w-]{11})/,
    /(?:youtu\.be\/)([\w-]{11})/,
    /(?:youtube\.com\/embed\/)([\w-]{11})/,
    /(?:youtube\.com\/shorts\/)([\w-]{11})/,
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
};

const TrackedVideoPlayer: React.FC<TrackedVideoPlayerProps> = ({
  videoUrl,
  youtubeUrl,
  startSeconds,
  endSeconds,
  onBeat,
  onEnded,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);

  // Tracking accumulators (refs — no re-renders on ticks)
  const accumulatedRef = useRef(0);
  const positionRef = useRef(0);
  const durationRef = useRef<number | null>(null);
  const ticksSinceFlushRef = useRef(0);

  const onBeatRef = useRef(onBeat);
  const onEndedRef = useRef(onEnded);
  onBeatRef.current = onBeat;
  onEndedRef.current = onEnded;

  const youtubeId = youtubeUrl ? parseYouTubeId(youtubeUrl) : null;

  const flush = useCallback(() => {
    if (accumulatedRef.current <= 0) return;
    onBeatRef.current({
      position_seconds: Math.round(positionRef.current * 10) / 10,
      watched_delta_seconds: Math.round(accumulatedRef.current * 10) / 10,
      duration_seconds: durationRef.current,
    });
    accumulatedRef.current = 0;
    ticksSinceFlushRef.current = 0;
  }, []);

  const tick = useCallback((isPlaying: boolean, position: number) => {
    positionRef.current = position;
    if (isPlaying) {
      accumulatedRef.current += 1;
      ticksSinceFlushRef.current += 1;
      if (ticksSinceFlushRef.current >= BEAT_INTERVAL_SECONDS) flush();
    }
  }, [flush]);

  // ── YouTube path ──────────────────────────────────────────
  useEffect(() => {
    if (!youtubeId) return;
    let destroyed = false;
    let interval: number | undefined;

    loadYouTubeApi().then((YT) => {
      if (destroyed || !ytContainerRef.current) return;
      const clipDuration =
        endSeconds && endSeconds > (startSeconds || 0)
          ? endSeconds - (startSeconds || 0)
          : null;

      ytPlayerRef.current = new YT.Player(ytContainerRef.current, {
        videoId: youtubeId,
        width: '100%',
        height: '100%',
        playerVars: {
          start: startSeconds || 0,
          ...(endSeconds ? { end: endSeconds } : {}),
          rel: 0,
          modestbranding: 1,
        },
        events: {
          onReady: (e: any) => {
            durationRef.current = clipDuration ?? e.target.getDuration() ?? null;
          },
          onStateChange: (e: any) => {
            if (e.data === YT.PlayerState.ENDED) {
              flush();
              onEndedRef.current();
            } else if (e.data === YT.PlayerState.PAUSED) {
              flush();
            }
          },
        },
      });

      interval = window.setInterval(() => {
        const player = ytPlayerRef.current;
        if (!player || typeof player.getPlayerState !== 'function') return;
        // getDuration() returns 0 until metadata loads; keep refreshing (bounded by
        // the clip window) so the server learns the real length rather than 0 forever.
        if (!clipDuration && typeof player.getDuration === 'function') {
          const d = player.getDuration();
          if (d && d > 0) durationRef.current = d;
        }
        const playing = player.getPlayerState() === YT.PlayerState.PLAYING;
        const pos = typeof player.getCurrentTime === 'function' ? player.getCurrentTime() : 0;
        tick(playing, pos);
      }, 1000);
    });

    return () => {
      destroyed = true;
      if (interval) window.clearInterval(interval);
      flush();
      if (ytPlayerRef.current?.destroy) {
        ytPlayerRef.current.destroy();
        ytPlayerRef.current = null;
      }
    };
  }, [youtubeId, startSeconds, endSeconds, flush, tick]);

  // ── HTML5 <video> path ────────────────────────────────────
  useEffect(() => {
    if (youtubeId || !videoUrl) return;
    const interval = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      if (Number.isFinite(video.duration) && video.duration > 0) {
        durationRef.current = video.duration;
      }
      tick(!video.paused && !video.ended && !video.seeking, video.currentTime);
    }, 1000);

    return () => {
      window.clearInterval(interval);
      flush();
    };
  }, [youtubeId, videoUrl, flush, tick]);

  if (youtubeId) {
    return (
      <div style={{ width: '100%', height: '100%' }}>
        <div ref={ytContainerRef} style={{ width: '100%', height: '100%' }} />
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      src={videoUrl || undefined}
      controls
      controlsList="nodownload"
      onPause={flush}
      onEnded={() => {
        flush();
        onEnded();
      }}
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      poster="https://images.unsplash.com/photo-1576091160550-2173dba999ef?auto=format&fit=crop&w=1200&q=80"
    />
  );
};

export default TrackedVideoPlayer;
