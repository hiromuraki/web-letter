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
let signalFrameTimer = null;
let hasTransmissionError = false;
const signalFrames = ["信号传输 ▇ ▃ ▃", "信号传输 ▅ ▇ ▃", "信号传输 ▃ ▅ ▇", "信号传输 ▃ ▃ ▅"];
const requestTimeoutMs = 10000; // 10 秒超时

function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchLetter(passcode) {
    await sleep(2000);

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

function startSignalCaptureAnimation() {
    signalFrameIndex = 0;
    pwdInput.value = signalFrames[signalFrameIndex];

    signalFrameTimer = window.setInterval(() => {
        signalFrameIndex = (signalFrameIndex + 1) % signalFrames.length;
        pwdInput.value = signalFrames[signalFrameIndex];
    }, 220);
}

function stopSignalCaptureAnimation() {
    if (signalFrameTimer !== null) {
        window.clearInterval(signalFrameTimer);
        signalFrameTimer = null;
    }
}

function resetTransmissionState() {
    hasTransmissionError = false;
    stopSignalCaptureAnimation();
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

    submitBtn.disabled = true;
    pwdInput.disabled = true;
    pwdInput.style.pointerEvents = "none";
    startSignalCaptureAnimation();
    powerLight.classList.remove("ready");
    powerLight.classList.add("loading");

    try {
        const letter = await fetchLetter(passcode);
        renderLetter(letter);

        await sleep(1200);
        stopSignalCaptureAnimation();
        pwdInput.value = "已就绪";
        powerLight.classList.remove("loading");
        powerLight.classList.add("ready");

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
            showTransmissionError("传输超时");
            return;
        }

        stopSignalCaptureAnimation();
        powerLight.classList.remove("loading");
        powerLight.classList.add("error");

        if (error && error.name === "BackendError") {
            showTransmissionError(abbreviateDetail(error.message));
            return;
        }

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
        pwdInput.value = "阅读模式";
    }
});
