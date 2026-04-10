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

const createBackgroundMusicController = () => {
    let activeMusicToken = 0;
    let activeMusicAudio = null;
    const musicFadeDurationMs = 1800;
    const musicMaxVolume = 0.4;
    const musicLoopLeadSeconds = musicFadeDurationMs / 1000 + 0.15;

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
    };

    return [playMusic, stopMusic];
};

const [playMusic, stopMusic] = createBackgroundMusicController();

// 传真机控制器
const MachineController = ({ submitButton, inputBox, lcdScreen, powerLight, onLetterReceived }) => {
    let hasTransmissionError = false;
    const hapticPatterns = {
        confirm: 50,
        success: [30, 50, 30],
        error: [40, 60, 40],
    };

    const triggerHapticFeedback = (pattern) => {
        if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") {
            return;
        }

        navigator.vibrate(pattern);
    };

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

    const showTransmissionError = (message) => {
        hasTransmissionError = true;
        SignalCaptureAnimation.stop();
        SpectrumAnimation.stop();
        powerLight.classList.remove("loading");
        powerLight.classList.add("error");
        inputBox.value = message;
    };

    const resetTransmissionState = () => {
        hasTransmissionError = false;
        SignalCaptureAnimation.stop();
        SpectrumAnimation.stop();
        submitButton.disabled = false;
        inputBox.disabled = false;
        inputBox.style.pointerEvents = "auto";
        powerLight.classList.remove("loading", "ready", "error");
        inputBox.value = "";
        inputBox.focus();
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

        const passcode = inputBox.value.trim();
        if (passcode.length === 0) {
            return;
        }

        hasTransmissionError = false;
        SignalCaptureAnimation.stop();

        submitButton.disabled = true;
        inputBox.disabled = true;
        inputBox.style.pointerEvents = "none";
        void SignalCaptureAnimation.start();
        powerLight.classList.remove("ready");
        powerLight.classList.add("loading");

        try {
            const letter = await fetchLetter(passcode);

            await sleep(1200);

            SignalCaptureAnimation.stop();
            inputBox.value = "已就绪";
            powerLight.classList.remove("loading");
            powerLight.classList.add("ready");
            triggerHapticFeedback(hapticPatterns.success);

            onLetterReceived(letter);
        } catch (error) {
            console.error(error);
            if (error && error.name === "AbortError") {
                triggerHapticFeedback(hapticPatterns.error);
                showTransmissionError("传输超时");
                return;
            }

            SignalCaptureAnimation.stop();
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
    };

    const onLcdScreenClick = () => {
        if (!hasTransmissionError) {
            return;
        }

        resetTransmissionState();
    };

    const bind = () => {
        submitButton.addEventListener("click", onSubmitButtonClick);
        lcdScreen.addEventListener("click", onLcdScreenClick);
    };

    return {
        bind,
        showTransmissionError,
        resetTransmissionState,
        startSpectrumAnimation: SpectrumAnimation.start,
        stopSpectrumAnimation: SpectrumAnimation.stop,
        startSignalCaptureAnimation: SignalCaptureAnimation.start,
        stopSignalCaptureAnimation: SignalCaptureAnimation.stop,
    };
};

// 信件交互控制器
const PageController = ({ paper, pullHint }) => {
    let isPrinted = false;
    let startY = 0;
    let startTranslateY = 0;
    let currentTranslateY = 100;

    const setPaperTranslate = (nextY) => {
        currentTranslateY = nextY;
        paper.style.transform = `translateY(${currentTranslateY}%)`;
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

    const bind = () => {
        paper.addEventListener("pointerdown", onPointerDown);
        paper.addEventListener("pointermove", onPointerMove);
    };

    const unbind = () => {
        paper.removeEventListener("pointerdown", onPointerDown);
        paper.removeEventListener("pointermove", onPointerMove);
    };

    return {
        bind,
        unbind,
        reset,
        showLetterReady,
        getCurrentTranslateY: () => currentTranslateY,
        isReadyToRead: () => isPrinted,
    };
};

// 信件渲染器
const LetterBody = ({ date, title, avatar, content }) => {
    const render = (letter) => {
        avatar.src = letter.avatar;
        title.innerText = letter.title;
        date.innerText = new Date().toLocaleString();

        content.innerHTML = "";

        const paragraphs = letter.content
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean);

        for (const paragraphText of paragraphs) {
            const paragraph = document.createElement("p");
            paragraph.innerText = paragraphText;
            content.appendChild(paragraph);
        }

        const signature = document.createElement("p");
        signature.className = "letter-signature";
        signature.innerText = `—— ${letter.sign}`;
        content.appendChild(signature);
    };

    return { render };
};

const AppController = () => {};

const letterBody = LetterBody({
    avatar: document.getElementById("letterAvatar"),
    title: document.getElementById("letterTitle"),
    date: document.getElementById("letterDate"),
    content: document.getElementById("paperContent"),
});

const pageController = PageController({
    paper: document.getElementById("paper"),
    pullHint: document.getElementById("pullHint"),
});

pageController.bind();
pageController.reset();

const machineController = MachineController({
    submitButton: document.getElementById("submitBtn"),
    inputBox: document.getElementById("pwdInput"),
    lcdScreen: document.querySelector(".lcd-screen"),
    powerLight: document.getElementById("powerLight"),
    page: pageController,
    onLetterReceived: async (letter) => {
        letterBody.render(letter);
        await pageController.showLetterReady();
        void playMusic(letter.music);
        await sleep(2000);
        machineController.startSpectrumAnimation();
    },
});

machineController.bind();
machineController.resetTransmissionState();
