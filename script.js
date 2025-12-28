let streamerbotConnected = false;
let tikfinityConnected = false;
let spotifyConnected = false;

// Global sbClient
let sbClient = null;

// DOM elements
const waitingSB = document.getElementById("waiting-streamerbot");
const successSB = document.getElementById("success-streamerbot");

const waitingTF = document.getElementById("waiting-tikfinity");
const successTF = document.getElementById("success-tikfinity");

const waitingSP = document.getElementById("waiting-spotify");
const successSP = document.getElementById("success-spotify");

// Show green box and hide red box
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

// Reset layout if disconnected
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

// Streamer.bot setup
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

// TikFinity setup
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

// Spotify (Spicetify) bridge
function connectSpotifyBridge() {
  function waitForSpicetify() {
    if (!window.Spicetify || !Spicetify.Player) {
      setTimeout(waitForSpicetify, 1000);
      return;
    }
    initSpotify();
  }

  let lastTrackUri = "";

  function initSpotify() {
    if (!spotifyConnected) {
      spotifyConnected = true;
      console.log("✅ Connected to Spotify (Spicetify)");
      showSuccess("spotify");

      sbClient.executeCodeTrigger("spotify.connected", { connected: true });
    }

    Spicetify.Player.addEventListener("songchange", () => {
      const state = Spicetify.Player.data;
      if (!state || !state.item) return;

      const track = state.item;
      if (track.uri === lastTrackUri) return;
      lastTrackUri = track.uri;

      sbClient.executeCodeTrigger("spotify.songchange", {
        title: track.name,
        artist: track.artists.map(a => a.name).join(", "),
        album: track.album.name,
        durationMs: track.duration_ms,
        uri: track.uri
      });
    });

    Spicetify.Player.addEventListener("onplaypause", () => {
      sbClient.executeCodeTrigger("spotify.playpause", {
        isPlaying: !Spicetify.Player.data.isPaused
      });
    });
  }

  waitForSpicetify();
}

// Run all
connectStreamerbotClient();
connectTikFinity();
connectSpotifyBridge();
