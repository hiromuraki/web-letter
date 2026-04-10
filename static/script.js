// 设置日期
document.getElementById("currentDate").innerText = new Date().toLocaleString();

const paper = document.getElementById("paper");
const lcdScreen = document.querySelector(".lcd-screen");
const submitBtn = document.getElementById("submitBtn");
const pwdInput = document.getElementById("pwdInput");
const powerLight = document.getElementById("powerLight");
const paperHeader = document.getElementById("paperHeader");
const pullHint = document.getElementById("pullHint");
const letterAvatar = document.getElementById("letterAvatar");
const letterTitle = document.getElementById("letterTitle");
const paperContent = document.getElementById("paperContent");

let isPrinted = false;
let currentTranslateY = 100; // 初始百分比
let signalFrameIndex = 0;
let hasTransmissionError = false;
let activeMusicAudio = null;
let activeMusicToken = 0;
let signalAnimationToken = 0;
let spectrumAnimationToken = 0;
const signalFrames = ["信号传输 ▇ ▃ ▃", "信号传输 ▅ ▇ ▃", "信号传输 ▃ ▅ ▇", "信号传输 ▃ ▃ ▅"];
const spectrumGlyphs = ["▇", "▃", "▅"];
const requestTimeoutMs = 10000; // 10 秒超时
const musicFadeDurationMs = 1800;
const musicMaxVolume = 0.4;
const musicLoopLeadSeconds = musicFadeDurationMs / 1000 + 0.15;
const spectrumFrameIntervalMs = 180;
const hapticPatterns = {
    confirm: 50,
    success: [30, 50, 30],
    error: [40, 60, 40],
};

function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function triggerHapticFeedback(pattern) {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
        return;
    }

    navigator.vibrate(pattern);
}

function stopSpectrumAnimation() {
    spectrumAnimationToken += 1;
}

function buildSpectrumFrame() {
    const frame = [];

    for (let index = 0; index < 5; index += 1) {
        const randomIndex = Math.floor(Math.random() * spectrumGlyphs.length);
        frame.push(spectrumGlyphs[randomIndex]);
    }

    return frame.join(" ");
}

function renderSpectrumFrame() {
    pwdInput.value = buildSpectrumFrame();
}

async function startSpectrumAnimation() {
    const token = ++spectrumAnimationToken;

    renderSpectrumFrame();

    while (token === spectrumAnimationToken) {
        await sleep(spectrumFrameIntervalMs);

        if (token !== spectrumAnimationToken) {
            return;
        }

        renderSpectrumFrame();
    }
}

function getLetterMusicUrl(letter) {
    if (!letter || typeof letter !== "object") {
        return "";
    }

    const musicUrl = typeof letter.Music === "string" ? letter.Music : letter.music;
    return typeof musicUrl === "string" ? musicUrl.trim() : "";
}

function teardownMusicAudio(audio) {
    if (!audio) {
        return;
    }

    if (audio.__fadeFrameId) {
        window.cancelAnimationFrame(audio.__fadeFrameId);
        audio.__fadeFrameId = null;
    }

    if (audio.__loopHandler) {
        audio.removeEventListener("timeupdate", audio.__loopHandler);
        audio.__loopHandler = null;
    }

    if (audio.__endedHandler) {
        audio.removeEventListener("ended", audio.__endedHandler);
        audio.__endedHandler = null;
    }

    audio.__loopTransitioning = false;
}

async function fadeMusicVolume(audio, targetVolume, durationMs, token) {
    if (!audio) {
        return;
    }

    if (audio.__fadeFrameId) {
        window.cancelAnimationFrame(audio.__fadeFrameId);
        audio.__fadeFrameId = null;
    }

    const startVolume = Number.isFinite(audio.volume) ? audio.volume : 0;
    if (durationMs <= 0 || startVolume === targetVolume) {
        audio.volume = targetVolume;
        return;
    }

    return new Promise((resolve) => {
        const startAt = window.performance.now();

        const step = (now) => {
            if (token !== activeMusicToken || audio !== activeMusicAudio) {
                resolve();
                return;
            }

            const progress = Math.min((now - startAt) / durationMs, 1);
            audio.volume = startVolume + (targetVolume - startVolume) * progress;

            if (progress < 1) {
                audio.__fadeFrameId = window.requestAnimationFrame(step);
                return;
            }

            audio.__fadeFrameId = null;
            resolve();
        };

        audio.__fadeFrameId = window.requestAnimationFrame(step);
    });
}

async function stopMusicPlayback({ fadeOut = true } = {}) {
    const audio = activeMusicAudio;
    const token = ++activeMusicToken;

    if (!audio) {
        return;
    }

    if (fadeOut && !audio.paused) {
        await fadeMusicVolume(audio, 0, musicFadeDurationMs, token);
    }

    teardownMusicAudio(audio);
    audio.pause();
    audio.currentTime = 0;

    if (activeMusicAudio === audio) {
        activeMusicAudio = null;
    }
}

function bindLoopingPlayback(audio, token) {
    const restartTrack = async () => {
        if (token !== activeMusicToken || audio !== activeMusicAudio || audio.__loopTransitioning) {
            return;
        }

        audio.__loopTransitioning = true;

        const remainingSeconds = Number.isFinite(audio.duration)
            ? Math.max(audio.duration - audio.currentTime, 0)
            : 0;
        const fadeOutDurationMs =
            remainingSeconds > 0
                ? Math.min(musicFadeDurationMs, Math.max(remainingSeconds * 1000 - 50, 200))
                : 0;

        await fadeMusicVolume(audio, 0, fadeOutDurationMs, token);

        if (token !== activeMusicToken || audio !== activeMusicAudio) {
            return;
        }

        audio.currentTime = 0;

        try {
            if (audio.paused) {
                await audio.play();
            }
        } catch {
            audio.__loopTransitioning = false;
            return;
        }

        await fadeMusicVolume(audio, musicMaxVolume, musicFadeDurationMs, token);

        if (token === activeMusicToken && audio === activeMusicAudio) {
            audio.__loopTransitioning = false;
        }
    };

    audio.__loopHandler = () => {
        if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
            return;
        }

        const remainingSeconds = audio.duration - audio.currentTime;
        if (remainingSeconds <= musicLoopLeadSeconds) {
            void restartTrack();
        }
    };

    audio.__endedHandler = () => {
        void restartTrack();
    };

    audio.addEventListener("timeupdate", audio.__loopHandler);
    audio.addEventListener("ended", audio.__endedHandler);
}

async function playLetterMusic(letter) {
    const musicUrl = getLetterMusicUrl(letter);

    if (!musicUrl) {
        await stopMusicPlayback();
        return;
    }

    await stopMusicPlayback();

    const token = ++activeMusicToken;
    const audio = new Audio(musicUrl);
    audio.preload = "auto";
    audio.volume = 0;
    activeMusicAudio = audio;

    bindLoopingPlayback(audio, token);

    try {
        await audio.play();
        await fadeMusicVolume(audio, musicMaxVolume, musicFadeDurationMs, token);
    } catch {
        teardownMusicAudio(audio);
        if (activeMusicAudio === audio) {
            activeMusicAudio = null;
        }
    }
}

async function fetchLetter(passcode) {
    await sleep(1000);

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
        abortController.abort();
    }, requestTimeoutMs);

    try {
        const response = await fetch("/api/letter", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                password: passcode,
            }),
            signal: abortController.signal,
        });

        if (!response.ok) {
            let detailMessage = `错误：${response.status}`;

            try {
                const errorBody = await response.json();
                if (errorBody && typeof errorBody.detail === "string" && errorBody.detail.trim()) {
                    detailMessage = errorBody.detail.trim();
                }
            } catch {
                // Keep the fallback status message when the error body is not valid JSON.
            }

            const error = new Error(detailMessage);
            error.name = "BackendError";
            throw error;
        }

        return await response.json();
    } finally {
        window.clearTimeout(timeoutId);
    }
}

function renderLetter(letter) {
    letterAvatar.src = letter.avatar;
    letterTitle.innerText = letter.title;

    paperContent.innerHTML = "";

    const paragraphs = letter.content
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);

    for (const paragraphText of paragraphs) {
        const paragraph = document.createElement("p");
        paragraph.innerText = paragraphText;
        paperContent.appendChild(paragraph);
    }

    const signature = document.createElement("p");
    signature.className = "letter-signature";
    signature.innerText = `—— ${letter.sign}`;
    paperContent.appendChild(signature);
}

async function startSignalCaptureAnimation() {
    const token = ++signalAnimationToken;

    signalFrameIndex = 0;
    pwdInput.value = signalFrames[signalFrameIndex];

    while (token === signalAnimationToken) {
        await sleep(220);

        if (token !== signalAnimationToken) {
            return;
        }

        signalFrameIndex = (signalFrameIndex + 1) % signalFrames.length;
        pwdInput.value = signalFrames[signalFrameIndex];
    }
}

function stopSignalCaptureAnimation() {
    signalAnimationToken += 1;
}

function resetTransmissionState() {
    hasTransmissionError = false;
    stopSignalCaptureAnimation();
    stopSpectrumAnimation();
    submitBtn.disabled = false;
    pwdInput.disabled = false;
    pwdInput.style.pointerEvents = "auto";
    powerLight.classList.remove("loading", "ready", "error");
    pwdInput.value = "";
    pwdInput.focus();
}

function showTransmissionError(message) {
    hasTransmissionError = true;
    stopSignalCaptureAnimation();
    stopSpectrumAnimation();
    powerLight.classList.remove("loading");
    powerLight.classList.add("error");
    pwdInput.value = message;
}

function abbreviateDetail(detail) {
    const text = String(detail || "").trim();
    if (!text) {
        return "传输发生错误";
    }

    const maxLength = 6;
    return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
}

// 1. 启动逻辑
submitBtn.addEventListener("click", async () => {
    if (pwdInput.value.trim() === "") return;

    const passcode = pwdInput.value.trim();
    hasTransmissionError = false;
    stopSpectrumAnimation();
    triggerHapticFeedback(hapticPatterns.confirm);

    submitBtn.disabled = true;
    pwdInput.disabled = true;
    pwdInput.style.pointerEvents = "none";
    void startSignalCaptureAnimation();
    powerLight.classList.remove("ready");
    powerLight.classList.add("loading");

    try {
        const letter = await fetchLetter(passcode);
        renderLetter(letter);
        void playLetterMusic(letter);

        await sleep(1200);
        stopSignalCaptureAnimation();
        pwdInput.value = "已就绪";
        powerLight.classList.remove("loading");
        powerLight.classList.add("ready");
        triggerHapticFeedback(hapticPatterns.success);

        // 弹出纸张头部
        paper.style.transition = "transform 2s cubic-bezier(0.19, 1, 0.22, 1)";
        currentTranslateY = 85; // 露出一点头部
        paper.style.transform = `translateY(${currentTranslateY}%)`;

        await sleep(1000);
        pullHint.style.opacity = "1";
        pwdInput.value = "向上拉动纸张";
        isPrinted = true;
    } catch (error) {
        if (error && error.name === "AbortError") {
            triggerHapticFeedback(hapticPatterns.error);
            showTransmissionError("传输超时");
            return;
        }

        stopSignalCaptureAnimation();
        powerLight.classList.remove("loading");
        powerLight.classList.add("error");

        if (error && error.name === "BackendError") {
            triggerHapticFeedback(hapticPatterns.error);
            showTransmissionError(abbreviateDetail(error.message));
            return;
        }

        triggerHapticFeedback(hapticPatterns.error);
        showTransmissionError("传输发生错误");
    }
});

lcdScreen.addEventListener("click", () => {
    if (!hasTransmissionError) return;

    resetTransmissionState();
});

// 2. 物理拉动逻辑
let startY = 0;
let startTranslateY = 0;

paper.addEventListener("pointerdown", (e) => {
    if (!isPrinted) return;
    paper.setPointerCapture(e.pointerId);
    startY = e.clientY;
    startTranslateY = currentTranslateY;
    paper.style.transition = "none";
    pullHint.style.opacity = "0";
});

paper.addEventListener("pointermove", (e) => {
    if (!startY) return;

    const deltaY = e.clientY - startY;
    // 🌟 核心修复 1：用信纸的实际高度来计算百分比，实现绝对 1:1 跟手！
    const paperHeight = paper.offsetHeight;
    const deltaPercent = (deltaY / paperHeight) * 100;

    let nextY = startTranslateY + deltaPercent;

    // 🌟 核心修复 2：增加顶部和底部的硬物理边界
    if (nextY > 85) nextY = 85; // 不能塞回机器深处
    if (nextY < 0) nextY = 0; // 0% 代表拉到底了，彻底锁死

    currentTranslateY = nextY;
    paper.style.transform = `translateY(${currentTranslateY}%)`;
});

paper.addEventListener("pointerup", () => {
    startY = 0;
    // 可以在这里加一点点惯性或对齐逻辑
    // 目前保持不动，增强物理停留感
    if (currentTranslateY < 80) {
        pwdInput.value = "";
        void startSpectrumAnimation();
    }
});
