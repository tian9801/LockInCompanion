function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

const TITLES = [
  "LOCK IN",
  "BACK TO WORK",
  "NO DOOMSCROLLING",
  "FOCUS UP"
];

const DESCRIPTIONS = [
  "Your Canvas assignments are waiting...",
  "That site isn’t on your allowlist. Back to work.",
  "You can do it! Focus up!",
  "Lock back in. Your GPA will thank you."
];
const BADGES = [
  "😡 Focus session active",
  "⏳ Keep studying",
  "📚 Productivity only",
  "🚫 Distraction blocked"
];
const GIFS = [
  "assets/images/angry-emoji-gif.gif",
  "assets/images/skyrim-skeleton-gif.gif"
];

function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function render() {
  const { plantHealth = 100, blockedAttempts = 0, sessionActive = false } =
    await chrome.storage.local.get({
      plantHealth: 100,
      blockedAttempts: 0,
      sessionActive: false
    });

  if (!sessionActive) {
    window.close();
    return;
  }

  document.getElementById("badgeText").textContent = randomFrom(BADGES);
  document.getElementById("titleText").textContent = randomFrom(TITLES);
  document.getElementById("descText").textContent = randomFrom(DESCRIPTIONS);
  document.getElementById("memeGif").src = randomFrom(GIFS);

  const h = clamp(plantHealth, 0, 100);
  document.getElementById("healthFill").style.width = `${h}%`;
  document.getElementById("healthText").textContent = `Discipline meter: ${h}%`;
  document.getElementById("attemptsText").textContent =
    `Blocked attempts this session: ${blockedAttempts}`;
}

// ✅ Close the blocked tab
document.getElementById("closeTab").onclick = () => {
  chrome.tabs.getCurrent(tab => {
    if (tab?.id) {
      chrome.tabs.remove(tab.id);
    }
  });
};

document.getElementById("stopSession").onclick = () => {
  chrome.runtime.sendMessage({ type: "STOP_SESSION" });
};

render();