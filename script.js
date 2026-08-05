let streamerbotConnected = false;
let tikfinityConnected = false;

let spotifyConnected = false;
let lastPlaybackStatus = -1;
let lastTrackId = null;
let pausedTimeout = null;

// Global sbClient
let sbClient = null;

// DOM elements
const waitingSB = document.getElementById("waiting-streamerbot");
const successSB = document.getElementById("success-streamerbot");

const waitingTF = document.getElementById("waiting-tikfinity");
const successTF = document.getElementById("success-tikfinity");

const waitingSP = document.getElementById("waiting-spotify");
const successSP = document.getElementById("success-spotify");

// -------------------- UI HELPERS --------------------

function showSuccess(source) {
  const map = {
    streamerbot: [waitingSB, successSB],
    tikfinity: [waitingTF, successTF],
    spotify: [waitingSP, successSP]
  };

  const pair = map[source];
  if (!pair) return;

  const [waiting, success] = pair;

  waiting.classList.add("fade-out");
  setTimeout(() => {
    waiting.classList.add("hidden");
    success.classList.remove("hidden", "fade-out");

    setTimeout(() => {
      success.classList.add("fade-out");
    }, 2000);
  }, 500);
}

function updateStatusBoxes() {
  if (!streamerbotConnected) {
    waitingSB.classList.remove("hidden", "fade-out");
    successSB.classList.add("hidden");
  }

  if (!tikfinityConnected) {
    waitingTF.classList.remove("hidden", "fade-out");
    successTF.classList.add("hidden");
  }

  if (!spotifyConnected) {
    waitingSP.classList.remove("hidden", "fade-out");
    successSP.classList.add("hidden");
  }
}

// -------------------- STREAMER.BOT --------------------

function connectStreamerbotClient() {
  sbClient = new StreamerbotClient();

  sbClient.socket.onopen = () => {
    if (!streamerbotConnected) {
      streamerbotConnected = true;
      console.log("✅ Connected to Streamer.Bot");
      showSuccess("streamerbot");
    }
  };

  sbClient.socket.onclose = () => {
    if (streamerbotConnected) {
      console.warn("❌ Disconnected from Streamer.Bot");
    }

    streamerbotConnected = false;
    updateStatusBoxes();
    setTimeout(connectStreamerbotClient, 2000);
  };
}

// -------------------- SPOTIFY --------------------

const SPOTIFY_API = "http://127.0.0.1:5000/now-playing";

async function getPalette(imageUrl) {
    return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = "Anonymous";

        img.onload = () => {
            const thief = new ColorThief();

            const dominant = thief.getColor(img);
            const palette = thief.getPalette(img, 5);

            const rgbToHex = ([r, g, b]) =>
                "#" + [r, g, b]
                    .map(v => v.toString(16).padStart(2, "0"))
                    .join("")
                    .toUpperCase();

            resolve({
                dominant: rgbToHex(dominant),
                palette: palette.map(rgbToHex)
            });
        };

        img.onerror = () =>
            resolve({
                dominant: "#FFFFFF",
                palette: ["#FFFFFF"]
            });

        img.src = imageUrl;
    });
}

async function pollSpotify() {
    try {
        const res = await fetch(SPOTIFY_API);

        if (!res.ok)
            throw new Error(`HTTP ${res.status}`);

        const json = await res.json();

        // Connected / Disconnected
        const connected = json.current_session_id !== null;

        if (connected !== spotifyConnected) {
            spotifyConnected = connected;

            if (connected) {
                console.log("🎵 Spotify connected");

                sbClient.executeCodeTrigger("spotify.connected", {
                    connected: true
                });

                showSuccess("spotify");
            } else {
                console.log("❌ Spotify disconnected");

                // Cancel pending paused event
                if (pausedTimeout) {
                    clearTimeout(pausedTimeout);
                    pausedTimeout = null;
                }

                sbClient.executeCodeTrigger("spotify.disconnected", {
                    connected: false
                });

                lastPlaybackStatus = -1;
                lastTrackId = "";

                updateStatusBoxes();
                return;
            }

            updateStatusBoxes();
        }

        if (!connected || !json.sessions || json.sessions.length === 0)
            return;

        const session = json.sessions[0];
        const media = session.media_properties;
        const playback = session.playback_info;

        // Current Track ID
        const trackId = [
            media.Title ?? "",
            media.Artist ?? "",
            media.AlbumTitle ?? ""
        ]
        .map(v => v.trim().toLowerCase())
        .join("|");

        // =========================
        // Song Changed (Priority)
        // =========================
        if (
            playback.PlaybackStatus === 4 &&
            trackId !== lastTrackId
        ) {

            let thumbnail = media.Thumbnail || "";
            let latestMedia = media;

            // Wait up to 1 second for album art
            for (let i = 0; i < 10 && !thumbnail; i++) {
                await new Promise(r => setTimeout(r, 100));

                try {
                    const retry = await fetch(SPOTIFY_API);
                    if (!retry.ok) continue;

                    const latestJson = await retry.json();
                    if (!latestJson.sessions?.length) continue;

                    latestMedia = latestJson.sessions[0].media_properties;
                    thumbnail = latestMedia.Thumbnail || "";
                } catch (e) {
                    console.error("Retry thumbnail failed:", e);
                }
            }

            const colors = await getPalette(thumbnail);

            sbClient.executeCodeTrigger("spotify.songchange", {
                title: latestMedia.Title,
                artist: latestMedia.Artist,
                album: latestMedia.AlbumTitle,
                thumbnail,

                color: colors.dominant,
                palette: colors.palette,

                playbackStatus: playback.PlaybackStatus,
                source_app_id: session.source_app_id
            });

            lastTrackId = trackId;

            // Prevent this poll from also firing "playing"
            lastPlaybackStatus = playback.PlaybackStatus;
            return;
        }

        // =========================
        // Playback Status
        // =========================
        if (playback.PlaybackStatus !== lastPlaybackStatus) {

            lastPlaybackStatus = playback.PlaybackStatus;

            switch (playback.PlaybackStatus) {

                case 0:
                    sbClient.executeCodeTrigger("spotify.closed", {
                        source: session.source_app_id
                    });
                    break;

                case 1:
                    sbClient.executeCodeTrigger("spotify.opened", {
                        source: session.source_app_id
                    });
                    break;

                case 2:
                    sbClient.executeCodeTrigger("spotify.changing", {
                        source: session.source_app_id
                    });
                    break;

                case 3:
                    sbClient.executeCodeTrigger("spotify.stopped", {
                        source: session.source_app_id
                    });
                    break;

                case 4:

                    // Cancel pending paused event
                    if (pausedTimeout) {
                        clearTimeout(pausedTimeout);
                        pausedTimeout = null;
                    }

                    sbClient.executeCodeTrigger("spotify.playing", {
                        source: session.source_app_id
                    });

                    break;

                case 5:

                    // Delay paused to avoid firing before disconnect
                    if (pausedTimeout) {
                        clearTimeout(pausedTimeout);
                    }

                    pausedTimeout = setTimeout(() => {

                        pausedTimeout = null;

                        // Spotify disconnected while waiting
                        if (!spotifyConnected)
                            return;

                        sbClient.executeCodeTrigger("spotify.paused", {
                            source: session.source_app_id
                        });

                    }, 1200);

                    break;
            }
        }

    } catch (err) {
        console.warn("Spotify API unavailable:", err.message);
    }
}

// -------------------- TIKFINITY --------------------

function connectTikFinity() {
  const port = new URLSearchParams(location.search).get("port") || "21213";
  const socket = new WebSocket(`ws://localhost:${port}`);

  socket.onopen = () => {
    if (!tikfinityConnected) {
      tikfinityConnected = true;
      console.log("✅ Connected to TikFinity");

      sbClient.executeCodeTrigger("tikfinity.connected", { connected: true });
      showSuccess("tikfinity");
    }
  };

  socket.onclose = () => {
    if (tikfinityConnected) {
      console.warn("❌ Disconnected from TikFinity");
      sbClient.executeCodeTrigger("tikfinity.disconnected", { connected: false });
    }

    tikfinityConnected = false;
    updateStatusBoxes();
    setTimeout(connectTikFinity, 2000);
  };

  socket.onerror = err => {
    console.error("TikFinity WebSocket error:", err);
  };

  socket.onmessage = event => {
    try {
      const data = JSON.parse(event.data);

      switch (data.event) {
        case "gift": {
          const gift = data.data;
          if (gift.giftType === 1 && !gift.repeatEnd) return;
          sbClient.executeCodeTrigger("tikfinity.gift", gift);
          break;
        }

        case "follow":
          sbClient.executeCodeTrigger("tikfinity.follow", data.data);
          break;

        case "member":
          sbClient.executeCodeTrigger("tikfinity.member", data.data);
          break;

        case "subscribe":
          sbClient.executeCodeTrigger("tikfinity.subscribe", data.data);
          break;

        case "like":
          sbClient.executeCodeTrigger("tikfinity.like", data.data);
          break;

        case "roomUser":
          sbClient.executeCodeTrigger("tikfinity.room", data.data);
          break;

        case "roomInfo":
          sbClient.executeCodeTrigger("tikfinity.roomInfo", data.data);
          break;

        case "share":
          sbClient.executeCodeTrigger("tikfinity.share", data.data);
          break;

        case "chat":
          sbClient.executeCodeTrigger("tikfinity.chat", data.data);
          break;

        case "envelope":
          sbClient.executeCodeTrigger("tikfinity.envelope", data.data);
          break;

        case "oecLiveShopping":
          sbClient.executeCodeTrigger("tikfinity.oecLiveShopping", data.data);
          break;

        case "roomPin":
          sbClient.executeCodeTrigger("tikfinity.roomPin", data.data);
          break;

        case "pollMessage":
          sbClient.executeCodeTrigger("tikfinity.pollMessage", data.data);
          break;

        case "streamEnd":
          sbClient.executeCodeTrigger("tikfinity.streamEnd", data.data);
          break;

        default:
          break;
      }
    } catch (err) {
      console.error("Failed to process TikFinity event:", err);
    }
  };
}

// -------------------- RUN --------------------

connectStreamerbotClient();
connectTikFinity();

pollSpotify();
setInterval(pollSpotify, 500);