let streamerbotConnected = false;
let tikfinityConnected = false;

let spotifyConnected = false;
let lastPlaybackStatus = -1;
let lastTrackId = null;

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

                sbClient.executeCodeTrigger("spotify.disconnected", {
                    connected: false
                });

                lastPlaybackStatus = -1;
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
        const timeline = session.timeline_properties;

        // Playback Status
        if (playback.PlaybackStatus !== lastPlaybackStatus) {
            lastPlaybackStatus = playback.PlaybackStatus;

            switch (playback.PlaybackStatus) {
                case 0:
                    sbClient.executeCodeTrigger("spotify.closed", {
                        source_app_id: session.source_app_id
                    });
                    break;

                case 1:
                    sbClient.executeCodeTrigger("spotify.opened", {
                        source_app_id: session.source_app_id
                    });
                    break;

                case 2:
                    sbClient.executeCodeTrigger("spotify.changing", {
                        source_app_id: session.source_app_id
                    });
                    break;

                case 3:
                    sbClient.executeCodeTrigger("spotify.stopped", {
                        source_app_id: session.source_app_id
                    });
                    break;

                case 4:
                    sbClient.executeCodeTrigger("spotify.playing", {
                        source_app_id: session.source_app_id
                    });
                    break;

                case 5:
                    sbClient.executeCodeTrigger("spotify.paused", {
                        source_app_id: session.source_app_id
                    });
                    break;
            }
        }

        // Song Changed
        const trackId = [
            media.Title ?? "",
            media.Artist ?? "",
            media.AlbumTitle ?? ""
        ]
        .map(v => v.trim().toLowerCase())
        .join("|");

        if (
            playback.PlaybackStatus === 4 &&
            trackId !== lastTrackId
        ) {
            console.log("Song changed:", lastTrackId, "->", trackId);

            sbClient.executeCodeTrigger("spotify.songchange", {
                title: media.Title,
                artist: media.Artist,
                album: media.AlbumTitle,
                albumArtist: media.AlbumArtist,
                thumbnail: media.Thumbnail,
                duration: timeline.EndTime,
                position: timeline.Position,
                playbackStatus: playback.PlaybackStatus,
                shuffle: playback.IsShuffleActive,
                source: session.source_app_id
            });

            lastTrackId = trackId;
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
setInterval(pollSpotify, 1000);