function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchLetter(passcode) {
    await sleep(1000);

    const abortController = new AbortController();
    const timeoutId = window.setTimeout(() => {
        abortController.abort();
    }, 10000);

    try {
        const response = await fetch("/api/letter", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                passCode: passcode,
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

// 传真机::扬声器
const Speaker = () => {
    let activeMusicToken = 0;
    let activeMusicAudio = null;
    let pendingMusicRetry = false;
    let requestedMusicUrl = "";
    let isUnlockHandlersBound = false;
    let unlockAudio = null;
    const musicFadeDurationMs = 1800;
    const musicMaxVolume = 0.4;
    const musicLoopLeadSeconds = musicFadeDurationMs / 1000 + 0.15;
    const silentAudioDataUrl =
        "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

    const isAutoplayBlockError = (error) => {
        if (!error) {
            return false;
        }

        const errorName = typeof error.name === "string" ? error.name : "";
        const errorMessage = typeof error.message === "string" ? error.message.toLowerCase() : "";

        return (
            errorName === "NotAllowedError" ||
            errorName === "NotSupportedError" ||
            errorMessage.includes("user gesture") ||
            errorMessage.includes("user activation") ||
            errorMessage.includes("notallowederror")
        );
    };

    const clearPendingMusicRetry = () => {
        pendingMusicRetry = false;
    };

    const markMusicRetryPending = () => {
        pendingMusicRetry = true;
    };

    const primePlayback = async () => {
        if (!unlockAudio) {
            unlockAudio = new Audio(silentAudioDataUrl);
            unlockAudio.preload = "auto";
            unlockAudio.volume = 0;
            unlockAudio.muted = true;
        }

        try {
            unlockAudio.currentTime = 0;
            await unlockAudio.play();
            unlockAudio.pause();
            unlockAudio.currentTime = 0;
        } catch {
            // Priming best-effort only.
        }
    };

    const teardownMusicAudio = (audio) => {
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
    };

    const retryBlockedMusicPlayback = async () => {
        if (!pendingMusicRetry || !requestedMusicUrl || !activeMusicAudio) {
            return;
        }

        const audio = activeMusicAudio;
        const token = activeMusicToken;

        try {
            await audio.play();
            clearPendingMusicRetry();
            await fadeMusicVolume(audio, musicMaxVolume, musicFadeDurationMs, token);
        } catch (error) {
            if (!isAutoplayBlockError(error)) {
                console.error("music retry failed", error);
                clearPendingMusicRetry();
            }
        }
    };

    const bindUnlockHandlers = () => {
        if (isUnlockHandlersBound) {
            return;
        }

        isUnlockHandlersBound = true;

        const onUserActivation = () => {
            void primePlayback();
            void retryBlockedMusicPlayback();
        };

        window.addEventListener("pointerdown", onUserActivation, { passive: true });
        window.addEventListener("touchstart", onUserActivation, { passive: true });
        window.addEventListener("keydown", onUserActivation);
        window.addEventListener("pageshow", onUserActivation);
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") {
                onUserActivation();
            }
        });
        document.addEventListener("WeixinJSBridgeReady", onUserActivation);
    };

    const fadeMusicVolume = async (audio, targetVolume, durationMs, token) => {
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
    };

    const stopMusic = async ({ fadeOut = true } = {}) => {
        const audio = activeMusicAudio;
        const token = ++activeMusicToken;
        clearPendingMusicRetry();
        requestedMusicUrl = "";

        if (!audio) {
            return;
        }

        if (fadeOut && !audio.paused) {
            await fadeMusicVolume(audio, 0, musicFadeDurationMs, token);
        }

        teardownMusicAudio(audio);
        audio.pause();
        audio.currentTime = 0;
        audio.removeAttribute("src");
        audio.load();

        if (activeMusicAudio === audio) {
            activeMusicAudio = null;
        }
    };

    const bindLoopingPlayback = (audio, token) => {
        const restartTrack = async () => {
            if (
                token !== activeMusicToken ||
                audio !== activeMusicAudio ||
                audio.__loopTransitioning
            ) {
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
    };

    const playMusic = async (musicUrl) => {
        if (!musicUrl) {
            await stopMusic();
            return;
        }

        await stopMusic();

        const token = ++activeMusicToken;
        requestedMusicUrl = musicUrl;
        const audio = new Audio(musicUrl);
        audio.preload = "auto";
        audio.muted = false;
        audio.volume = 0;
        activeMusicAudio = audio;

        bindLoopingPlayback(audio, token);

        try {
            audio.load();
            await audio.play();
            clearPendingMusicRetry();
            await fadeMusicVolume(audio, musicMaxVolume, musicFadeDurationMs, token);
        } catch (error) {
            if (isAutoplayBlockError(error)) {
                markMusicRetryPending();
                return;
            }

            console.error("music playback failed", error);
            teardownMusicAudio(audio);
            clearPendingMusicRetry();
            requestedMusicUrl = "";
            if (activeMusicAudio === audio) {
                activeMusicAudio = null;
            }
        }
    };

    bindUnlockHandlers();

    return { playMusic, stopMusic, primePlayback };
};

// 传真机::状态显示屏
const LcdScreen = () => {
    const SignalCaptureAnimation = (() => {
        const signalFrames = [
            "信号传输 ▇ ▃ ▃",
            "信号传输 ▅ ▇ ▃",
            "信号传输 ▃ ▅ ▇",
            "信号传输 ▃ ▃ ▅",
        ];
        let signalAnimationToken = 0;

        const start = async () => {
            let signalFrameIndex = 0;
            const token = ++signalAnimationToken;

            signalFrameIndex = 0;
            inputBox.value = signalFrames[signalFrameIndex];

            while (token === signalAnimationToken) {
                await sleep(220);

                if (token !== signalAnimationToken) {
                    return;
                }

                signalFrameIndex = (signalFrameIndex + 1) % signalFrames.length;
                inputBox.value = signalFrames[signalFrameIndex];
            }
        };

        const stop = () => {
            signalAnimationToken += 1;
        };

        return { start, stop };
    })();

    const SpectrumAnimation = (() => {
        const spectrumGlyphs = ["▇", "▃", "▅"];
        const spectrumFrameIntervalMs = 180;
        let spectrumAnimationToken = 0;

        const buildSpectrumFrame = () => {
            const frame = [];

            for (let index = 0; index < 5; index += 1) {
                const randomIndex = Math.floor(Math.random() * spectrumGlyphs.length);
                frame.push(spectrumGlyphs[randomIndex]);
            }

            return frame.join(" ");
        };

        const renderSpectrumFrame = () => {
            inputBox.value = buildSpectrumFrame();
        };

        const start = async () => {
            const token = ++spectrumAnimationToken;

            renderSpectrumFrame();

            while (token === spectrumAnimationToken) {
                await sleep(spectrumFrameIntervalMs);

                if (token !== spectrumAnimationToken) {
                    return;
                }

                renderSpectrumFrame();
            }
        };

        const stop = () => {
            spectrumAnimationToken += 1;
        };

        return { start, stop };
    })();

    const inputBox = document.getElementById("pwdInput");

    const getText = () => {
        return inputBox.value;
    };

    const displayText = (text) => {
        inputBox.value = text;
    };

    const toReadonly = () => {
        inputBox.disabled = true;
        inputBox.style.pointerEvents = "none";
    };

    const toEditable = () => {
        inputBox.disabled = false;
        inputBox.style.pointerEvents = "auto";
    };

    const reset = () => {
        SignalCaptureAnimation.stop();
        SpectrumAnimation.stop();
        inputBox.disabled = false;
        inputBox.style.pointerEvents = "auto";
        inputBox.value = "";
    };

    return {
        reset,
        displayText,
        getText,
        toReadonly,
        toEditable,
        startSpectrumAnimation: SpectrumAnimation.start,
        stopSpectrumAnimation: SpectrumAnimation.stop,
        startSignalCaptureAnimation: SignalCaptureAnimation.start,
        stopSignalCaptureAnimation: SignalCaptureAnimation.stop,
    };
};

// 传真机::状态指示灯
const PowerLight = () => {
    const powerLight = document.getElementById("powerLight");

    const idle = () => {
        powerLight.classList.remove("loading", "ready", "error");
    };

    const loading = () => {
        powerLight.classList.remove("loading", "ready", "error");
        powerLight.classList.add("loading");
    };

    const ready = () => {
        powerLight.classList.remove("loading", "ready", "error");
        powerLight.classList.add("ready");
    };

    const error = () => {
        powerLight.classList.remove("loading", "ready", "error");
        powerLight.classList.add("error");
    };

    return {
        idle,
        loading,
        ready,
        error,
    };
};

// 传真机
const MachineController = ({ lcdScreen, powerLight, paper, speaker }) => {
    let hasTransmissionError = false;
    const hapticPatterns = {
        confirm: 50,
        success: [30, 50, 30],
        error: [40, 60, 40],
    };
    const submitButton = document.getElementById("submitBtn");
    const resetButton = document.getElementById("resetBtn");

    const triggerHapticFeedback = (pattern) => {
        if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
            return;
        }

        navigator.vibrate(pattern);
    };

    const showTransmissionError = (message) => {
        hasTransmissionError = true;

        lcdScreen.reset();
        powerLight.error();

        lcdScreen.displayText(message);
        lcdScreen.toReadonly();
    };

    const resetTransmissionState = async () => {
        hasTransmissionError = false;

        await speaker.stopMusic();
        paper.reset();
        lcdScreen.reset();
        powerLight.idle();

        submitButton.disabled = false;
        resetButton.disabled = false;
    };

    const onSubmitButtonClick = async () => {
        const abbreviateDetail = (detail) => {
            const text = String(detail || "").trim();
            if (!text) {
                return "传输发生错误";
            }

            const maxLength = 6;
            return text.length <= maxLength ? text : `${text.slice(0, maxLength)}...`;
        };

        const passcode = lcdScreen.getText().trim();

        void speaker.primePlayback();

        hasTransmissionError = false;
        submitButton.disabled = true;
        resetButton.disabled = true;

        lcdScreen.reset();
        lcdScreen.toReadonly();
        void lcdScreen.startSignalCaptureAnimation();

        powerLight.loading();

        try {
            const letter = await fetchLetter(passcode);
            paper.renderLetter(letter);

            lcdScreen.displayText("已就绪");
            powerLight.ready();
            lcdScreen.stopSignalCaptureAnimation();
            triggerHapticFeedback(hapticPatterns.success);

            await paper.showLetterReady();

            void speaker.playMusic(letter.music);
            await sleep(1000);
            void lcdScreen.startSpectrumAnimation();

            resetButton.disabled = false;
        } catch (error) {
            console.error(error);
            if (error && error.name === "AbortError") {
                resetButton.disabled = false;
                triggerHapticFeedback(hapticPatterns.error);
                showTransmissionError("传输超时");
                return;
            }

            lcdScreen.stopSignalCaptureAnimation();
            powerLight.error();
            resetButton.disabled = false;

            if (error && error.name === "BackendError") {
                triggerHapticFeedback(hapticPatterns.error);
                showTransmissionError(abbreviateDetail(error.message));
                return;
            }

            triggerHapticFeedback(hapticPatterns.error);
            showTransmissionError("传输发生错误");
        }
    };

    const onResetButtonClick = async () => {
        if (resetButton.disabled) {
            return;
        }

        await resetTransmissionState();
    };

    const bind = () => {
        submitButton.addEventListener("click", onSubmitButtonClick);
        resetButton.addEventListener("click", onResetButtonClick);
    };

    return {
        bind,
        showTransmissionError,
        resetTransmissionState,
    };
};

// 信件::信件内容
const LetterContent = () => {
    const render = (letter) => {
        const avatarE = document.getElementById("letterAvatar");
        const titleE = document.getElementById("letterTitle");
        const dateE = document.getElementById("letterDate");
        const contentE = document.getElementById("paperContent");

        avatarE.src = letter.avatar;
        titleE.innerText = letter.title;
        dateE.innerText = new Date().toLocaleString();

        contentE.innerHTML = "";

        const paragraphs = letter.content
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean);

        for (const paragraphText of paragraphs) {
            const paragraph = document.createElement("p");
            paragraph.innerText = paragraphText;
            contentE.appendChild(paragraph);
        }

        const signature = document.createElement("p");
        signature.className = "letter-signature";
        signature.innerText = `${letter.sign}`;
        contentE.appendChild(signature);
    };

    return { render };
};

// 信件
const PaperController = ({ paper, pullHint, letterContent }) => {
    let isPrinted = false;
    let startY = 0;
    let startTranslateY = 0;
    let currentTranslateY = 100;

    const setPaperTranslate = (nextY) => {
        currentTranslateY = nextY;
        paper.style.transform = `translateY(${currentTranslateY}%)`;
    };

    const renderLetter = (letter) => {
        letterContent.render(letter);
    };

    const showLetterReady = async () => {
        // 弹出纸张头部
        paper.style.transition = "transform 2s cubic-bezier(0.19, 1, 0.22, 1)";
        currentTranslateY = 85; // 露出一点头部
        paper.style.transform = `translateY(${currentTranslateY}%)`;

        paper.style.transition = "transform 2s cubic-bezier(0.19, 1, 0.22, 1)";
        setPaperTranslate(85);

        await sleep(1000);
        pullHint.style.opacity = "1";
        isPrinted = true;
    };

    const reset = () => {
        isPrinted = false;
        startY = 0;
        startTranslateY = 0;
        paper.style.transition = "none";
        pullHint.style.opacity = "0";
        setPaperTranslate(100);
    };

    const onPointerDown = (event) => {
        if (!isPrinted) {
            return;
        }

        paper.setPointerCapture(event.pointerId);
        startY = event.clientY;
        startTranslateY = currentTranslateY;
        paper.style.transition = "none";
        pullHint.style.opacity = "0";
    };

    const onPointerMove = (event) => {
        if (!startY) {
            return;
        }

        const deltaY = event.clientY - startY;
        const paperHeight = paper.offsetHeight;
        const deltaPercent = (deltaY / paperHeight) * 100;

        let nextY = startTranslateY + deltaPercent;

        if (nextY > 85) {
            nextY = 85;
        }

        if (nextY < 0) {
            nextY = 0;
        }

        setPaperTranslate(nextY);
    };

    const onPointerUp = (event) => {
        startY = 0;

        if (event && typeof paper.releasePointerCapture === "function") {
            try {
                paper.releasePointerCapture(event.pointerId);
            } catch {
                // Ignore release failures when capture is already cleared.
            }
        }
    };

    const bind = () => {
        paper.addEventListener("pointerdown", onPointerDown);
        paper.addEventListener("pointermove", onPointerMove);
        paper.addEventListener("pointerup", onPointerUp);
        paper.addEventListener("pointercancel", onPointerUp);
    };

    return {
        bind,
        reset,
        renderLetter,
        showLetterReady,
    };
};

const AppController = () => {
    const paperController = PaperController({
        paper: document.getElementById("paper"),
        pullHint: document.getElementById("pullHint"),
        letterContent: LetterContent(),
    });

    const machineController = MachineController({
        lcdScreen: LcdScreen(),
        powerLight: PowerLight(),
        speaker: Speaker(),
        paper: paperController,
    });

    const run = () => {
        paperController.bind();
        paperController.reset();

        machineController.bind();
        machineController.resetTransmissionState();
    };

    return {
        run,
    };
};

AppController().run();
