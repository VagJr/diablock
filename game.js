/* =========================
   MOBILE-SAFE BGM (Diablock)
   ========================= */
let bgm = null;
let bgmStarted = false;
let cameraShake = 0;

function ensureBGM() {
    if (bgmStarted) return;
    bgmStarted = true;

    // Tenta carregar o áudio, mas não trava se falhar
    bgm = new Audio("assets/bgm.mp3");
    bgm.loop = true;
    bgm.volume = 0.4;
    
    // Adiciona listener de erro para evitar logs vermelhos feios se o arquivo não existir
    bgm.addEventListener('error', function() {
        console.log("BGM file not found or failed to load. Playing without music.");
    });

    const p = bgm.play();
    if (p && p.catch) {
        p.catch(err => {
            // Auto-play foi bloqueado ou arquivo não existe
            // Apenas ignoramos
            bgmStarted = false; 
        });
    }
}
/* ========================= */

const socket = io();
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const SCALE = 16;
let myId = null, me = null;
let state = { pl:{}, mb:{}, it:{}, pr:[], props:[], map:[], explored: [], lightRadius: 15, hint: null }; 
let recipes = [];
let cam = { x:0, y:0 }, mouse = { x:0, y:0 };
let texts = [], effects = [];
let uiState = { inv: false, char: false, shop: false, craft: false, chat: false };
let inputState = { x:0, y:0, block: false };
let shopItems = [];
const tooltip = document.getElementById("tooltip");
let dragItem = null;

let isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
let gamepad = null;
let gamepadActive = false; 
let focusIndex = 0;
let focusArea = 'equipment'; 

const gameLog = document.getElementById("game-log");

window.addEventListener("gamepadconnected", (e) => { 
    gamepad = e.gamepad; 
    gamepadActive = true; 
    document.getElementById("mobile-controls").style.display = "none"; 
    document.getElementById("mobile-menu-buttons").style.display = "flex"; 
    addLog("Gamepad Conectado!", "#0f0");
});
window.addEventListener("gamepaddisconnected", (e) => { 
    gamepad = null; 
    gamepadActive = false; 
    addLog("Gamepad Desconectado.", "#f00");
});

const AudioCtrl = {
    ctx: new (window.AudioContext || window.webkitAudioContext)(),
    bgm: null, muted: false,
    init: function() {
        if(!this.bgm) {
            // Tentativa de áudio simplificada
            this.bgm = new Audio("assets/bgm.mp3");
            this.bgm.loop = true; this.bgm.volume = 0.3;
            this.bgm.play().catch(e => {}); // Silencia erros
        }
    },
    playTone: function(freq, type, dur, vol=0.1) {
        if(this.muted || this.ctx.state === 'suspended') return;
        try {
            const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
            o.type = type; o.frequency.setValueAtTime(freq, this.ctx.currentTime);
            g.gain.setValueAtTime(vol, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime+dur);
            o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime+dur);
        } catch(e) {}
    },
    playNoise: function(dur, vol=0.2) {
        if(this.muted || this.ctx.state === 'suspended') return;
        try {
            const b = this.ctx.createBuffer(1, this.ctx.sampleRate*dur, this.ctx.sampleRate);
            const d = b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
            const s = this.ctx.createBufferSource(); s.buffer=b; const g=this.ctx.createGain();
            g.gain.setValueAtTime(vol, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime+dur);
            s.connect(g); g.connect(this.ctx.destination); s.start();
        } catch(e) {}
    }
};

function playSfx(name) {
    switch(name) {
        case "atk": AudioCtrl.playNoise(0.1, 0.1); break;
        case "hit": AudioCtrl.playTone(150, "square", 0.1, 0.15); break;
        case "dash": AudioCtrl.playTone(300, "sawtooth", 0.2, 0.1); break;
        case "gold": AudioCtrl.playTone(1200, "sine", 0.3, 0.1); AudioCtrl.playTone(1800, "sine", 0.3, 0.1); break;
        case "craft": AudioCtrl.playTone(400, "triangle", 0.5, 0.2); break;
        case "levelup": [440, 554, 659, 880].forEach((f,i) => setTimeout(()=>AudioCtrl.playTone(f,"square",0.4,0.2), i*100)); break;
        case "chat": AudioCtrl.playTone(800, "sine", 0.1, 0.05); break;
        case "shrine": AudioCtrl.playTone(200, "sine", 0.5, 0.2); AudioCtrl.playTone(400, "sine", 0.5, 0.2); break;
        case "lore": AudioCtrl.playTone(100, "triangle", 1.0, 0.1); break;
    }
}

const resize = () => { 
    canvas.width=innerWidth; 
    canvas.height=innerHeight; 
    ctx.imageSmoothingEnabled=false; 
    isMobile = window.matchMedia("(max-width: 1024px)").matches || /Mobi|Android/i.test(navigator.userAgent); 
    updateUI(); 
};
resize(); window.onresize=resize;

function addLog(msg, color="#0f0") {
    const d = new Date();
    const time = `[${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}]`;
    const logEntry = document.createElement("div");
    logEntry.innerHTML = `<span style="color:#666">${time}</span> <span style="color:${color}">${msg}</span>`;
    gameLog.prepend(logEntry); 
    if (gameLog.children.length > 50) {
        gameLog.removeChild(gameLog.lastChild);
    }
}

socket.on("connect", () => myId=socket.id);
socket.on("char_list", list => {
    document.getElementById("login-form").style.display="none"; document.getElementById("char-select").style.display="block";
    const l = document.getElementById("char-list"); l.innerHTML="";
    for(let n in list){
        let d=document.createElement("div"); d.className="btn"; d.innerHTML=`${n} <small>Lvl ${list[n].level}</small>`;
        d.onclick=()=>{ socket.emit("enter_game", n); document.getElementById("menu").style.display="none"; AudioCtrl.init(); ensureBGM(); };
        l.appendChild(d);
    }
});
socket.on("game_start", d => { recipes = d.recipes; renderCrafting(); });

socket.on("map_data", d => {
    state.map = d.map;
    state.theme = d.theme;
    state.explored = []; 
    addLog("Mapa Carregado.", "#0f0");
});

socket.on("u", d => { 
    const currentMap = state.map;
    Object.assign(state, d); 
    if (!d.map && currentMap) state.map = currentMap;

    me = state.pl[myId];

    if(me && state.theme === "#444") {
        const stairs = state.props.find(p => p.type === "stairs");
        if(stairs && Math.hypot(me.x - stairs.x, me.y - stairs.y) < 1.2) {
            const modal = document.getElementById('entry-modal');
            if(modal && modal.style.display !== 'block') {
                modal.style.display = 'block';
            }
        }
    }

    if(me) updateUI(); 
});

function preventTextOverlap(newText) {
    let attempts = 0;
    while(attempts < 5) {
        let collision = false;
        for(let t of texts) {
            if(Math.abs(t.x - newText.x) < 2 && Math.abs(t.y - newText.y) < 2) {
                collision = true;
                break;
            }
        }
        if(collision) {
            newText.y -= 1.0; 
            newText.x += (Math.random() - 0.5) * 2; 
            attempts++;
        } else {
            break;
        }
    }
}

socket.on("txt", d => {
    const valStr = String(d.val);
    let vy = -0.05; 
    let life = 120;
    
    let startX = d.x + (Math.random() - 0.5) * 0.5;
    let startY = d.y + (Math.random() - 0.5) * 0.5;

    if(valStr.includes("LEVEL UP!")) { vy = -0.02; life = 200; d.size="16px bold Courier New"; d.color="#fb0"; }
    else if(valStr.includes("CRIT!")) { vy = -0.08; life = 150; d.color="#f0f"; d.size="14px bold Courier New"; d.isCrit=true; }
    else if(valStr.includes("CRAFT") || valStr.includes("SOCKETED") || valStr.includes("BLOCK")) { vy = -0.04; life = 100; }
    else if(valStr.includes("DEATH!")) { vy = -0.02; life = 250; d.size="20px bold Courier New"; } 
    else if(valStr.includes("OPEN!") || valStr.includes("UNLOCKED!")) { vy = -0.03; life = 200; d.size="16px bold Courier New"; }
    else if(valStr.includes("+")) { vy = -0.05; life = 100; } 
    else if(valStr.includes("SHRINE")) { vy = -0.03; life = 180; d.color="#0ff"; d.size="12px bold Courier New"; }
    else if(valStr.includes("LOCKED")) { vy = -0.03; life = 80; d.color="#f00"; }
    else if(valStr.includes("GRABBED!") || valStr.includes("FRESH MEAT!") || valStr.includes("!!!")) { vy = -0.05; life = 120; d.size = "12px bold Courier New"; }
    
    const newText = {
        val: valStr,
        x: startX,
        y: startY,
        color: d.color || "#fff",
        life: life,
        vy: vy,
        size: d.size || "10px Courier New"
    };

    preventTextOverlap(newText);
    texts.push(newText);
    
    if(valStr.includes("CRAFT")) playSfx("craft");
    if(valStr.includes("LEVEL")) playSfx("levelup");
    if(valStr.includes("SHRINE")) playSfx("shrine");
    if(valStr.includes("OPEN")) playSfx("shrine");
});

socket.on("fx", d => {
    if (d.type === "slash") { effects.push({ type: "slash", x: d.x, y: d.y, angle: d.angle, life: 10 }); playSfx("atk"); }
    else if (d.type === "spin") { effects.push({ type: "spin", x: d.x, y: d.y, angle: d.angle || 0, life: 20 }); playSfx("atk"); }
    else if (d.type === "nova") effects.push({ type: "nova", x: d.x, y: d.y, life: d.life || 20 });
    else if (d.type === "dash") playSfx("dash");
    else if (d.type === "gold_txt") { 
        const t = { val: String(d.val), x: d.x, y: d.y, color: "#fb0", life: 100, vy: -0.05, size: "10px Courier New" };
        preventTextOverlap(t);
        texts.push(t); 
        playSfx("gold"); 
    }
    else if (d.type === "boss_hit") { cameraShake = 8; playSfx("hit"); }
    else if (d.type === "charge") { effects.push({ type: "charge", x: d.x, y: d.y, life: 30 }); }
    else if (d.type === "hit") playSfx("hit");
    else if (d.type === "gold") playSfx("gold");
    else if (d.type === "lore") playSfx("lore");
});

socket.on("chat", d => { 
    playSfx("chat"); 
    // CORREÇÃO: Adicionar chat ao log visual do jogo
    addLog(`${state.pl[d.id]?.name || "Unknown"}: ${d.msg}`, "#fff");
});
socket.on("open_shop", items => { uiState.shop = true; shopItems = items; updateUI(); });
socket.on("log", d => addLog(d.msg, d.color));

const keys = { w:false, a:false, s:false, d:false, q:false, game_x: 0, game_y: 0 };
function sendInput() {
    let dx = keys.a?-1:keys.d?1:0, dy = keys.w?-1:keys.s?1:0;
    if (gamepadActive && (Math.abs(keys.game_x) > 0.1 || Math.abs(keys.game_y) > 0.1)) { dx = keys.game_x; dy = keys.game_y; }
    if (joystick.active) { dx = joystick.normX; dy = joystick.normY; }
    if(uiState.chat) { dx = 0; dy = 0; }
    if(dx!==inputState.x || dy!==inputState.y || keys.q !== inputState.block){ inputState={x:dx,y:dy,block:keys.q}; socket.emit("input", inputState); }
}

function getMouseAngle() { return Math.atan2((mouse.y - canvas.height/2), (mouse.x - canvas.width/2)); }

function getDirectionalInput() {
    if (joystick.active) return { dx: joystick.normX, dy: joystick.normY };
    const game_dx = keys.game_x, game_dy = keys.game_y;
    if (Math.abs(game_dx) > 0.1 || Math.abs(game_dy) > 0.1) return { dx: game_dx, dy: game_dy };
    const key_dx = keys.d - keys.a, key_dy = keys.s - keys.w;
    if (Math.abs(key_dx) > 0.1 || Math.abs(key_dy) > 0.1) return { dx: key_dx, dy: key_dy };
    return { dx: 0, dy: 0 };
}

function getDashAngle() {
    if (!isMobile && !gamepadActive) return getMouseAngle();
    const { dx, dy } = getDirectionalInput();
    const isMoving = (Math.abs(dx) > 0.1) || (Math.abs(dy) > 0.1);
    if (isMoving) return Math.atan2(dy, dx);
    return me ? Math.atan2(me.vy || 0, me.vx || 1) : 0;
}

function getClosestEnemyAngle(maxRange = 8) {
    if (!me || !state.mb) return null;
    let closestEnemy = null, minDistSq = Infinity;
    Object.values(state.mb).forEach(m => {
        if (m.ai === "static" || m.ai === "npc" || m.ai === "resource" || m.hp <= 0) return;
        const dx = m.x - me.x, dy = m.y - me.y, distSq = dx * dx + dy * dy;
        if (distSq < minDistSq && distSq < maxRange * maxRange) { minDistSq = distSq; closestEnemy = m; }
    });
    return closestEnemy ? Math.atan2(closestEnemy.y - me.y, closestEnemy.x - me.x) : null;
}

function getAttackAngle() {
    if (!isMobile && !gamepadActive) return getMouseAngle();
    const closestAngle = getClosestEnemyAngle(8); 
    if (closestAngle !== null) return closestAngle;
    const { dx, dy } = getDirectionalInput();
    const isMoving = (Math.abs(dx) > 0.1) || (Math.abs(dy) > 0.1);
    if (isMoving) return Math.atan2(dy, dx);
    if (me && (me.vx !== 0 || me.vy !== 0)) return Math.atan2(me.vy, me.vx);
    return 0; 
}

const chatInput = document.getElementById("chat-input");
const btnChatMobile = document.getElementById("btn-chat-mobile");
if (btnChatMobile) {
    btnChatMobile.onclick = () => {
        if (uiState.chat) return;
        uiState.chat = true;
        const container = document.getElementById("chat-container");
        container.style.display = "block";
        setTimeout(() => { chatInput.focus(); }, 100);
        sendInput();
    };
}

chatInput.onkeydown = (e) => {
    if (e.key === "Enter") {
        const msg = chatInput.value.trim();
        if (msg.length > 0) socket.emit("chat", msg.substring(0, 30));
        closeChat();
    }
};

function closeChat() {
    chatInput.value = "";
    uiState.chat = false;
    document.getElementById("chat-container").style.display = "none";
    chatInput.blur();
    document.activeElement.blur?.();
    setTimeout(() => { canvas.focus(); sendInput(); }, 50);
}

chatInput.onblur = () => { if (uiState.chat) closeChat(); };

window.onkeydown = e => {
    if (document.getElementById("menu").style.display !== "none") return;
    let k=e.key.toLowerCase();
    
    if(k === "enter") {
        if (uiState.chat) { return; } 
        if(uiState.inv || uiState.char || uiState.shop || uiState.craft) { handleGamepadAction(); } 
        else {
            uiState.chat = true;
            document.getElementById("chat-container").style.display = "block";
            setTimeout(()=>chatInput.focus(), 10);
            sendInput();
        }
        return;
    }
    
    if (uiState.chat && k !== "escape") return;

    if (uiState.inv || uiState.char || uiState.shop || uiState.craft) {
        if (k === 'arrowup' || k === 'w') { handleGamepadNavigation('up'); e.preventDefault(); return; }
        if (k === 'arrowdown' || k === 's') { handleGamepadNavigation('down'); e.preventDefault(); return; }
        if (k === 'arrowleft' || k === 'a') { handleGamepadNavigation('left'); e.preventDefault(); return; }
        if (k === 'arrowright' || k === 'd') { handleGamepadNavigation('right'); e.preventDefault(); return; }
    }

    if(keys.hasOwnProperty(k)){ keys[k]=true; sendInput(); }
    if(k==="i") { uiState.inv = !uiState.inv; uiState.char=false; uiState.shop=false; uiState.craft=false; }
    if(k==="c") { uiState.char = !uiState.char; uiState.inv=false; uiState.shop=false; uiState.craft=false; }
    if(k==="k") { uiState.craft = !uiState.craft; uiState.inv=false; uiState.char=false; uiState.shop=false; }
    if(k==="escape") closeAllMenus();
    if(k===" ") socket.emit("dash", getDashAngle());
    if(k==="e") socket.emit("potion");
    
    if (k === 'i' || k === 'c' || k === 'k' || k === 'escape') {
        if (uiState.inv || uiState.char || uiState.shop || uiState.craft) {
             focusIndex = 0;
             focusArea = uiState.inv ? 'inventory' : uiState.char ? 'equipment' : uiState.shop ? 'shop' : 'craft';
        } else {
             hideTooltip();
        }
    }
    updateUI();
};
window.onkeyup = e => { let k=e.key.toLowerCase(); if(keys.hasOwnProperty(k)){ keys[k]=false; sendInput(); } };
window.onmousemove = e => { 
    mouse.x=e.clientX; 
    mouse.y=e.clientY; 
    if (!isMobile && !gamepadActive) {
        tooltip.style.left = (mouse.x+15)+"px"; 
        tooltip.style.top = (mouse.y+15)+"px"; 
    }
};

window.onmousedown = (e) => {
    if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume();
    AudioCtrl.init();

    if (!me || uiState.chat || gamepadActive || document.getElementById("menu").style.display !== "none") return;

    const isPanel = (id) => {
        const el = document.getElementById(id);
        if (!el || el.style.display !== "block") return false;
        const r = el.getBoundingClientRect();
        return (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
    };

    if (isPanel("inventory") || isPanel("char-panel") || isPanel("shop-panel") || isPanel("craft-panel")) return;

    const ang = getAttackAngle();
    if (e.button === 0) socket.emit("attack", ang);
    if (e.button === 2) socket.emit("skill", { idx: 1, angle: ang });
};

// ----------------------------------------------------
// JOYSTICK & TOUCH HANDLERS
// ----------------------------------------------------
let joystick = { active: false, id: null, startX: 0, startY: 0, currentX: 0, currentY: 0, normX: 0, normY: 0, radius: 50, knob: document.getElementById('joystick-knob') };
const JOYSTICK_AREA_EL = document.getElementById('joystick-area');

const handleTouchStart = (e) => {
    if (gamepadActive) return;
    if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume(); AudioCtrl.init();
    if (uiState.chat || document.getElementById("menu").style.display !== "none") return;
    
    const joystickRect = JOYSTICK_AREA_EL.getBoundingClientRect();

    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]; const target = touch.target; const id = touch.identifier; 
        let processed = false;

        if (target === JOYSTICK_AREA_EL && !joystick.active) {
            joystick.active = true; joystick.id = id;
            const areaCenterX = joystickRect.left + joystickRect.width / 2;
            const areaCenterY = joystickRect.top + joystickRect.height / 2;
            joystick.startX = areaCenterX; joystick.startY = areaCenterY;
            joystick.knob.style.display = 'block';
            joystick.knob.style.left = (joystickRect.width / 2 - 20) + 'px';
            joystick.knob.style.top = (joystickRect.height / 2 - 20) + 'px';
            handleTouchMove(e); processed = true;
        } 
        else if (target.closest('.action-btn')) {
            const action = target.closest('.action-btn').dataset.action;
            const ang = getAttackAngle(); 
            if (action === "attack") socket.emit("attack", ang); 
            else if (action === "skill") socket.emit("skill", {idx:1, angle:ang}); 
            else if (action === "dash") socket.emit("dash", getDashAngle()); 
            else if (action === "potion") socket.emit("potion");
            else if (action === "block") keys.q = !keys.q; sendInput();
            processed = true;
        }
        else if (target.closest('#btn-inv-mobile')) { uiState.inv = !uiState.inv; uiState.char = false; uiState.craft = false; updateUI(); processed = true; } 
        else if (target.closest('#btn-char-mobile')) { uiState.char = !uiState.char; uiState.inv = false; uiState.craft = false; updateUI(); processed = true; } 
        else if (target.closest('#btn-craft-mobile')) { uiState.craft = !uiState.craft; uiState.inv = false; uiState.char = false; updateUI(); processed = true; } 
        
        if (processed) e.preventDefault();
    }
};

const handleTouchMove = (e) => {
    if (!joystick.active) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joystick.id) {
            joystick.currentX = touch.clientX; joystick.currentY = touch.clientY;
            let dx = joystick.currentX - joystick.startX; let dy = joystick.currentY - joystick.startY;
            let dist = Math.hypot(dx, dy);
            if (dist > joystick.radius) { dx = (dx / dist) * joystick.radius; dy = (dy / dist) * joystick.radius; dist = joystick.radius; }
            const deadzone = joystick.radius * 0.1;
            if (dist < deadzone) { joystick.normX = 0; joystick.normY = 0; } else { joystick.normX = dx / joystick.radius; joystick.normY = dy / joystick.radius; }
            joystick.knob.style.transform = `translate(${dx}px, ${dy}px)`;
            sendInput(); e.preventDefault(); return;
        }
    }
};

const handleTouchEnd = (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === joystick.id) {
            joystick.active = false; joystick.id = null; joystick.normX = 0; joystick.normY = 0;
            joystick.knob.style.display = 'none'; joystick.knob.style.transform = 'translate(0, 0)';
            sendInput(); return;
        }
    }
};

document.addEventListener('touchstart', handleTouchStart, { passive: false });
document.addEventListener('touchmove', handleTouchMove, { passive: false });
document.addEventListener('touchend', handleTouchEnd); 
document.addEventListener('touchcancel', handleTouchEnd);


// ----------------------------------------------------
// GAMEPAD & NAVIGATION
// ----------------------------------------------------
let lastNavTimestamp = 0; const NAV_DELAY = 150;
function handleGamepadNavigation(direction) {
    if (Date.now() - lastNavTimestamp < NAV_DELAY) return;
    let elements = [], cols = 8, maxIndex = 0;
    
    if (uiState.inv) { elements = Array.from(document.querySelectorAll('#inv-grid .slot')); cols = 8; focusArea = 'inventory'; } 
    else if (uiState.char) {
        const eq_slots = Array.from(document.querySelectorAll('.equip-slots .slot')); 
        const stat_btns = Array.from(document.querySelectorAll('.stat-row .plus-btn')); 
        elements = eq_slots.concat(stat_btns); cols = 5; focusArea = 'equipment';
    } 
    else if (uiState.craft) {
        elements = Array.from(document.querySelectorAll('#craft-list .craft-item')); cols = 1; focusArea = 'craft';
        let newIndex = focusIndex;
        if (direction === 'up') newIndex = Math.max(0, focusIndex - 1);
        else if (direction === 'down') newIndex = Math.min(elements.length - 1, focusIndex + 1);
        focusIndex = newIndex; updateUI(); lastNavTimestamp = Date.now(); return; 
    }
    else if (uiState.shop) {
        elements = Array.from(document.querySelectorAll('#shop-grid .slot')); cols = 5; focusArea = 'shop';
        let newIndex = focusIndex;
        if (direction === 'left') newIndex--; else if (direction === 'right') newIndex++; 
        else if (direction === 'up') newIndex -= cols; else if (direction === 'down') newIndex += cols;
        focusIndex = Math.max(0, Math.min(newIndex, elements.length - 1)); updateUI(); lastNavTimestamp = Date.now(); return; 
    }
    else { return; } 

    maxIndex = elements.length - 1; if (elements.length === 0) { focusIndex = 0; updateUI(); lastNavTimestamp = Date.now(); return; }
    let newIndex = focusIndex; 

    if (uiState.inv) {
        if (direction === 'left') newIndex--; else if (direction === 'right') newIndex++; 
        else if (direction === 'up') newIndex -= cols; else if (direction === 'down') newIndex += cols;
    } else if (uiState.char) {
        if (focusIndex <= 4) {
            if (direction === 'left') newIndex = Math.max(0, newIndex - 1);
            else if (direction === 'right') newIndex = Math.min(4, newIndex + 1);
            else if (direction === 'down') newIndex = 5; 
        } else if (focusIndex >= 5 && focusIndex <= 7) {
            if (direction === 'up') newIndex = (newIndex === 5) ? 4 : newIndex - 1; 
            else if (direction === 'down') newIndex = Math.min(7, newIndex + 1);
        }
    }
    newIndex = Math.max(0, Math.min(newIndex, maxIndex));
    focusIndex = newIndex; updateUI(); lastNavTimestamp = Date.now();
}

function closeAllMenus() {
    uiState.inv=false; uiState.char=false; uiState.shop=false; uiState.craft=false;
    hideTooltip();
    updateUI();
}

function handleGamepadAction() {
    if (!me || !(uiState.inv || uiState.char || uiState.shop || uiState.craft)) return;
    if (uiState.char) {
        const eq_slots = ["head", "body", "hand", "rune", "potion"];
        if (focusIndex >= 0 && focusIndex <= 4) { 
            const slotName = eq_slots[focusIndex];
            if (slotName === "potion") socket.emit("potion"); else if (me.equipment[slotName]) socket.emit("unequip", slotName);
        } else if (focusIndex >= 5 && focusIndex <= 7) {
            const statNames = ['str', 'dex', 'int'];
            if (me.pts > 0) socket.emit("add_stat", statNames[focusIndex - 5]);
        }
    } else if (uiState.inv && me.inventory.length > 0) {
        const item = me.inventory[focusIndex];
        if (item) { 
            if (item.key === "potion") socket.emit("potion");
            else if (item.slot && item.type !== "material" && item.type !== "consumable" && item.type !== "key") socket.emit("equip", focusIndex);
        }
    } else if (uiState.craft && recipes.length > 0) { 
        socket.emit("craft", {action:"create", recipeIdx: focusIndex});
    } else if (uiState.shop && shopItems.length > 0) {
        window.buy(focusIndex);
    }
    updateUI();
}

function handleGamepadSecondaryAction() { 
    if (!me) return;
    if (uiState.inv && me.inventory.length > 0) {
        socket.emit("drop", focusIndex); if (focusIndex > 0) focusIndex = Math.max(0, focusIndex - 1);
    } else if (uiState.shop) {
        if (focusArea === 'inventory' && me.inventory.length > 0 && focusIndex < me.inventory.length) {
            socket.emit("sell", focusIndex); if (focusIndex > 0) focusIndex = Math.max(0, focusIndex - 1);
        } else closeAllMenus();
    } else closeAllMenus();
    updateUI(); 
}

let lastButtons = {};
function handleGamepadInput() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : []; gamepad = gamepads[0]; 
    if (!gamepad) { gamepadActive = false; return; }
    gamepadActive = true; gamepad = navigator.getGamepads()[gamepad.index];
    const stickX = gamepad.axes[0] || 0; const stickY = gamepad.axes[1] || 0; const deadzone = 0.3;
    
    keys.game_x = (Math.abs(stickX) > deadzone) ? stickX : 0; keys.game_y = (Math.abs(stickY) > deadzone) ? stickY : 0;
    if (gamepad.buttons[14]?.pressed) keys.game_x = -1; if (gamepad.buttons[15]?.pressed) keys.game_x = 1;  
    if (gamepad.buttons[12]?.pressed) keys.game_y = -1; if (gamepad.buttons[13]?.pressed) keys.game_y = 1;  
    sendInput(); 
    
    const processButton = (buttonIndex, action) => {
        const button = gamepad.buttons[buttonIndex]; const isPressed = button?.pressed; const wasPressed = lastButtons[buttonIndex] || false;
        if (action === 'block') keys.q = isPressed; 
        if (isPressed && !wasPressed) {
            if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume();
            if (uiState.inv || uiState.char || uiState.shop || uiState.craft) {
                if (action === 'attack') handleGamepadAction(); if (action === 'skill') handleGamepadSecondaryAction(); 
            } else {
                const ang = getAttackAngle(); 
                if (action === 'attack') socket.emit("attack", ang); if (action === 'skill') socket.emit("skill", {idx:1, angle:ang});
                if (action === 'dash') socket.emit("dash", getDashAngle()); if (action === 'potion') socket.emit("potion"); 
            }
            if (action === 'inventory') { uiState.inv = !uiState.inv; uiState.char = false; uiState.shop = false; uiState.craft = false; }
            if (action === 'character') { uiState.char = !uiState.char; uiState.inv = false; uiState.shop = false; uiState.craft = false; }
            if (action === 'craft') { uiState.craft = !uiState.craft; uiState.inv = false; uiState.char = false; uiState.shop = false; }
            if (action === 'inventory' || action === 'character' || action === 'craft') { focusIndex = 0; focusArea = (uiState.inv ? 'inventory' : uiState.char ? 'equipment' : uiState.craft ? 'craft' : 'none'); }
            updateUI();
        }
        lastButtons[buttonIndex] = isPressed;
    };
    
    processButton(0, 'attack'); processButton(1, 'skill'); processButton(2, 'block'); 
    processButton(3, 'dash'); processButton(4, 'potion'); processButton(5, 'craft'); 
    processButton(9, 'inventory'); processButton(8, 'character'); 
    
    if (uiState.inv || uiState.char || uiState.shop || uiState.craft) {
        if (gamepad.buttons[12]?.pressed && !lastButtons[12]) handleGamepadNavigation('up');
        if (gamepad.buttons[13]?.pressed && !lastButtons[13]) handleGamepadNavigation('down');
        if (gamepad.buttons[14]?.pressed && !lastButtons[14]) handleGamepadNavigation('left');
        if (gamepad.buttons[15]?.pressed && !lastButtons[15]) handleGamepadNavigation('right');
        if (Math.abs(stickY) > deadzone && Math.abs(stickY) > Math.abs(stickX)) {
             if (stickY < 0 && (!lastNavTimestamp || Date.now() - lastNavTimestamp > NAV_DELAY)) handleGamepadNavigation('up');
             else if (stickY > 0 && (!lastNavTimestamp || Date.now() - lastNavTimestamp > NAV_DELAY)) handleGamepadNavigation('down');
        } else if (Math.abs(stickX) > deadzone && Math.abs(stickX) > Math.abs(stickY)) {
             if (stickX < 0 && (!lastNavTimestamp || Date.now() - lastNavTimestamp > NAV_DELAY)) handleGamepadNavigation('left');
             else if (stickX > 0 && (!lastNavTimestamp || Date.now() - lastNavTimestamp > NAV_DELAY)) handleGamepadNavigation('right');
        }
        lastButtons[12] = gamepad.buttons[12]?.pressed; lastButtons[13] = gamepad.buttons[13]?.pressed; 
        lastButtons[14] = gamepad.buttons[14]?.pressed; lastButtons[15] = gamepad.buttons[15]?.pressed;
    }
}

function renderCrafting() {
    const list = document.getElementById("craft-list"); list.innerHTML = "";
    recipes.forEach((r, idx) => {
        const d = document.createElement("div"); d.className = "craft-item";
        d.innerHTML = `<span style="color:#fff">${r.res.toUpperCase()}</span> <br> <small style="color:#aaa">Wood:${r.req.wood} Stone:${r.req.stone}</small>`;
        d.onclick = () => socket.emit("craft", {action:"create", recipeIdx:idx});
        list.appendChild(d);
    });
}

function getIcon(it) {
    if (!it || !it.key) return "❓"; 
    const key = it.key;
    
    // CORREÇÃO: Hash determinístico baseado no ID para evitar que o ícone pisque
    let seed = 0;
    if(it.id) {
        for(let i=0; i<it.id.length; i++) seed += it.id.charCodeAt(i);
    }
    const pick = (arr) => arr[seed % arr.length];

    if(key.includes("sword")) return pick(["🗡️", "⚔️", "🔪"]);
    if(key.includes("axe")) return pick(["🪓", "⚒️", "⛏️"]);
    if(key.includes("dagger")) return pick(["🗡️", "🔪", "✂️"]);
    if(key.includes("bow")) return "🏹"; 
    if(key.includes("staff")) return "🪄"; 
    if(key.includes("helm")) return "🪖"; 
    if(key.includes("armor")) return "👕"; 
    if(key.includes("potion")) return "🧪"; 
    if(key.includes("wood")) return "🪵";
    if(key.includes("stone")) return "🪨"; 
    if(key.includes("ruby")) return "💎"; 
    if(key.includes("sapphire")) return "🔹"; 
    if(key.includes("emerald")) return "🟩"; 
    if(key.includes("diamond")) return "⚪"; 
    if(key.includes("topaz")) return "🔶"; 
    if(key.includes("amethyst")) return "🟣"; 
    if(key.includes("runa")) return "⚛️";
    if(key.includes("key")) return "🔑";
    return "📦";
}

function updateUI() {
    if(!me && state.pl && myId) me = state.pl[myId];
    if(!me || !me.stats) return;

    const maxHp = me.stats.maxHp || 100;
    const maxMp = me.stats.maxMp || 50;
    
    const hpPct = (me.hp / maxHp) * 100; 
    const mpPct = (me.mp / maxMp) * 100; 
    const xpPct = (me.xp / ((me.level+1)*100)) * 100;
    
    let diffName = "NORMAL";
    if (state.theme === "#444") diffName = "SAFE ZONE";
    else if (state.theme === "#f00") diffName = "HORDE I";
    else if (state.theme === "#900") diffName = "HORDE II";
    else if (state.theme === "#102") diffName = "HELL";
    else if (state.theme === "#311") diffName = "NIGHTMARE";

    const elHpBar = document.getElementById("hp-bar");
    const elMpBar = document.getElementById("mp-bar");
    const elXpBar = document.getElementById("xp-bar");

    if(elHpBar) elHpBar.style.width = hpPct + "%"; 
    if(elMpBar) elMpBar.style.width = mpPct + "%"; 
    if(elXpBar) elXpBar.style.width = xpPct + "%";
    
    document.getElementById("hp-txt").innerText = `HP: ${Math.floor(me.hp)}/${maxHp}`; 
    document.getElementById("mp-txt").innerText = `MP: ${Math.floor(me.mp)}/${maxMp}`; 
    document.getElementById("xp-txt").innerText = `${Math.floor(xpPct)}%`; 
    document.getElementById("lvl-txt").innerText = `${diffName} [${me.level}]`;
    
    const hLvlTxt = document.getElementById("h-lvl-txt"); if(hLvlTxt) hLvlTxt.innerText = `${diffName} [${me.level}]`; 
    const hGoldTxt = document.getElementById("h-gold-txt"); if(hGoldTxt) hGoldTxt.innerText = `${me.gold || 0}G`;
    const hHpBar = document.getElementById("h-hp-bar"); if(hHpBar) hHpBar.style.width = hpPct + "%"; 
    const hMpBar = document.getElementById("h-mp-bar"); if(hMpBar) hMpBar.style.width = mpPct + "%"; 
    const hXpBar = document.getElementById("h-xp-bar"); if(hXpBar) hXpBar.style.width = xpPct + "%";

    document.getElementById("cp-pts").innerText = me.pts || 0;
    
    const attrs = me.attrs || {str:0, dex:0, int:0};
    document.getElementById("val-str").innerText = attrs.str; 
    document.getElementById("val-dex").innerText = attrs.dex; 
    document.getElementById("val-int").innerText = attrs.int;
    
    document.getElementById("stat-dmg").innerText = (me.stats.dmg || 0) + ` (CRIT: ${Math.floor((me.stats.crit || 0.01)*100)}%)`; 
    document.getElementById("stat-spd").innerText = Math.floor((me.stats.spd || 0)*100);
    document.getElementById("hud-gold").innerText = "GOLD: " + (me.gold || 0);

    const uiActionButtons = document.getElementById("ui-action-buttons");
    if (uiState.inv || uiState.char || uiState.shop || uiState.craft) { 
        if(uiActionButtons) uiActionButtons.style.display = 'flex'; 
    } else { 
        if(uiActionButtons) uiActionButtons.style.display = 'none'; 
        hideTooltip(); 
    }

    document.getElementById("inventory").style.display = uiState.inv ? "block" : "none";
    document.getElementById("char-panel").style.display = uiState.char ? "block" : "none";
    document.getElementById("shop-panel").style.display = uiState.shop ? "block" : "none";
    document.getElementById("craft-panel").style.display = uiState.craft ? "block" : "none";

    const eq_slots = ["head","body","hand","rune","potion"];
    eq_slots.forEach((slot, index) => {
        const el = document.getElementById("eq-"+slot); if (!el) return; 
        el.innerHTML = ""; el.style.outline = 'none';
        
        const isSelected = (uiState.char && focusArea === 'equipment' && focusIndex === index);
        if (isSelected) { 
            el.style.outline = '2px solid yellow'; 
            if (me.equipment && me.equipment[slot]) showTooltip(me.equipment[slot], el); 
            else { hideTooltip(); }
            const equipBtn = document.getElementById('ui-btn-equip');
            if(equipBtn) equipBtn.innerText = slot==='potion'?'USAR (A)':'DESEQUIPAR (A)';
        }
        
        if(me.equipment && me.equipment[slot]) {
            const it = me.equipment[slot];
            el.style.borderColor = it.color; el.innerHTML = getIcon(it); 
            el.onclick = (e) => {
                // CORREÇÃO PC: Ação direta no clique
                if (!isMobile && !gamepadActive) { 
                    slot === 'potion' ? socket.emit("potion") : socket.emit("unequip", slot); 
                    return; 
                }
                
                if (focusIndex === index && focusArea === 'equipment') { slot === 'potion' ? socket.emit("potion") : socket.emit("unequip", slot); }
                else { focusIndex = index; focusArea = 'equipment'; updateUI(); }
            };
            if (!isMobile && !gamepadActive) { 
                el.onmouseover = () => { showTooltip(it, el); focusIndex = index; focusArea = 'equipment'; el.style.outline = '2px solid yellow'; }; 
                el.onmouseout = () => { hideTooltip(); el.style.outline = 'none'; }; 
            }
        } else { 
            el.style.borderColor = "#0f0"; el.onclick=null; 
        }
    });
    
    const stat_btns = ['str', 'dex', 'int'];
    stat_btns.forEach((stat, index) => {
        const btn = document.getElementById("btn-"+stat);
        const globalIndex = index + 5;
        if(btn) btn.style.outline = 'none';
        if (uiState.char && focusArea === 'equipment' && focusIndex === globalIndex) {
             if(btn) btn.style.outline = '2px solid yellow'; hideTooltip();
             const equipBtn = document.getElementById('ui-btn-equip');
             if(equipBtn) equipBtn.innerText = `ADD ${stat.toUpperCase()} (A)`;
        }
    });
    
    const ig = document.getElementById("inv-grid"); ig.innerHTML = "";
    if (uiState.inv && focusArea === 'inventory' && me.inventory.length > 0 && focusIndex >= me.inventory.length) focusIndex = Math.max(0, me.inventory.length - 1);

    if(me.inventory) {
        me.inventory.forEach((it, idx) => {
            if (!it) return;
            const d = document.createElement("div"); d.className = "slot"; d.style.borderColor = it.color; d.style.outline = 'none';
            
            const isSelected = (uiState.inv && focusArea === 'inventory' && focusIndex === idx);
            if (isSelected) {
                d.style.outline = '2px solid yellow'; showTooltip(it, d); 
                const equipBtn = document.getElementById('ui-btn-equip');
                const dropBtn = document.getElementById('ui-btn-drop');
                if (it.key === 'potion' && equipBtn) equipBtn.innerText = 'USAR POÇÃO (A)';
                else if (it.slot && equipBtn) equipBtn.innerText = 'EQUIPAR (A)';
                else if (equipBtn) equipBtn.innerText = 'ITEM DE CRAFT';
                if(dropBtn) dropBtn.innerText = 'DROPAR (B)';
            } 
            
            d.innerHTML = getIcon(it);
            if(it.sockets && it.sockets.length > 0) {
                const socks = document.createElement("div"); socks.style.cssText="position:absolute;bottom:0;right:0;display:flex;";
                it.sockets.forEach((s, i) => { const dot = document.createElement("div"); dot.style.cssText=`width:4px;height:4px;background:${it.gems[i]?it.gems[i].color:"#222"};border:1px solid #555;margin-right:1px;`; socks.appendChild(dot); });
                d.appendChild(socks);
            }
            
            d.onclick = (e) => {
                e.preventDefault(); e.stopPropagation();
                // CORREÇÃO PC: Ação direta no clique
                if (!isMobile && !gamepadActive) {
                    if (it.key === "potion") socket.emit("potion");
                    else if (it.slot && it.type !== "material" && it.type !== "gem" && it.type !== "key") socket.emit("equip", idx);
                    focusIndex = idx; focusArea = 'inventory';
                    return;
                }

                if (focusIndex === idx && focusArea === 'inventory') {
                    if (it.key === "potion") socket.emit("potion");
                    else if (it.slot && it.type !== "material" && it.type !== "gem") socket.emit("equip", idx);
                } else { focusIndex = idx; focusArea = 'inventory'; updateUI(); }
            };
            
            d.draggable = true; d.ondragstart = (e) => { dragItem = { idx, item: it }; }; d.ondragover = (e) => e.preventDefault();
            d.ondrop = (e) => { e.preventDefault(); if(dragItem && dragItem.item.type === "gem" && it.type !== "gem") socket.emit("craft", {action:"socket", itemIdx:idx, gemIdx:dragItem.idx}); };
            
            if (!isMobile) { 
                d.onmouseover = () => { focusIndex = idx; focusArea = 'inventory'; showTooltip(it, d); d.style.outline = '2px solid yellow'; }; 
                d.onmouseout = () => { hideTooltip(); d.style.outline = 'none'; }; 
            }
            d.oncontextmenu = (e) => { e.preventDefault(); socket.emit("drop", idx); };
            ig.appendChild(d);
        });
    }

    if (uiState.craft) {
        const craftList = document.getElementById("craft-list");
        if(craftList) {
            Array.from(craftList.children).forEach((d, idx) => {
                d.style.outline = 'none';
                if (focusArea === 'craft' && focusIndex === idx) { d.style.outline = '2px solid yellow'; }
            });
        }
    }
    
    if(uiState.shop) {
        const sg = document.getElementById("shop-grid"); sg.innerHTML = "";
        shopItems.forEach((it, idx) => {
            const d = document.createElement("div"); d.className = "slot"; d.style.borderColor = it.color; d.style.outline = 'none';
            if (focusArea === 'shop' && focusIndex === idx) { d.style.outline = '2px solid yellow'; showTooltip(it, d); }
            d.innerHTML = getIcon(it); 
            d.onclick = () => { socket.emit("buy", idx); };
            if (!isMobile && !gamepadActive) { 
                d.onmouseover = () => { focusIndex = idx; focusArea = 'shop'; showTooltip(it, d); d.style.outline = '2px solid yellow'; }; 
                d.onmouseout = () => { hideTooltip(); d.style.outline = 'none'; }; 
            }
            sg.appendChild(d);
        });
        const closeShopBtn = document.getElementById("btn-shop-close");
        if(closeShopBtn) closeShopBtn.onclick = closeAllMenus;
    }
    
    if ((uiState.inv && (!me.inventory || me.inventory.length === 0))) { 
        hideTooltip(); 
        const equipBtn = document.getElementById('ui-btn-equip');
        if(equipBtn) equipBtn.innerText = 'VAZIO'; 
    } 
}

function showTooltip(it, elementRef) {
    if (!it) return;
    let html = `<b style="color:${it.color}">${it.name}</b><br><span style="color:#aaa">${(it.type || "UNKNOWN").toUpperCase()}</span>`;
    if(it.desc) html += `<br><span style="color:#ff0">${it.desc}</span>`;
    if(it.price) html += `<br>Price: ${it.price}G`;
    const isSellable = (uiState.inv || uiState.shop) && it.key !== 'gold';
    if (isSellable) html += `<br><span style="color:#fff">Sell Value: ${Math.floor((it.price || 1) * 0.5)}G</span>`;
    if(it.stats) { for(let k in it.stats) { 
        if(k==="crit") html += `<br>Crit: ${Math.floor(it.stats[k]*100)}%`; else if(k==="spd" && it.stats[k] > 0.01) html += `<br>Spd: +${Math.floor(it.stats[k]*100)}%`; else if (k !== "spd") html += `<br>${k.toUpperCase()}: ${it.stats[k]}`; 
    } }
    if(it.sockets) { html += `<br><br>GEMS [${it.gems.length}/${it.sockets.length}]`; it.gems.forEach(g => html += `<br><span style="color:${g.color}">* ${g.desc}</span>`); }
    tooltip.innerHTML = html; tooltip.style.display = "block";

    if ((isMobile || gamepadActive) && elementRef) {
        const rect = elementRef.getBoundingClientRect();
        let top = rect.top - tooltip.offsetHeight - 10;
        if (top < 0) top = rect.bottom + 10;
        let left = rect.left + (rect.width - tooltip.offsetWidth) / 2;
        if (left < 10) left = 10;
        if (left + tooltip.offsetWidth > window.innerWidth) left = window.innerWidth - tooltip.offsetWidth - 10;
        tooltip.style.top = top + "px";
        tooltip.style.left = left + "px";
    }
}
function hideTooltip() { tooltip.style.display = "none"; }

function drawAura(x, y, color, intensity) {
    ctx.shadowBlur = intensity; ctx.shadowColor = color; ctx.fillStyle = color; ctx.globalAlpha = 0.2;
    ctx.beginPath(); ctx.arc(x, y, 10 + Math.sin(Date.now()/200)*2, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1.0; ctx.shadowBlur = 0;
}

let fogPattern = null;
function createFogPattern() {
    const size = 32; const tempCanvas = document.createElement('canvas'); tempCanvas.width = size; tempCanvas.height = size;
    const tempCtx = tempCanvas.getContext('2d'); tempCtx.fillStyle = 'rgba(0, 0, 0, 0.4)'; tempCtx.fillRect(0, 0, size, size);
    for (let i = 0; i < size * size * 0.1; i++) { const x = Math.random() * size; const y = Math.random() * size; tempCtx.fillStyle = `rgba(0, 15, 0, ${Math.random() * 0.1 + 0.05})`; tempCtx.fillRect(x, y, 1, 1); }
    fogPattern = ctx.createPattern(tempCanvas, 'repeat');
}

function drawOffscreenPlayerIndicators() {
    if (!me || !state.pl) return;
    const screenCenterX = canvas.width / 2; const screenCenterY = canvas.height / 2;
    const indicatorRadius = Math.min(screenCenterX, screenCenterY) - 20; const indicatorSize = 8;
    const ox = -cam.x, oy = -cam.y;
    Object.values(state.pl).filter(p => p.id !== myId).forEach(p => {
        const playerScreenX = ox + p.x * SCALE + SCALE/2; const playerScreenY = oy + p.y * SCALE + SCALE/2;
        const dx = playerScreenX - screenCenterX; const dy = playerScreenY - screenCenterY;
        if (dx * dx + dy * dy < indicatorRadius * indicatorRadius) return;
        const angle = Math.atan2(dy, dx);
        let ix = screenCenterX + Math.cos(angle) * indicatorRadius; let iy = screenCenterY + Math.sin(angle) * indicatorRadius;
        ctx.save(); ctx.translate(ix, iy); ctx.rotate(angle); 
        ctx.fillStyle = "#0ff"; ctx.shadowBlur = 5; ctx.shadowColor = "#0ff";
        ctx.beginPath(); ctx.moveTo(indicatorSize, 0); ctx.lineTo(-indicatorSize, -indicatorSize); ctx.lineTo(-indicatorSize, indicatorSize); ctx.closePath(); ctx.fill();
        ctx.font = "8px Courier New"; ctx.textAlign = "center"; ctx.fillText(p.name, 0, -indicatorSize - 2); 
        ctx.restore(); ctx.shadowBlur = 0;
    });
}

function draw() {
    requestAnimationFrame(draw);
    handleGamepadInput();
    
    const mobileControls = document.getElementById("mobile-controls"); 
    const mobileHorizontalHud = document.getElementById("hud-horizontal-mobile");
    const hudGold = document.getElementById("hud-gold");
    const hudBottom = document.querySelector('.hud-bottom');
    const gameLogContainer = document.getElementById("game-log-container");
    
    if(isMobile) {
        const btnChatMobile = document.getElementById("btn-chat-mobile");
        if (btnChatMobile) btnChatMobile.style.display = isMobile ? "block" : "none";
        if(mobileHorizontalHud) mobileHorizontalHud.style.display = "flex"; 
        if(hudBottom) hudBottom.style.display = "none"; 
        if(gameLogContainer) gameLogContainer.style.display = "block"; // Exibir no mobile (CSS ajusta posição)
        if (mobileControls) {
            if (!gamepadActive) { mobileControls.style.display = "block"; if(hudGold) hudGold.style.display = "none"; } 
            else { mobileControls.style.display = "none"; if(hudGold) hudGold.style.display = "block"; }
        }
    } else { 
        if(mobileControls) mobileControls.style.display = "none"; 
        if(mobileHorizontalHud) mobileHorizontalHud.style.display = "none"; 
        if(hudBottom) hudBottom.style.display = "flex";
        if(hudGold) hudGold.style.display = "block"; 
        if(gameLogContainer) gameLogContainer.style.display = "block"; 
    }

    ctx.fillStyle = "#000"; ctx.fillRect(0,0,canvas.width,canvas.height);
    
    // CORREÇÃO: Feedback Visual de Conexão
    if(!me) {
        ctx.fillStyle = "#0f0";
        ctx.font = "16px Courier New";
        ctx.textAlign = "center";
        ctx.fillText("CONNECTING TO SERVER...", canvas.width/2, canvas.height/2);
        return;
    }

    cam.x += (me.x*SCALE - canvas.width/2 - cam.x)*0.2; cam.y += (me.y*SCALE - canvas.height/2 - cam.y)*0.2;
    if (cameraShake > 0) {
        cam.x += (Math.random() - 0.5) * cameraShake;
        cam.y += (Math.random() - 0.5) * cameraShake;
        cameraShake *= 0.85;
        if (cameraShake < 0.5) cameraShake = 0;
    }
    const ox = -cam.x, oy = -cam.y; const now = Date.now();
    const lightRadiusPixels = state.lightRadius * SCALE;
    const playerScreenX = ox + me.x * SCALE + SCALE/2; const playerScreenY = oy + me.y * SCALE + SCALE/2;

    const map = state.map; const explored = state.explored || []; 
    const theme = state.theme || "#222";
    const isCity = state.theme === "#444"; 

    if(map && map.length){
        const sy=Math.floor(cam.y/SCALE), ey=sy+Math.ceil(canvas.height/SCALE)+1; const sx=Math.floor(cam.x/SCALE), ex=sx+Math.ceil(canvas.width/SCALE)+1;
        for(let y=sy; y<ey; y++){ 
            if(!map[y]) continue; 
            for(let x=sx; x<ex; x++){ 
                if(map[y][x]===0) { 
                    if (isCity) {
                        ctx.fillStyle="#333";
                        ctx.fillRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE);
                        if((x+y)%2===0) { ctx.fillStyle="#3a3a3a"; ctx.fillRect(ox+x*SCALE+4, oy+y*SCALE+4, 8, 8); }
                    } else {
                        ctx.fillStyle="#080808"; 
                        ctx.fillRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE); 
                        if((x+y)%3===0) { ctx.fillStyle=theme; ctx.fillRect(ox+x*SCALE+6, oy+y*SCALE+6, 2, 2); } 
                    }
                } else if(map[y][x]===1) { 
                    if (isCity) {
                        ctx.fillStyle="#222";
                        ctx.fillRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE);
                        ctx.strokeStyle="#555";
                        ctx.strokeRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE);
                    } else {
                        ctx.fillStyle="#000"; 
                        ctx.fillRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE); 
                        ctx.strokeStyle=theme; ctx.strokeRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE); 
                    }
                } 
            } 
        }
    }
    
    if(state.props) state.props.forEach(p => { 
        const px=ox+p.x*SCALE, py=oy+p.y*SCALE; 
        if(p.type==="rock") { ctx.fillStyle="#333"; ctx.fillRect(px,py,4,3); } 
        else if(p.type==="bones") { ctx.fillStyle="#ccc"; ctx.fillRect(px,py,3,1); ctx.fillRect(px+2,py+1,3,1); } 
        else if(p.type==="shrine") { 
            ctx.shadowBlur=10; ctx.shadowColor="#0ff"; ctx.fillStyle="#0ff"; 
            ctx.fillRect(px,py-4,4,12); ctx.fillRect(px-2,py,8,2);
            ctx.shadowBlur=0; 
        }
        else if(p.type==="book") {
            ctx.fillStyle="#a52"; ctx.fillRect(px,py,6,4);
            ctx.fillStyle="#eee"; ctx.fillRect(px+1,py+1,4,2);
        }
        else if(p.type==="stairs") {
            ctx.fillStyle = p.locked ? "#f00" : "#0f0";
            ctx.fillRect(px-4, py-6, 8, 12);
            ctx.strokeStyle = "#fff"; ctx.strokeRect(px-4, py-6, 8, 12);
            if (p.locked) {
                ctx.fillStyle = "#fff"; ctx.font = "8px Arial"; ctx.textAlign="center"; ctx.fillText("🔒", px, py);
            }
        }
        else { ctx.fillStyle="#232"; ctx.fillRect(px,py,2,4); ctx.fillRect(px+3,py+1,2,3); } 
    });
    
    for(let k in state.it){ let i=state.it[k]; let yb = Math.sin(now/200)*2; if(i.item.key === "gold") { ctx.shadowBlur=5; ctx.shadowColor="#fb0"; ctx.fillStyle="#fb0"; ctx.fillRect(ox+i.x*SCALE+4, oy+i.y*SCALE+6+yb, 3, 3); ctx.shadowBlur=0; } else { ctx.shadowBlur = i.item.rarity==="legendary"?10:i.item.rarity==="rare"?5:0; ctx.shadowColor=i.item.color; ctx.fillStyle=i.item.color; ctx.fillRect(ox+i.x*SCALE+4, oy+i.y*SCALE+4+yb, 8, 8); ctx.shadowBlur=0; } }

    if(state.pr) state.pr.forEach(p => {
        ctx.save(); ctx.translate(ox+p.x*SCALE, oy+p.y*SCALE); ctx.rotate(p.angle || 0); ctx.shadowBlur=10;
        if(p.type === "arrow") { ctx.shadowColor="#ff0"; ctx.fillStyle = "#ff0"; ctx.fillRect(-6, -1, 12, 2); } 
        else if (p.type === "fireball") { ctx.shadowColor="#f80"; ctx.fillStyle = "#f80"; ctx.beginPath(); ctx.arc(0,0, 4, 0, Math.PI*2); ctx.fill(); }
        else if (p.type === "meteor") { ctx.shadowColor="#f00"; ctx.fillStyle = "#f00"; ctx.beginPath(); ctx.arc(0,0, 8, 0, Math.PI*2); ctx.fill(); } 
        else if (p.type === "web") { ctx.shadowColor="#fff"; ctx.strokeStyle="#fff"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(-4,-4); ctx.lineTo(4,4); ctx.moveTo(4,-4); ctx.lineTo(-4,4); ctx.stroke(); }
        else if (p.type === "laser") { ctx.shadowColor="#f0f"; ctx.fillStyle="#f0f"; ctx.fillRect(-10, -2, 20, 4); }
        else if (p.type === "frostball") { ctx.shadowColor="#0ff"; ctx.fillStyle="#0ff"; ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2); ctx.fill(); }
        else if (p.type === "hook") { 
            ctx.shadowColor="#aaa"; ctx.strokeStyle="#aaa"; ctx.lineWidth=2; 
            ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-8, 0); ctx.stroke(); 
            ctx.fillStyle="#fff"; ctx.beginPath(); ctx.moveTo(-8,-3); ctx.lineTo(-12,0); ctx.lineTo(-8,3); ctx.fill(); 
        }
        else { ctx.shadowColor="#0ff"; ctx.fillStyle = "#0ff"; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill(); }
        ctx.shadowBlur=0; ctx.restore();
    });

    for(let i = effects.length - 1; i >= 0; i--) {
        let e = effects[i];
        e.life--;
        if (e.life <= 0) {
            effects.splice(i, 1);
            continue;
        }

        const x = ox + e.x * SCALE;
        const y = oy + e.y * SCALE;

        ctx.shadowBlur = 10;
        ctx.shadowColor = "#fff";

        if (e.type === "slash") {
            ctx.strokeStyle = `rgba(255,255,255,${e.life/10})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(x, y, 20, e.angle - 0.8, e.angle + 0.8);
            ctx.stroke();
        }
        else if (e.type === "spin") {
            ctx.strokeStyle = `rgba(255,255,0,${e.life/20})`;
            ctx.lineWidth = 4;
            ctx.beginPath();
            const radius = 35 - (20 - e.life) * 2;
            if (radius > 0) ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.stroke();
        }
        else if (e.type === "nova") {
            ctx.strokeStyle = `rgba(255,0,0,${e.life/(e.life > 15 ? 20 : 10)})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 30 - e.life, 0, Math.PI * 2);
            ctx.stroke();
        }
        else if (e.type === "charge") {
            ctx.strokeStyle = `rgba(255,0,0,${e.life/30})`;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x, y, 25 + (30 - e.life), 0, Math.PI * 2);
            ctx.stroke();
        }

        ctx.shadowBlur = 0;
    }

    const ents = [...Object.values(state.mb), ...Object.values(state.pl)]; 
    ents.sort((a,b) => a.y - b.y); // Ordena por Y para profundidade correta

    ents.forEach(e => {
        const x = ox + e.x * SCALE + SCALE/2;
        const y = oy + e.y * SCALE + SCALE/2;
        const s = e.size || 12; 
        const blink = e.hitFlash > 0;

        // --- AURAS (Raridade e Bosses) ---
        if (e.equipment && e.equipment.body) {
             if (e.equipment.body.rarity === "legendary") drawAura(x, y, "#f0f", 15); 
             else if (e.equipment.body.rarity === "rare") drawAura(x, y, "#ff0", 8);
        }
        
        if (e.boss) drawAura(x, y, "#f00", 25);
        else if (e.color && !e.npc && !e.class) drawAura(x, y, e.color, 10); // Elite Aura

        ctx.save(); 
        ctx.translate(x, y);
        
        // Direção do olhar
        let dirX = (e.vx > 0.01) ? 1 : (e.vx < -0.01) ? -1 : 1; 
        if (e.id === myId) {
            if (!isMobile && !gamepadActive) { dirX = (mouse.x > canvas.width/2) ? 1 : -1; } 
            else { 
                const currentInputX = joystick.normX || keys.game_x || (keys.a ? -1 : keys.d ? 1 : 0);
                if (Math.abs(currentInputX) > 0.1) dirX = Math.sign(currentInputX); 
            }
        }
        ctx.scale(dirX, 1);

        // Se estiver tomando dano, desenha silhueta branca
        if (blink) {
            ctx.fillStyle = "#fff";
            if (e.boss) { ctx.beginPath(); ctx.arc(0, -s/2, s, 0, Math.PI*2); ctx.fill(); } 
            else { ctx.fillRect(-s/2, -s, s, s); }
        } else {
            // ===============================================
            //  DESENHO DOS MOBS E BOSSES (VISUAL NOVO)
            // ===============================================
            
            // --- JOGADORES (CLASSES) ---
            if (e.class) {
                let c = e.class; 
                // Corpo
                ctx.fillStyle = (c==="knight"?"#668":c==="hunter"?"#464":"#448"); 
                ctx.fillRect(-4, -6, 8, 12);
                
                // Equipamentos Visuais
                if(e.equipment && e.equipment.head) { ctx.fillStyle=e.equipment.head.color; ctx.fillRect(-4,-9,8,5); }
                if(e.equipment && e.equipment.body) { ctx.fillStyle=e.equipment.body.color; ctx.fillRect(-3,-4,6,8); }
                
                // Arma
                if(e.equipment && e.equipment.hand) {
                    let k = e.equipment.hand.key;
                    if(k.includes("sword")||k.includes("axe")||k.includes("dagger")) { 
                        ctx.fillStyle="#ccc"; ctx.fillRect(4, -8, 2, 14); // Lamina
                        ctx.fillStyle="#840"; ctx.fillRect(3, 2, 4, 2); // Cabo
                    }
                    if(k.includes("bow")) { 
                        ctx.strokeStyle="#a84"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(4, 0, 7, -1.5, 1.5); ctx.stroke(); 
                        ctx.beginPath(); ctx.moveTo(4, -7); ctx.lineTo(4, 7); ctx.strokeStyle="#fff"; ctx.lineWidth=0.5; ctx.stroke(); 
                    }
                    if(k.includes("staff")) { 
                        ctx.fillStyle="#630"; ctx.fillRect(5, -10, 2, 18); 
                        ctx.fillStyle=e.equipment.hand.color; ctx.beginPath(); ctx.arc(6, -12, 3, 0, Math.PI*2); ctx.fill();
                    }
                }
                
                // Olhos do Jogador
                if (e.id === myId) {
                    ctx.fillStyle = "white"; ctx.fillRect(-2, -4, 2, 2); ctx.fillRect(2, -4, 2, 2); 
                    let lookAngle = (!isMobile && !gamepadActive) ? getMouseAngle() : getAttackAngle();
                    let lx = Math.cos(lookAngle); let ly = Math.sin(lookAngle);
                    if (dirX === -1) lx = -lx; 
                    ctx.fillStyle = "black"; ctx.fillRect(-2 + lx, -4 + ly, 1, 1); ctx.fillRect(2 + lx, -4 + ly, 1, 1); 
                } else {
                    ctx.fillStyle = "#000"; ctx.fillRect(-2, -4, 1, 1); ctx.fillRect(2, -4, 1, 1);
                }
            }
            
            // --- RESOURCES ---
            else if (e.ai === "resource") {
                if(e.drop==="wood") { 
                    ctx.fillStyle="#532"; ctx.fillRect(-2, -2, 4, 6); // Tronco
                    ctx.fillStyle="#151"; ctx.beginPath(); ctx.moveTo(0,-16); ctx.lineTo(-10,-2); ctx.lineTo(10,-2); ctx.fill(); // Folhas
                    ctx.fillStyle="#262"; ctx.beginPath(); ctx.moveTo(0,-14); ctx.lineTo(-7,-4); ctx.lineTo(7,-4); ctx.fill(); 
                } else { 
                    ctx.fillStyle="#555"; ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.fill();
                    ctx.fillStyle="#777"; ctx.beginPath(); ctx.arc(-2,-2,3,0,Math.PI*2); ctx.fill();
                }
            }

            // --- NPCS ---
            else if (e.npc) {
                ctx.fillStyle = e.name==="Merchant"?"#a84":e.name==="Healer"?"#fff":"#555";
                ctx.fillRect(-5,-8,10,14); // Corpo
                ctx.fillStyle="#fcc"; ctx.fillRect(-3,-12,6,4); // Cabeça
                if(e.name==="Merchant") { ctx.fillStyle="#a84"; ctx.fillRect(-4,-13,8,2); ctx.fillStyle="#0f0"; ctx.fillText("$", 0, -16); } 
                if(e.name==="Healer") { ctx.fillStyle="#f00"; ctx.fillRect(-1,-10,2,6); ctx.fillRect(-3,-8,6,2); } 
                if(e.name==="Blacksmith") { ctx.fillStyle="#333"; ctx.fillRect(4, -2, 4, 8); } 
            }

            // --- BOSSES ---
            else if (e.boss) {
                const bs = s; 
                if (e.name.includes("Butcher")) {
                    // CORPO: Um grande retângulo largo (Gordo e pixelado)
                    ctx.fillStyle = "#900"; // Vermelho sangue escuro
                    // Desenha o corpo mais largo que alto
                    ctx.fillRect(-bs/1.1, -bs/2, bs*1.8, bs);

                    // CABEÇA: Um quadrado "enterrado" nos ombros
                    ctx.fillStyle = "#700"; 
                    ctx.fillRect(-bs/3, -bs + 4, bs/1.5, bs/2);
                    
                    // OLHOS: Pixels brancos puros (sem anti-aliasing visual)
                    ctx.fillStyle = "#fff";
                    ctx.fillRect(-3, -bs + 8, 2, 2);
                    ctx.fillRect(3, -bs + 8, 2, 2);

                    // AVENTAL: Retângulo cinza cobrindo o peito/barriga
                    ctx.fillStyle = "#ccc"; 
                    ctx.fillRect(-bs/1.5, -bs/3, bs*1.3, bs*0.7);
                    
                    // MANCHAS DE SANGUE: Quadrados perfeitos espalhados (Pixel Art style)
                    ctx.fillStyle = "#b00"; 
                    ctx.fillRect(-5, 0, 4, 4);
                    ctx.fillRect(6, -5, 3, 3);
                    ctx.fillRect(-bs/2, 5, 5, 5);

                    // O FACÃO (CLEAVER): Geometria bruta e reta
                    ctx.save();
                    ctx.translate(bs, 0); // Na mão direita
                    
                    // Cabo (Marrom escuro)
                    ctx.fillStyle = "#421"; 
                    ctx.fillRect(-2, 2, 4, 6);
                    
                    // Lâmina (Retângulo cinza maciço)
                    ctx.fillStyle = "#667"; 
                    ctx.fillRect(-2, -14, 12, 16); 
                    
                    // Fio de corte (Linha clara na borda)
                    ctx.fillStyle = "#aaa";
                    ctx.fillRect(-2, -14, 2, 16);

                    // Ponta com sangue (Quadrado vermelho na ponta)
                    ctx.fillStyle = "#a00";
                    ctx.fillRect(-2, -4, 12, 6);
                    
                    ctx.restore();
                }
                else if (e.name.includes("Lich")) {
                    ctx.fillStyle = "#222"; ctx.beginPath(); ctx.moveTo(0, -bs); ctx.lineTo(-bs/2, bs/2); ctx.lineTo(bs/2, bs/2); ctx.fill(); 
                    ctx.fillStyle = "#eee"; ctx.beginPath(); ctx.arc(0, -bs/2, 6, 0, Math.PI*2); ctx.fill(); 
                    ctx.fillStyle = "#0ff"; ctx.fillRect(-2, -bs/2 - 2, 1, 1); ctx.fillRect(1, -bs/2 - 2, 1, 1); 
                    ctx.strokeStyle = "#db0"; ctx.lineWidth=2; ctx.strokeRect(-4, -bs/2-6, 8, 2); 
                }
                else if (e.name.includes("Broodmother")) {
                    ctx.fillStyle = "#120"; ctx.lineWidth = 2; ctx.strokeStyle = "#120";
                    for(let i=0; i<4; i++) { ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(bs, (i*6)-10); ctx.moveTo(0,0); ctx.lineTo(-bs, (i*6)-10); ctx.stroke(); }
                    ctx.fillStyle = "#241"; ctx.beginPath(); ctx.arc(0, 0, bs/2, 0, Math.PI*2); ctx.fill(); 
                    ctx.fillStyle = "#f00"; ctx.fillRect(-2, -bs/2, 1, 1); ctx.fillRect(1, -bs/2, 1, 1); 
                }
                else if (e.name.includes("Fire Lord")) {
                    ctx.fillStyle = "#f80"; let wobble = Math.sin(Date.now()/100) * 2;
                    ctx.beginPath(); ctx.arc(0, wobble, bs/2, 0, Math.PI*2); ctx.fill();
                    ctx.fillStyle = "#ff0"; ctx.beginPath(); ctx.arc(0, wobble, bs/3, 0, Math.PI*2); ctx.fill();
                    ctx.fillStyle = "#f40"; ctx.fillRect(-bs, wobble - 10, 6, 6); ctx.fillRect(bs-6, wobble - 10, 6, 6);
                }
                else if (e.name.includes("Void")) {
                    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(0, 0, bs/2, 0, Math.PI*2); ctx.fill(); 
                    ctx.fillStyle = "#909"; ctx.beginPath(); ctx.arc(0, 0, bs/3, 0, Math.PI*2); ctx.fill(); 
                    ctx.fillStyle = "#000"; ctx.beginPath(); ctx.arc(0, 0, bs/5, 0, Math.PI*2); ctx.fill(); 
                    ctx.strokeStyle = "#909"; ctx.lineWidth=2;
                    ctx.beginPath(); ctx.moveTo(0, bs/2); ctx.quadraticCurveTo(5, bs, 0, bs+5); ctx.stroke();
                    ctx.beginPath(); ctx.moveTo(-5, bs/2); ctx.quadraticCurveTo(-10, bs, -5, bs+5); ctx.stroke();
                }
                else if (e.name.includes("DIABLO")) {

    const scale = 1.6;          // 👈 AUMENTA O TAMANHO DO DIABLO
    const b = bs * scale;       // bs escalado

    ctx.fillStyle = "#a00";
    ctx.beginPath();
    ctx.moveTo(-10*scale, 10*scale);
    ctx.lineTo(-b/2, -b/2);
    ctx.lineTo(b/2, -b/2);
    ctx.lineTo(10*scale, 10*scale);
    ctx.fill();

    ctx.fillRect(-6*scale, -b/2 - 8*scale, 12*scale, 10*scale);

    ctx.fillStyle = "#eee";
    ctx.beginPath();
    ctx.moveTo(-6*scale, -b/2 - 6*scale);
    ctx.lineTo(-12*scale, -b - 5*scale);
    ctx.lineTo(-2*scale, -b/2 - 8*scale);
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(6*scale, -b/2 - 6*scale);
    ctx.lineTo(12*scale, -b - 5*scale);
    ctx.lineTo(2*scale, -b/2 - 8*scale);
    ctx.fill();

    ctx.fillStyle = "#ff0";
    ctx.fillRect(-3*scale, -b/2 - 4*scale, 2*scale, 2*scale);
    ctx.fillRect(1*scale, -b/2 - 4*scale, 2*scale, 2*scale);

    ctx.strokeStyle = "#a00";
    ctx.lineWidth = 4 * scale;
    ctx.beginPath();
    ctx.moveTo(0, 5*scale);
    ctx.quadraticCurveTo(-b, 5*scale, -b - 5*scale, -5*scale);
    ctx.stroke();
}

                else { ctx.fillStyle = e.color || "#f00"; ctx.fillRect(-s/2, -s/2, s, s); }
            }

            // --- MOBS COMUNS ---
            else {
                const t = e.type;
                if (t === "rat") {
                    ctx.fillStyle = "#654"; ctx.beginPath(); ctx.ellipse(0, 2, 6, 3, 0, 0, Math.PI*2); ctx.fill(); 
                    ctx.fillStyle = "#fbb"; ctx.beginPath(); ctx.moveTo(6, 2); ctx.lineTo(10, 2); ctx.stroke(); 
                }
                else if (t === "bat") {
                    ctx.fillStyle = "#222"; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-8, -6); ctx.lineTo(-4, 2); ctx.lineTo(0,0); ctx.lineTo(4, 2); ctx.lineTo(8, -6); ctx.fill();
                }
                else if (t === "slime") {
                    ctx.fillStyle = e.color || "#0f0"; ctx.globalAlpha = 0.8;
                    ctx.beginPath(); ctx.arc(0, 0, 6, Math.PI, 0); ctx.lineTo(6, 4); ctx.lineTo(-6, 4); ctx.fill(); 
                    ctx.fillStyle = "#000"; ctx.fillRect(-2, -1, 1, 1); ctx.fillRect(2, -1, 1, 1); 
                    ctx.globalAlpha = 1.0;
                }
                else if (t === "goblin" || t === "imp") {
                    ctx.fillStyle = e.color || (t==="imp"?"#d40":"#484"); ctx.fillRect(-4, -6, 8, 10); 
                    ctx.beginPath(); ctx.moveTo(-4, -4); ctx.lineTo(-7, -8); ctx.lineTo(-4, -2); ctx.fill();
                    ctx.beginPath(); ctx.moveTo(4, -4); ctx.lineTo(7, -8); ctx.lineTo(4, -2); ctx.fill();
                    ctx.fillStyle = "#ccc"; ctx.fillRect(4, 0, 4, 1);
                }
                else if (t === "skeleton" || t === "archer") {
                    ctx.fillStyle = "#eee"; ctx.fillRect(-3, -7, 6, 6); ctx.fillRect(-2, 0, 4, 8); 
                    ctx.strokeStyle = "#eee"; ctx.lineWidth=1;
                    ctx.beginPath(); ctx.moveTo(-4, 2); ctx.lineTo(4, 2); ctx.moveTo(-4, 4); ctx.lineTo(4, 4); ctx.stroke(); 
                    if (t==="archer") { ctx.strokeStyle="#852"; ctx.lineWidth=1; ctx.beginPath(); ctx.arc(5, 0, 5, -1, 1); ctx.stroke(); } 
                    else { ctx.fillStyle="#aaa"; ctx.fillRect(4, -2, 2, 8); } 
                }
                else if (t === "orc" || t === "hellknight") {
                    ctx.fillStyle = t==="orc"?"#262":"#300"; ctx.fillRect(-6, -8, 12, 14); 
                    if(t==="orc"){ ctx.fillStyle="#fff"; ctx.fillRect(-3,-3,1,2); ctx.fillRect(2,-3,1,2); } 
                    else { ctx.fillStyle="#111"; ctx.fillRect(-2, -6, 4, 2); } 
                    ctx.fillStyle = "#555"; ctx.fillRect(6, -8, 2, 16); ctx.fillRect(4, -8, 6, 4);
                }
                else if (t === "mage" || t === "ghost" || t === "succubus") {
                    ctx.fillStyle = t==="ghost"?"rgba(200,255,255,0.7)":t==="succubus"?"#f0f":"#408";
                    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-5, 8); ctx.lineTo(5, 8); ctx.fill();
                    if(t==="mage") { ctx.fillStyle="#840"; ctx.fillRect(4, -8, 1, 16); ctx.fillStyle="#0ff"; ctx.fillRect(3,-10,3,3); } 
                    if(t==="succubus") { ctx.fillStyle="#000"; ctx.fillRect(-6,-4,3,3); ctx.fillRect(3,-4,3,3); } 
                }
                else if (t === "chest") {
                    ctx.fillStyle = "#a60"; ctx.fillRect(-6, -4, 12, 8); ctx.fillStyle = "#fd0"; ctx.fillRect(-1, -2, 2, 3); 
                    ctx.strokeStyle = "#420"; ctx.strokeRect(-6, -4, 12, 8);
                }
                else { ctx.fillStyle = e.color || "#ccc"; ctx.fillRect(-s/2, -s/2, s, s); }
            }
        }
        
        if(e.input && e.input.block) { ctx.strokeStyle = "#0ff"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,14,0,Math.PI*2); ctx.stroke(); }
        ctx.restore();

        const maxHp = e.stats ? e.stats.maxHp : e.maxHp;
        if(e.hp > 0 && e.hp < maxHp && e.ai!=="static" && !e.npc && e.ai!=="resource") { 
            const pct = Math.max(0, e.hp/maxHp); const bw = e.boss ? 30 : 16;
            ctx.fillStyle="#000"; ctx.fillRect(x-bw/2, y-s-6, bw, 3); 
            ctx.fillStyle=e.boss?"#d00":"#f00"; ctx.fillRect(x-bw/2, y-s-6, bw*pct, 3); 
        }
        if(e.class || e.boss || e.npc || (e.color && !e.ai.includes("resource"))) { 
            ctx.fillStyle = e.npc ? "#0ff" : e.boss ? "#f00" : (e.id === myId ? "#0f0" : "#fff"); 
            ctx.font = e.boss ? "bold 10px Courier New" : "8px Courier New"; ctx.textAlign="center"; 
            let nameTxt = e.class ? `[Lvl ${e.level}] ${e.name}` : e.name;
            if (e.boss) nameTxt = "☠ " + nameTxt + " ☠";
            ctx.fillText(nameTxt, x, y - s - 10); 
        }
        if(e.chatMsg && e.chatTimer > 0) {
            ctx.font = "10px Courier New";
            const w = ctx.measureText(e.chatMsg).width + 6;
            ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.strokeStyle="#fff"; ctx.lineWidth=1;
            ctx.fillRect(x - w/2, y - s - 28, w, 14); ctx.strokeRect(x - w/2, y - s - 28, w, 14);
            ctx.fillStyle = "#fff"; ctx.fillText(e.chatMsg, x, y - s - 18);
        }
    });

    ctx.save();
    const sy=Math.floor(cam.y/SCALE), ey=sy+Math.ceil(canvas.height/SCALE)+1; const sx=Math.floor(cam.x/SCALE), ex=sx+Math.ceil(canvas.width/SCALE)+1;
    for(let y=sy; y<ey; y++){
        if(!explored[y]) continue;
        for(let x=sx; x<ex; x++){
            const dist = Math.hypot(x - me.x, y - me.y);
            if (dist > state.lightRadius) {
                if (explored[y][x] === 1) { ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'; ctx.fillRect(ox+x*SCALE, oy+y*SCALE, SCALE, SCALE); } 
                else if (explored[y][x] === 0) { ctx.fillStyle = 'rgba(0, 0, 0, 1.0)'; ctx.fillRect(ox+x*SCALE, oy+y*SCALE, SCALE, SCALE); }
            }
        }
    }
    const innerRadius = lightRadiusPixels * 0.7; const outerRadius = lightRadiusPixels * 1.0;
    const gradient = ctx.createRadialGradient(playerScreenX, playerScreenY, innerRadius, playerScreenX, playerScreenY, outerRadius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)'); gradient.addColorStop(0.75, 'rgba(0, 0, 0, 0.2)'); gradient.addColorStop(1, 'rgba(0, 0, 0, 1)'); 
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore(); 
    
    // --- NAVIGATION HINT ARROW ---
    if(state.hint && me) {
        const hintDx = state.hint.x - me.x;
        const hintDy = state.hint.y - me.y;
        const dist = Math.hypot(hintDx, hintDy);
        
        if(dist > 8) {
            const angle = Math.atan2(hintDy, hintDx);
            const radius = 40; 
            const ax = ox + me.x*SCALE + SCALE/2 + Math.cos(angle)*radius;
            const ay = oy + me.y*SCALE + SCALE/2 + Math.sin(angle)*radius;
            
            ctx.save();
            ctx.translate(ax, ay);
            ctx.rotate(angle);
            
            const scale = 1 + Math.sin(Date.now() / 200) * 0.2;
            ctx.scale(scale, scale);
            
            ctx.fillStyle = state.hint.type === "exit" ? "#0f0" : "#f00";
            ctx.shadowBlur = 10;
            ctx.shadowColor = ctx.fillStyle;
            
            ctx.beginPath();
            ctx.moveTo(6, 0);
            ctx.lineTo(-6, -6);
            ctx.lineTo(-6, 6);
            ctx.closePath();
            ctx.fill();
            
            ctx.restore();
            ctx.shadowBlur = 0;
        }
    }

    if (!fogPattern) createFogPattern();
    ctx.fillStyle = fogPattern; ctx.globalAlpha = 0.5; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1.0;
    
    drawOffscreenPlayerIndicators(); 
    
    for(let i=texts.length-1; i>=0; i--){ 
        let t=texts[i]; 
        t.y += t.vy;
        t.life--; 
        ctx.globalAlpha = Math.min(1.0, Math.max(0, t.life / 50)); 
        ctx.fillStyle = t.color; 
        ctx.font = t.size || "10px Courier New"; 
        ctx.textAlign = "center"; 
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 3;
        ctx.strokeText(t.val, ox+t.x*SCALE, oy+t.y*SCALE);
        ctx.fillText(t.val, ox+t.x*SCALE, oy+t.y*SCALE); 
        ctx.globalAlpha = 1.0; 
        if(t.life<=0) texts.splice(i,1); 
    }
}

window.login = () => { if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume(); AudioCtrl.init(); socket.emit("login", document.getElementById("username").value); };
window.create = () => socket.emit("create_char", {name:document.getElementById("cname").value, cls:document.getElementById("cclass").value});
window.addStat = (s) => socket.emit("add_stat", s);
window.buy = (idx) => socket.emit("buy", shopItems[idx]);
window.sell = () => { if(!me || !uiState.shop || focusArea !== 'inventory' || me.inventory.length === 0) return; socket.emit("sell", focusIndex); updateUI(); };
window.closeShop = closeAllMenus;

draw();