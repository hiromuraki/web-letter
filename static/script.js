// 🌟 音乐淡入逻辑
function fadeAudioIn() {
    const bgMusic = document.getElementById("bgMusic");

    if (!bgMusic.getAttribute("src")) {
        bgMusic.setAttribute("src", "/api/music");
        bgMusic.load();
    }

    bgMusic.volume = 0;

    // 利用用户刚刚点击按钮的交互，安全触发播放
    bgMusic
        .play()
        .then(() => {
            let volume = 0;
            const fadeInterval = setInterval(() => {
                if (volume < 0.5) {
                    // 将最高音量限制在 0.5，防刺耳
                    volume += 0.05;
                    bgMusic.volume = Math.min(volume, 0.5);
                } else {
                    clearInterval(fadeInterval);
                }
            }, 100); // 100ms * 10次 = 1秒渐变完毕
        })
        .catch((e) => console.warn("背景音乐播放可能被拦截:", e));
}

async function getLetter(password) {
    const response = await fetch("/api/letter", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ password: password }),
    });

    if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "请求出错啦");
    }

    return await response.json();
}

const avatarBtn = document.getElementById("avatarBtn");
const scene = document.getElementById("scene");
const pwdModal = document.getElementById("pwdModal");
const pwdInput = document.getElementById("pwdInput");
const submitBtn = document.getElementById("submitBtn");
const pwdError = document.getElementById("pwdError");

const cardTitle = document.getElementById("cardTitle");
const cardContent = document.getElementById("cardContent");
const cardSign = document.getElementById("cardSign");

// 🌟 核心逻辑：头像点击的多态处理
avatarBtn.addEventListener("click", () => {
    if (scene.classList.contains("is-opened")) {
        // 已开信状态：点击弹出爱心彩蛋
        popHeart();
    } else {
        // 未开信状态：呼出密码弹窗
        pwdModal.classList.add("show");
        pwdInput.focus();
    }
});

// 生成爱心的方法
function popHeart() {
    const heart = document.createElement("div");
    heart.className = "floating-heart";
    // 随机选择小元素
    heart.innerText = ["❤️", "💖", "✨", "💕"][Math.floor(Math.random() * 4)];

    // 获取头像位置，计算发射点
    const rect = avatarBtn.getBoundingClientRect();
    // 让爱心有一点点左右随机偏移，更自然
    const offsetX = (Math.random() - 0.5) * 30;

    heart.style.left = `${rect.left + rect.width / 2 + offsetX}px`;
    heart.style.top = `${rect.top}px`;

    document.body.appendChild(heart);

    // 1.2秒动画结束后自动销毁 DOM
    setTimeout(() => heart.remove(), 1200);
}

pwdInput.addEventListener("input", () => {
    if (pwdInput.value.trim().length > 0) {
        submitBtn.classList.add("ready");
    } else {
        submitBtn.classList.remove("ready");
    }
});

async function handleSubmit() {
    if (!submitBtn.classList.contains("ready")) {
        return;
    }

    const pwd = pwdInput.value;
    pwdError.style.display = "none";
    submitBtn.innerText = "开启中...";
    submitBtn.style.opacity = "0.7";

    try {
        const data = await getLetter(pwd);

        cardTitle.innerText = `✨ ${data.title} ✨`;

        const paragraphs = data.content.split("\n").filter((p) => p.trim());
        cardContent.innerHTML = paragraphs.map((p) => `<p>${p}</p>`).join("");
        cardSign.innerText = `—— ${data.sign}`;

        pwdModal.classList.remove("show");

        setTimeout(() => {
            scene.classList.add("is-opened");
            // 🌟 触发背景音乐淡入
            fadeAudioIn();

            setTimeout(() => {
                avatarBtn.style.transition = "transform 0.15s cubic-bezier(0.4, 0, 0.2, 1)";
            }, 1200);
        }, 150);
    } catch (err) {
        pwdError.innerText = err.message;
        pwdError.style.display = "block";
        submitBtn.innerText = "拆开信件";
        submitBtn.style.opacity = "1";
    }
}

submitBtn.addEventListener("click", handleSubmit);

pwdInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") handleSubmit();
});

pwdModal.addEventListener("click", (e) => {
    if (e.target === pwdModal) {
        pwdModal.classList.remove("show");
    }
});

// 星星交互
function createStar(x, y) {
    const star = document.createElement("div");
    star.className = "star";
    star.style.left = `${x}px`;
    star.style.top = `${y}px`;
    star.style.position = "fixed";
    star.style.zIndex = "5";
    star.style.animation = "twinkle 0.8s ease-out forwards";
    document.body.appendChild(star);
    setTimeout(() => star.remove(), 800);
}

document.addEventListener("click", (e) => {
    if (!e.target.closest(".envelope-wrapper") && !e.target.closest(".password-modal")) {
        createStar(e.clientX, e.clientY);
    }
});
