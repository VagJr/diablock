const socket = io();
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const SCALE = 16;
let myId = null, me = null;
let state = { pl:{}, mb:{}, it:{}, pr:[], props:[], map:[], explored: [], lightRadius: 15 }; 
let recipes = [];
let cam = { x:0, y:0 }, mouse = { x:0, y:0 };
let texts = [], effects = [];
let uiState = { inv: false, char: false, shop: false, craft: false, chat: false };
let inputState = { x:0, y:0, block: false };
let shopItems = [];
const tooltip = document.getElementById("tooltip");
let dragItem = null;
// Aumentando a detecção de mobile para garantir que a interface minimalista seja usada
let isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
let gamepad = null;
let gamepadActive = false; 
let focusIndex = 0;
let focusArea = 'equipment'; 
// NOVO: Log de Jogo
const gameLog = document.getElementById("game-log");

window.addEventListener("gamepadconnected", (e) => { gamepad = e.gamepad; gamepadActive = true; document.getElementById("mobile-controls").style.display = "none"; document.getElementById("mobile-menu-buttons").style.display = "flex"; });
window.addEventListener("gamepaddisconnected", (e) => { gamepad = null; gamepadActive = false; });

const AudioCtrl = {
    ctx: new (window.AudioContext || window.webkitAudioContext)(),
    bgm: null, muted: false,
    init: function() {
        if(!this.bgm) {
            this.bgm = new Audio("/assets/bgm.mp3");
            this.bgm.loop = true; this.bgm.volume = 0.3;
            this.bgm.play().catch(e => console.log("Audio requires interaction."));
        }
    },
    playTone: function(freq, type, dur, vol=0.1) {
        if(this.muted || this.ctx.state === 'suspended') return;
        const o = this.ctx.createOscillator(); const g = this.ctx.createGain();
        o.type = type; o.frequency.setValueAtTime(freq, this.ctx.currentTime);
        g.gain.setValueAtTime(vol, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime+dur);
        o.connect(g); g.connect(this.ctx.destination); o.start(); o.stop(this.ctx.currentTime+dur);
    },
    playNoise: function(dur, vol=0.2) {
        if(this.muted || this.ctx.state === 'suspended') return;
        const b = this.ctx.createBuffer(1, this.ctx.sampleRate*dur, this.ctx.sampleRate);
        const d = b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1;
        const s = this.ctx.createBufferSource(); s.buffer=b; const g=this.ctx.createGain();
        g.gain.setValueAtTime(vol, this.ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime+dur);
        s.connect(g); g.connect(this.ctx.destination); s.start();
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
    }
}

const resize = () => { canvas.width=innerWidth; canvas.height=innerHeight; ctx.imageSmoothingEnabled=false; isMobile = window.matchMedia("(max-width: 1024px)").matches || /Mobi|Android/i.test(navigator.userAgent); updateUI(); };
resize(); window.onresize=resize;

// NOVO: Função para adicionar mensagem ao Log de Jogo
function addLog(msg, color="#0f0") {
    const d = new Date();
    const time = `[${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}]`;
    const logEntry = document.createElement("div");
    logEntry.innerHTML = `<span style="color:#666">${time}</span> <span style="color:${color}">${msg}</span>`;
    gameLog.prepend(logEntry); // Adiciona ao topo
    // Limita o número de logs
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
        d.onclick=()=>{ socket.emit("enter_game", n); document.getElementById("menu").style.display="none"; AudioCtrl.init(); };
        l.appendChild(d);
    }
});
socket.on("game_start", d => { recipes = d.recipes; renderCrafting(); });
socket.on("u", d => { Object.assign(state, d); me=state.pl[myId]; if(me) updateUI(); });
socket.on("txt", d => {
    // CORREÇÃO: Garante que d.val é uma string antes de chamar includes
    const valStr = String(d.val);
    let vy = -0.25; let life = 100; 
    if(valStr.includes("LEVEL UP!")) { vy = -0.5; life = 150; }
    else if(valStr.includes("CRIT!")) { vy = -0.4; life = 100; d.color="#f0f"; d.size="14px"; d.isCrit=true; }
    else if(valStr.includes("CRAFT") || valStr.includes("SOCKETED") || valStr.includes("BLOCK")) { vy = -0.35; life = 80; }
    else if(valStr.includes("DEATH!")) { vy = -0.6; life = 180; d.size="20px"; } 
    else if(valStr.includes("+")) { vy = -0.3; life = 80; } 
    texts.push({...d, val: valStr, life:life, vy:vy});
    if(valStr.includes("CRAFT")) playSfx("craft");
    if(valStr.includes("LEVEL")) playSfx("levelup");
});
socket.on("fx", d => {
    if (d.type === "slash") { effects.push({ type: "slash", x: d.x, y: d.y, angle: d.angle, life: 10 }); playSfx("atk"); }
    else if (d.type === "spin") { effects.push({ type: "spin", x: d.x, y: d.y, angle: d.angle || 0, life: 20 }); playSfx("atk"); }
    else if (d.type === "nova") effects.push({ type: "nova", x: d.x, y: d.y, life: d.life || 20 });
    else if (d.type === "dash") playSfx("dash");
    else if (d.type === "gold_txt") { texts.push({ val: d.val, x: d.x, y: d.y, color: "#fb0", life: 75, vy: -0.3, size: "10px" }); playSfx("gold"); }
    else if (d.type === "hit") playSfx("hit");
    else if (d.type === "gold") playSfx("gold");
});
// Somente toca som, o balão vem pelo update "u"
socket.on("chat", d => { playSfx("chat"); });
socket.on("open_shop", items => { uiState.shop = true; shopItems = items; updateUI(); });
// NOVO: Log de Jogo
socket.on("log", d => addLog(d.msg, d.color));

const keys = { w:false, a:false, s:false, d:false, q:false, game_x: 0, game_y: 0 };
function sendInput() {
    let dx = keys.a?-1:keys.d?1:0, dy = keys.w?-1:keys.s?1:0;
    
    // 1. Gamepad override (stick/dpad)
    if (gamepadActive && (Math.abs(keys.game_x) > 0.1 || Math.abs(keys.game_y) > 0.1)) { dx = keys.game_x; dy = keys.game_y; }
    
    // 2. Joystick override (Touch)
    if (joystick.active) { dx = joystick.normX; dy = joystick.normY; }

    // Bloqueia movimento se chat aberto
    if(uiState.chat) { dx = 0; dy = 0; }
    
    // keys.q is block
    if(dx!==inputState.x || dy!==inputState.y || keys.q !== inputState.block){ inputState={x:dx,y:dy,block:keys.q}; socket.emit("input", inputState); }
}

function getMouseAngle() { return Math.atan2((mouse.y - canvas.height/2), (mouse.x - canvas.width/2)); }

// Função unificada para pegar input direcional (Joystick/Gamepad/Teclado)
function getDirectionalInput() {
    // 1. Joystick (Prioridade máxima em Mobile)
    if (joystick.active) {
        return { dx: joystick.normX, dy: joystick.normY };
    }
    
    // 2. Gamepad Stick/Dpad
    const game_dx = keys.game_x;
    const game_dy = keys.game_y;
    if (Math.abs(game_dx) > 0.1 || Math.abs(game_dy) > 0.1) {
        return { dx: game_dx, dy: game_dy };
    }
    
    // 3. Teclado (WASD)
    const key_dx = keys.d - keys.a;
    const key_dy = keys.s - keys.w;
    if (Math.abs(key_dx) > 0.1 || Math.abs(key_dy) > 0.1) {
        return { dx: key_dx, dy: key_dy };
    }

    return { dx: 0, dy: 0 };
}

// AJUSTE: Dash usa o ângulo do mouse no PC/Teclado, ou a direção do Joystick/Gamepad no mobile
function getDashAngle() {
    // Se não é mobile/gamepad ativo (PC Mouse/Teclado), SEMPRE retorna o ângulo do mouse
    if (!isMobile && !gamepadActive) return getMouseAngle();
    
    // Calcula a direção do movimento (Mobile/Gamepad/Joystick)
    const { dx, dy } = getDirectionalInput();
    const isMoving = (Math.abs(dx) > 0.1) || (Math.abs(dy) > 0.1);
    
    if (isMoving) { 
        return Math.atan2(dy, dx); 
    }
    // Se não estiver movendo, usa a direção atual do jogador, ou 0 (direita)
    return me ? Math.atan2(me.vy || 0, me.vx || 1) : 0;
}

function getClosestEnemyAngle(maxRange = 8) {
    if (!me || !state.mb) return null;
    let closestEnemy = null, minDistSq = Infinity;
    Object.values(state.mb).forEach(m => {
        // Ignora NPCs e recursos, e mobs mortos
        if (m.ai === "static" || m.ai === "npc" || m.ai === "resource" || m.hp <= 0) return;
        const dx = m.x - me.x, dy = m.y - me.y, distSq = dx * dx + dy * dy;
        // Raio de engajamento (maxRange * maxRange em tiles)
        if (distSq < minDistSq && distSq < maxRange * maxRange) { 
            minDistSq = distSq; closestEnemy = m; 
        }
    });
    return closestEnemy ? Math.atan2(closestEnemy.y - me.y, closestEnemy.x - me.x) : null;
}

// AJUSTE CRÍTICO: Função de ataque adaptativa por plataforma/controle.
function getAttackAngle() {
    // 1. PC (Mouse/Teclado): SEMPRE mira no mouse, ignorando inimigos próximos.
    if (!isMobile && !gamepadActive) {
        return getMouseAngle();
    }
    
    // 2. Mobile/Gamepad: Prioriza inimigo próximo (Auto-Aim)
    const closestAngle = getClosestEnemyAngle(8); 
    if (closestAngle !== null) {
        return closestAngle; // Mira no inimigo mais próximo
    }
    
    // 3. Fallback: Mira na direção do movimento (Joystick/Gamepad/Teclado)
    const { dx, dy } = getDirectionalInput();
    const isMoving = (Math.abs(dx) > 0.1) || (Math.abs(dy) > 0.1);
    
    if (isMoving) { 
        return Math.atan2(dy, dx); 
    }
    
    // Se não estiver movendo e sem inimigos:
    // CORREÇÃO FINAL PARA SKILL: Usa a direção que o jogador está olhando (se existir vx/vy) ou a direção padrão (direita=0)
    // Isso resolve o bug do projétil sumir se o jogador parou de se mover mas ainda tem inércia (vx/vy).
    if (me && (me.vx !== 0 || me.vy !== 0)) {
        return Math.atan2(me.vy, me.vx);
    }

    return 0; // Direção padrão: Direita
}

const chatInput = document.getElementById("chat-input");
chatInput.onkeydown = (e) => {
    if(e.key === "Enter") {
        if(chatInput.value.trim().length > 0) socket.emit("chat", chatInput.value.substring(0,30));
        chatInput.value = "";
        document.getElementById("chat-container").style.display = "none";
        uiState.chat = false;
        canvas.focus();
        sendInput(); // Para movemento
    }
};

window.onkeydown = e => {
    if (document.getElementById("menu").style.display !== "none") return;
    let k=e.key.toLowerCase();
    
    if(k === "enter") {
        if (uiState.chat) { return; } // Já tratado no input
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
    if(k==="i") uiState.inv = !uiState.inv; 
    if(k==="c") uiState.char = !uiState.char; 
    if(k==="k") uiState.craft = !uiState.craft; // Tecla K para Crafting
    if(k==="escape") { 
        if (uiState.chat) {
            uiState.chat = false;
            document.getElementById("chat-container").style.display="none";
            canvas.focus();
            sendInput();
        } else {
            uiState.inv=false; uiState.char=false; uiState.shop=false; uiState.craft=false; 
        }
    }
    if(k===" ") { socket.emit("dash", getDashAngle()); } 
    if(k==="e") { socket.emit("potion"); } // Potion is now correctly mapped to 'E'
    
    if (k === 'i' || k === 'c' || k === 'k' || k === 'escape') {
        focusIndex = 0;
        focusArea = (uiState.inv || uiState.char || uiState.shop || uiState.craft) ? (uiState.inv ? 'inventory' : uiState.char ? 'equipment' : uiState.shop ? 'shop' : 'craft') : 'none';
    }
    updateUI();
};
window.onkeyup = e => { let k=e.key.toLowerCase(); if(keys.hasOwnProperty(k)){ keys[k]=false; sendInput(); } };
window.onmousemove = e => { mouse.x=e.clientX; mouse.y=e.clientY; tooltip.style.left = (mouse.x+10)+"px"; tooltip.style.top = (mouse.y+10)+"px"; };

// MUDANÇA CRÍTICA: onmousedown agora depende do getAttackAngle, que só usa o mouse no PC.
window.onmousedown = e => {
    if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume();
    AudioCtrl.init();
    // Bloqueia se não for jogador, chat aberto, mobile ou gamepad ativo (já que eles usam touch/gamepad events)
    if(!me || uiState.chat || gamepadActive || document.getElementById("menu").style.display !== "none") return;
    
    // Verifica se clicou em um painel da UI (Inventário, Char, etc.)
    const isPanel = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return mouse.x > r.left && mouse.x < r.right && mouse.y > r.top && mouse.y < r.bottom && document.getElementById(id).style.display==="block"; };
    if(isPanel("inventory") || isPanel("char-panel") || isPanel("shop-panel") || isPanel("craft-panel")) return;
    
    // Usa o getAttackAngle que agora SEMPRE retorna o mouse angle no PC (Mouse/Teclado)
    const ang = getAttackAngle(); 
    
    if(e.button===0) socket.emit("attack", ang);
    if(e.button===2) socket.emit("skill", {idx:1, angle:ang});
};


// ----------------------------------------------------
// IMPLEMENTAÇÃO DO JOYSTICK VIRTUAL E TOUCH HANDLERS
// ----------------------------------------------------

// Objeto de estado do Joystick
let joystick = { 
    active: false, id: null, 
    startX: 0, startY: 0, 
    currentX: 0, currentY: 0, 
    normX: 0, normY: 0,
    radius: 50, 
    knob: document.getElementById('joystick-knob')
};
const JOYSTICK_AREA_EL = document.getElementById('joystick-area');


const handleTouchStart = (e) => {
    if (gamepadActive) return;
    if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume(); AudioCtrl.init();
    if (uiState.chat || document.getElementById("menu").style.display !== "none") return;
    
    const joystickRect = JOYSTICK_AREA_EL.getBoundingClientRect();

    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i]; 
        const target = touch.target; 
        const id = touch.identifier; 
        let processed = false;

        // 1. Joystick Detection (Left Side / Joystick Area)
        if (target === JOYSTICK_AREA_EL && !joystick.active) {
            joystick.active = true;
            joystick.id = id;
            
            // Centraliza o ponto de partida do joystick na área de toque inicial
            const areaCenterX = joystickRect.left + joystickRect.width / 2;
            const areaCenterY = joystickRect.top + joystickRect.height / 2;
            
            joystick.startX = areaCenterX;
            joystick.startY = areaCenterY;
            joystick.knob.style.display = 'block';
            
            // Reposiciona o knob para o centro da área de toque (sem offset inicial)
            joystick.knob.style.left = (joystickRect.width / 2 - 20) + 'px';
            joystick.knob.style.top = (joystickRect.height / 2 - 20) + 'px';

            // Registra o primeiro movimento como o centro
            handleTouchMove(e);
            
            processed = true;
        } 
        
        // 2. UI Actions (Buttons)
        else if (target.closest('.slot')) {
            const slotElements = document.querySelectorAll('.slot');
            const clickedIndex = Array.from(slotElements).indexOf(target.closest('.slot'));
            if (clickedIndex !== -1) { focusIndex = clickedIndex; focusArea = target.closest('#inv-grid') ? 'inventory' : target.closest('.equip-slots') ? 'equipment' : 'none'; updateUI(); }
        }
        else if (target.closest('.action-btn')) {
            const action = target.closest('.action-btn').dataset.action;
            const ang = getAttackAngle(); 
            if (action === "attack") socket.emit("attack", ang); 
            else if (action === "skill") socket.emit("skill", {idx:1, angle:ang}); 
            else if (action === "dash") socket.emit("dash", getDashAngle()); 
            else if (action === "potion") socket.emit("potion");
            else if (action === "block") keys.q = !keys.q; sendInput(); // NOVO: Botão de Bloqueio (Q)
            processed = true;
        }
        else if (target.closest('#btn-inv-mobile')) { uiState.inv = !uiState.inv; uiState.char = false; uiState.craft = false; updateUI(); processed = true; } // Fecha Crafting
        else if (target.closest('#btn-char-mobile')) { uiState.char = !uiState.char; uiState.inv = false; uiState.craft = false; updateUI(); processed = true; } // Fecha Crafting
        else if (target.closest('#btn-craft-mobile')) { uiState.craft = !uiState.craft; uiState.inv = false; uiState.char = false; updateUI(); processed = true; } // NOVO: Abre/fecha Crafting
        
        if (processed) e.preventDefault();
    }
};

const handleTouchMove = (e) => {
    if (!joystick.active) return;

    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joystick.id) {
            joystick.currentX = touch.clientX;
            joystick.currentY = touch.clientY;
            
            let dx = joystick.currentX - joystick.startX;
            let dy = joystick.currentY - joystick.startY;
            let dist = Math.hypot(dx, dy);

            if (dist > joystick.radius) {
                dx = (dx / dist) * joystick.radius;
                dy = (dy / dist) * joystick.radius;
                dist = joystick.radius;
            }

            // Normalizar e aplicar deadzone
            const deadzone = joystick.radius * 0.1;
            if (dist < deadzone) {
                joystick.normX = 0;
                joystick.normY = 0;
            } else {
                joystick.normX = dx / joystick.radius;
                joystick.normY = dy / joystick.radius;
            }
            
            // Move o knob (visual) - A translação é relativa ao centro inicial
            joystick.knob.style.transform = `translate(${dx}px, ${dy}px)`;

            sendInput();
            e.preventDefault();
            return;
        }
    }
};

const handleTouchEnd = (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        if (touch.identifier === joystick.id) {
            // Reset Joystick
            joystick.active = false;
            joystick.id = null;
            joystick.normX = 0;
            joystick.normY = 0;

            // Reset visual do knob
            joystick.knob.style.display = 'none';
            joystick.knob.style.transform = 'translate(0, 0)';

            sendInput();
            return;
        }
    }
};

document.addEventListener('touchstart', handleTouchStart, { passive: false });
document.addEventListener('touchmove', handleTouchMove, { passive: false });
document.addEventListener('touchend', handleTouchEnd); 
document.addEventListener('touchcancel', handleTouchEnd);


// ----------------------------------------------------
// GAMEPAD NAVIGATION E AÇÕES (CORRIGIDO E EXPANDIDO)
// ----------------------------------------------------
let lastNavTimestamp = 0; const NAV_DELAY = 150;
function handleGamepadNavigation(direction) {
    if (Date.now() - lastNavTimestamp < NAV_DELAY) return;
    
    // Ações de navegação em painéis abertos
    let elements = []; 
    let cols = 8;
    let maxIndex = 0;
    
    if (uiState.inv) { 
        elements = Array.from(document.querySelectorAll('#inv-grid .slot')); 
        cols = 8; 
        focusArea = 'inventory';
    } 
    else if (uiState.char) {
        const eq_slots = Array.from(document.querySelectorAll('.equip-slots .slot')); // Índices 0-4
        const stat_btns = Array.from(document.querySelectorAll('.stat-row .plus-btn')); // Índices 5-7
        elements = eq_slots.concat(stat_btns); 
        cols = 5; 
        focusArea = 'equipment';
    } 
    else if (uiState.craft) { // NOVO: Navegação no Crafting
        elements = Array.from(document.querySelectorAll('#craft-list .craft-item'));
        cols = 1;
        focusArea = 'craft';
        
        // Navegação vertical simples na lista de receitas
        let newIndex = focusIndex;
        if (direction === 'up') newIndex = Math.max(0, focusIndex - 1);
        else if (direction === 'down') newIndex = Math.min(elements.length - 1, focusIndex + 1);
        else { 
             newIndex = focusIndex;
        }
        
        focusIndex = newIndex;
        updateUI();
        lastNavTimestamp = Date.now();
        return; 
    }
    // NOVO: Navegação no Shop
    else if (uiState.shop) {
        elements = Array.from(document.querySelectorAll('#shop-grid .slot')); 
        cols = 5; 
        focusArea = 'shop';
        
        let newIndex = focusIndex;
        if (direction === 'left') newIndex--; 
        else if (direction === 'right') newIndex++; 
        else if (direction === 'up') newIndex -= cols; 
        else if (direction === 'down') newIndex += cols;
        
        focusIndex = Math.max(0, Math.min(newIndex, elements.length - 1));
        updateUI();
        lastNavTimestamp = Date.now();
        return; 
    }
    else { return; } // Nenhum menu aberto

    maxIndex = elements.length - 1;
    if (elements.length === 0) { 
        focusIndex = 0; 
        updateUI();
        lastNavTimestamp = Date.now();
        return;
    }
    
    let newIndex = focusIndex; 

    if (uiState.inv) {
        // Navegação em grid (Inventário)
        if (direction === 'left') newIndex--; 
        else if (direction === 'right') newIndex++; 
        else if (direction === 'up') newIndex -= cols; 
        else if (direction === 'down') newIndex += cols;
    } else if (uiState.char) {
        // Navegação Mista (Equipamento e Stats)
        
        // Equipamento: Índices 0 a 4 (horizontal)
        if (focusIndex <= 4) {
            if (direction === 'left') newIndex = Math.max(0, newIndex - 1);
            else if (direction === 'right') newIndex = Math.min(4, newIndex + 1);
            else if (direction === 'down') newIndex = 5; // Salta para o primeiro stat (STR)
        }
        
        // Stats: Índices 5 a 7 (vertical)
        else if (focusIndex >= 5 && focusIndex <= 7) {
            if (direction === 'up') newIndex = (newIndex === 5) ? 4 : newIndex - 1; 
            else if (direction === 'down') newIndex = Math.min(7, newIndex + 1);
        }
    }
    
    newIndex = Math.max(0, Math.min(newIndex, maxIndex));
    focusIndex = newIndex; 
    
    updateUI(); 
    lastNavTimestamp = Date.now();
}

function closeAllMenus() {
    uiState.inv=false; uiState.char=false; uiState.shop=false; uiState.craft=false;
    updateUI();
}

function handleGamepadAction() {
    if (!me || !(uiState.inv || uiState.char || uiState.shop || uiState.craft)) return;
    
    if (uiState.char) {
        // Equipamento e Stats
        const eq_slots = ["head", "body", "hand", "rune", "potion"];
        
        if (focusIndex >= 0 && focusIndex <= 4) { 
            // Slots de equipamento (0 a 4)
            const slotName = eq_slots[focusIndex];
            // CORREÇÃO: Usar poção no slot de poção, desequipar outros
            if (slotName === "potion") {
                 socket.emit("potion");
            } else if (me.equipment[slotName]) {
                 socket.emit("unequip", slotName);
            }
        } else if (focusIndex >= 5 && focusIndex <= 7) {
            // Botões de Atributo (5 a 7)
            const statNames = ['str', 'dex', 'int'];
            const stat = statNames[focusIndex - 5];
            // Ação primária: Add Stat
            if (me.pts > 0) {
                socket.emit("add_stat", stat);
            }
        }
    } else if (uiState.inv && me.inventory.length > 0) {
        // Inventário
        const item = me.inventory[focusIndex];
        if (item) { 
            if (item.key === "potion") {
                // CORREÇÃO: Ação primária no inventário usa poção
                socket.emit("potion");
            } else if (item.slot && item.type !== "material" && item.type !== "consumable") {
                // Ação primária: Equipar
                socket.emit("equip", focusIndex);
            } 
        }
    } else if (uiState.craft && recipes.length > 0) { 
        const recipe = recipes[focusIndex];
        if (recipe) {
            socket.emit("craft", {action:"create", recipeIdx: focusIndex});
        }
    } else if (uiState.shop && shopItems.length > 0) {
        const item = shopItems[focusIndex];
        if (item) {
            window.buy(focusIndex); // Chama função de compra
        }
    }
    updateUI();
}

function handleGamepadSecondaryAction() { 
    if (!me) return;
    
    if (uiState.inv && me.inventory.length > 0) {
        // Ação secundária: Dropar (Apenas no Inventário)
        const item = me.inventory[focusIndex];
        if (item) {
            socket.emit("drop", focusIndex);
            if (focusIndex > 0) focusIndex = Math.max(0, focusIndex - 1);
        }
    } else if (uiState.shop) {
        // NOVO: Ação secundária: Vender (Shop)
        // Se o foco estiver no inventário, vende; caso contrário, fecha
        if (focusArea === 'inventory' && me.inventory.length > 0 && focusIndex < me.inventory.length) {
            const item = me.inventory[focusIndex];
            if (item) {
                socket.emit("sell", focusIndex);
                if (focusIndex > 0) focusIndex = Math.max(0, focusIndex - 1);
            } else {
                 closeAllMenus();
            }
        } else {
            closeAllMenus();
        }
    } else {
        // Ação secundária: Cancelar/Fechar Menu
        closeAllMenus();
    }
    updateUI(); 
}

let lastButtons = {};
function handleGamepadInput() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : []; gamepad = gamepads[0]; 
    if (!gamepad) { gamepadActive = false; return; }
    gamepadActive = true; gamepad = navigator.getGamepads()[gamepad.index];
    const stickX = gamepad.axes[0] || 0; const stickY = gamepad.axes[1] || 0; const deadzone = 0.3;
    
    // Mapeamento do stick do gamepad para as chaves de input
    keys.game_x = (Math.abs(stickX) > deadzone) ? stickX : 0; 
    keys.game_y = (Math.abs(stickY) > deadzone) ? stickY : 0;
    
    // Mapeamento D-pad digital
    if (gamepad.buttons[14]?.pressed) keys.game_x = -1; 
    if (gamepad.buttons[15]?.pressed) keys.game_x = 1;  
    if (gamepad.buttons[12]?.pressed) keys.game_y = -1; 
    if (gamepad.buttons[13]?.pressed) keys.game_y = 1;  
    
    sendInput(); 
    
    const processButton = (buttonIndex, action) => {
        const button = gamepad.buttons[buttonIndex]; 
        const isPressed = button?.pressed; 
        const wasPressed = lastButtons[buttonIndex] || false;
        
        // Lógica de Toggle para Botões de Block/Defesa (Botão 2: X/Square)
        if (action === 'block') {
            keys.q = isPressed; // keys.q controla o bloco no sendInput
        }
        
        if (isPressed && !wasPressed) {
            if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume();
            
            // Lógica de Menus (A/X para Ação Primária, B/Circle para Ação Secundária)
            if (uiState.inv || uiState.char || uiState.shop || uiState.craft) {
                if (action === 'attack') handleGamepadAction(); // A/Cross (Equip/Add Stat/Craft/Buy)
                if (action === 'skill') handleGamepadSecondaryAction(); // B/Circle (Drop/Sell/Cancel)
            } 
            // Lógica de Combate
            else {
                const ang = getAttackAngle(); 
                if (action === 'attack') socket.emit("attack", ang); 
                if (action === 'skill') socket.emit("skill", {idx:1, angle:ang});
                if (action === 'dash') socket.emit("dash", getDashAngle()); 
                if (action === 'potion') socket.emit("potion"); 
            }
            
            // Lógica de Abertura de Menus
            if (action === 'inventory') { uiState.inv = !uiState.inv; uiState.char = false; uiState.shop = false; uiState.craft = false; }
            if (action === 'character') { uiState.char = !uiState.char; uiState.inv = false; uiState.shop = false; uiState.craft = false; }
            if (action === 'craft') { uiState.craft = !uiState.craft; uiState.inv = false; uiState.char = false; uiState.shop = false; } // Crafting com RB/R1
            
            if (action === 'inventory' || action === 'character' || action === 'craft') { focusIndex = 0; focusArea = (uiState.inv ? 'inventory' : uiState.char ? 'equipment' : uiState.craft ? 'craft' : 'none'); }
            
            updateUI();
        }
        lastButtons[buttonIndex] = isPressed;
    };
    
    // Mapeamento Botões Gamepad (Xbox/PS)
    processButton(0, 'attack'); 
    processButton(1, 'skill'); 
    processButton(2, 'block'); // NOVO: Botão 2 (X/Square) para Block
    processButton(3, 'dash'); 
    processButton(4, 'potion'); 
    processButton(5, 'craft'); // Botão 5 (RB/R1) para Crafting
    processButton(9, 'inventory'); // Start/Menu button for Inventory
    processButton(8, 'character'); // Back/View button for Character
    
    // Navegação em menus (setas digitais e analógicas)
    if (uiState.inv || uiState.char || uiState.shop || uiState.craft) {
        // D-pad
        if (gamepad.buttons[12]?.pressed && !lastButtons[12]) handleGamepadNavigation('up');
        if (gamepad.buttons[13]?.pressed && !lastButtons[13]) handleGamepadNavigation('down');
        if (gamepad.buttons[14]?.pressed && !lastButtons[14]) handleGamepadNavigation('left');
        if (gamepad.buttons[15]?.pressed && !lastButtons[15]) handleGamepadNavigation('right');
        
        // Sticks (Left Stick)
        if (Math.abs(stickY) > deadzone && Math.abs(stickY) > Math.abs(stickX)) {
             if (stickY < 0 && (!lastNavTimestamp || Date.now() - lastNavTimestamp > NAV_DELAY)) { handleGamepadNavigation('up'); }
             else if (stickY > 0 && (!lastNavTimestamp || Date.now() - lastNavTimestamp > NAV_DELAY)) { handleGamepadNavigation('down'); }
        } else if (Math.abs(stickX) > deadzone && Math.abs(stickX) > Math.abs(stickY)) {
             if (stickX < 0 && (!lastNavTimestamp || Date.now() - lastNavTimestamp > NAV_DELAY)) { handleGamepadNavigation('left'); }
             else if (stickX > 0 && (!lastNavTimestamp || Date.now() - lastNavTimestamp > NAV_DELAY)) { handleGamepadNavigation('right'); }
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

function updateUI() {
    if(!me) return;
    const hpPct = (me.hp/me.stats.maxHp)*100; const mpPct = (me.mp/me.stats.maxMp)*100; const xpPct = (me.xp/(me.level*100))*100;
    let diffName = state.theme === "#f00" ? "HORDE I" : state.theme === "#900" ? "HORDE II" : state.theme === "#102" ? "HELL" : state.theme === "#311" ? "NIGHTMARE" : "NORMAL";

    // 1. ATUALIZAÇÃO DO HUD PC (Sempre atualiza)
    document.getElementById("hp-bar").style.width = hpPct + "%"; 
    document.getElementById("mp-bar").style.width = mpPct + "%"; 
    document.getElementById("xp-bar").style.width = xpPct + "%";
    document.getElementById("hp-txt").innerText = `HP: ${Math.floor(me.hp)}/${me.stats.maxHp}`; 
    document.getElementById("mp-txt").innerText = `MP: ${Math.floor(me.mp)}/${me.stats.maxMp}`; 
    document.getElementById("xp-txt").innerText = `${Math.floor(xpPct)}%`; 
    document.getElementById("lvl-txt").innerText = `${diffName} [${me.level}]`;
    
    // 2. ATUALIZAÇÃO DO HUD MOBILE HORIZONTAL/MINIMALISTA (Sempre atualiza)
    document.getElementById("h-lvl-txt").innerText = `${diffName} [${me.level}]`; 
    document.getElementById("h-gold-txt").innerText = `${me.gold}G`;
    document.getElementById("h-hp-bar").style.width = hpPct + "%"; 
    document.getElementById("h-mp-bar").style.width = mpPct + "%"; 
    document.getElementById("h-xp-bar").style.width = xpPct + "%";

    document.getElementById("cp-pts").innerText = me.pts;
    document.getElementById("val-str").innerText = me.attrs.str; document.getElementById("val-dex").innerText = me.attrs.dex; document.getElementById("val-int").innerText = me.attrs.int;
    document.getElementById("stat-dmg").innerText = me.stats.dmg + ` (CRIT: ${Math.floor((me.stats.crit || 0.01)*100)}%)`; document.getElementById("stat-spd").innerText = Math.floor(me.stats.spd*100);
    document.getElementById("hud-gold").innerText = "GOLD: " + me.gold;

    const uiActionButtons = document.getElementById("ui-action-buttons");
    if (uiState.inv || uiState.char || uiState.shop || uiState.craft) { 
        uiActionButtons.style.display = 'flex'; 
        hideTooltip(); 
    } else { 
        uiActionButtons.style.display = 'none'; 
        hideTooltip(); 
    }

    document.getElementById("inventory").style.display = uiState.inv ? "block" : "none";
    document.getElementById("char-panel").style.display = uiState.char ? "block" : "none";
    document.getElementById("shop-panel").style.display = uiState.shop ? "block" : "none";
    document.getElementById("craft-panel").style.display = uiState.craft ? "block" : "none";

    // LÓGICA DE FOCO E TOOLTIP PARA EQUIPAMENTO E STATS
    const eq_slots = ["head","body","hand","rune","potion"];
    eq_slots.forEach((slot, index) => {
        const el = document.getElementById("eq-"+slot); if (!el) return; 
        el.innerHTML = ""; el.style.outline = 'none'; el.style.outlineOffset = '0px';
        
        // Foco
        if (uiState.char && focusArea === 'equipment' && focusIndex === index) { 
            el.style.outline = '2px solid yellow'; el.style.outlineOffset = '2px'; 
            if (me.equipment[slot]) {
                showTooltip(me.equipment[slot]); 
                // CORREÇÃO: Potion usa, outros desequipam
                if (slot === 'potion') {
                    document.getElementById('ui-btn-equip').innerText = 'USAR (A)';
                } else {
                    document.getElementById('ui-btn-equip').innerText = 'DESEQUIPAR (A)';
                }
            } else { 
                hideTooltip(); 
                document.getElementById('ui-btn-equip').innerText = 'ESPAÇO VAZIO (A)'; 
            }
            document.getElementById('ui-btn-drop').innerText = 'CANCELAR (B)';
        }
        
        // Item Visual e Interação
        if(me.equipment[slot]) {
            const it = me.equipment[slot];
            el.style.borderColor = it.color; el.innerHTML = getIcon(it.key); el.style.boxShadow = it.rarity === "legendary" ? "0 0 5px #f0f" : "none";
            el.onmouseover = () => showTooltip(it); el.onmouseout = hideTooltip; 
            // CORREÇÃO: Poção no slot de equipment usa ao clicar
            el.onclick = () => slot === 'potion' ? socket.emit("potion") : socket.emit("unequip", slot);
        } else { 
            el.style.borderColor = "#0f0"; el.style.boxShadow = "none"; el.onclick=null; 
        }
    });
    
    // LÓGICA DE FOCO PARA STATS
    const stat_btns = ['str', 'dex', 'int'];
    const focusIndexOffset = eq_slots.length; // 5
    stat_btns.forEach((stat, index) => {
        const btn = document.getElementById("btn-"+stat);
        const globalIndex = index + focusIndexOffset;
        btn.style.outline = 'none'; btn.style.outlineOffset = '0px';
        
        if (uiState.char && focusArea === 'equipment' && focusIndex === globalIndex) {
             btn.style.outline = '2px solid yellow'; btn.style.outlineOffset = '2px';
             hideTooltip();
             if (me.pts > 0) document.getElementById('ui-btn-equip').innerText = `ADICIONAR ${stat.toUpperCase()} (A)`; 
             else document.getElementById('ui-btn-equip').innerText = `PONTOS ESGOTADOS`;
             document.getElementById('ui-btn-drop').innerText = 'CANCELAR (B)';
        }
    });
    
    // LÓGICA DE FOCO E TOOLTIP PARA INVENTÁRIO
    const ig = document.getElementById("inv-grid"); ig.innerHTML = "";
    const invCount = me.inventory.length;
    if (uiState.inv && focusArea === 'inventory' && invCount > 0 && focusIndex >= invCount) focusIndex = Math.max(0, invCount - 1); else if (uiState.inv && invCount === 0) focusIndex = 0;

    // CORREÇÃO: Garante que o inventário é renderizado corretamente no PC e no Mobile.
    me.inventory.forEach((it, idx) => {
        // CORREÇÃO: Adiciona verificação de item para evitar erro de item undefined
        if (!it) return;

        const d = document.createElement("div"); d.className = "slot"; d.style.borderColor = it.color; d.style.outline = 'none'; d.style.outlineOffset = '0px';
        
        // Foco
        if (uiState.inv && focusArea === 'inventory' && focusIndex === idx) {
             d.style.outline = '2px solid yellow'; d.style.outlineOffset = '2px'; showTooltip(it); 
             if (it.key === 'potion') {
                 // CORREÇÃO: Poção no inventário usa, não equipa
                 document.getElementById('ui-btn-equip').innerText = 'USAR POÇÃO (A)';
             } else if (it.slot && it.type !== "material" && it.type !== "consumable") {
                document.getElementById('ui-btn-equip').innerText = 'EQUIPAR (A)';
             } else { 
                document.getElementById('ui-btn-equip').innerText = 'ITEM DE CRAFT/VENDA';
             }
             document.getElementById('ui-btn-drop').innerText = 'DROPAR (B)';
        } 
        
        // Item Visual
        if(it.rarity === "legendary") d.style.boxShadow = "0 0 4px " + it.color;
        d.innerHTML = getIcon(it.key);
        if(it.sockets && it.sockets.length > 0) {
            const socks = document.createElement("div"); socks.style.cssText="position:absolute;bottom:0;right:0;display:flex;";
            it.sockets.forEach((s, i) => { const dot = document.createElement("div"); dot.style.cssText=`width:4px;height:4px;background:${it.gems[i]?it.gems[i].color:"#222"};border:1px solid #555;margin-right:1px;`; socks.appendChild(dot); });
            d.appendChild(socks);
        }
        d.draggable = true; d.ondragstart = (e) => { dragItem = { idx, item: it }; }; d.ondragover = (e) => e.preventDefault();
        d.ondrop = (e) => { e.preventDefault(); if(dragItem && dragItem.item.type === "gem" && it.type !== "gem") socket.emit("craft", {action:"socket", itemIdx:idx, gemIdx:dragItem.idx}); };
        d.onmouseover = () => showTooltip(it); d.onmouseout = hideTooltip; 
        
        // FIX: CLIQUE MOUSE 1 (ESQUERDO) - Removendo e.preventDefault()/e.stopPropagation() para clique simples.
        d.onclick = () => { 
            if(it.key === "potion") {
                socket.emit("potion"); 
            } else if(it.slot && it.type !== "material" && it.type !== "consumable") {
                // EQUIPA o item no clique simples
                socket.emit("equip", idx); 
            }
        }; 
        
        // MOUSE DIREITO (DROPAR)
        d.oncontextmenu = (e) => { 
            e.preventDefault(); 
            socket.emit("drop", idx); 
        };
        
        ig.appendChild(d);
    });

    // LÓGICA DE FOCO E TOOLTIP PARA CRAFTING
    if (uiState.craft) {
        const craftList = document.getElementById("craft-list");
        const recipeElements = Array.from(craftList.children);
        
        if (focusIndex >= recipes.length) focusIndex = Math.max(0, recipes.length - 1);
        
        recipeElements.forEach((d, idx) => {
            d.style.outline = 'none';
            const recipe = recipes[idx];
            if (focusArea === 'craft' && focusIndex === idx) {
                 d.style.outline = '2px solid yellow'; 
                 document.getElementById('ui-btn-equip').innerText = `CRAFT ${recipe.res.toUpperCase()} (A)`;
                 document.getElementById('ui-btn-drop').innerText = 'SAIR (B)';
            }
        });
    }
    
    // LÓGICA DE FOCO E BOTÕES PARA SHOP
    if(uiState.shop) {
        const sg = document.getElementById("shop-grid"); sg.innerHTML = "";
        const shopCount = shopItems.length;
        if (focusIndex >= shopCount) focusIndex = Math.max(0, shopCount - 1);

        shopItems.forEach((it, idx) => {
            const d = document.createElement("div"); d.className = "slot"; d.style.borderColor = it.color; d.style.outline = 'none'; d.style.outlineOffset = '0px';
            
            // Foco
            if (focusArea === 'shop' && focusIndex === idx) {
                d.style.outline = '2px solid yellow'; d.style.outlineOffset = '2px'; showTooltip(it);
                document.getElementById('ui-btn-equip').innerText = `COMPRAR ${it.price}G (A)`;
                document.getElementById('ui-btn-drop').innerText = 'VENDER/SAIR (B)';
            }
            
            d.innerHTML = getIcon(it.key); d.onmouseover = () => showTooltip(it); d.onmouseout = hideTooltip; d.onclick = () => window.buy(idx);
            sg.appendChild(d);
        });
        document.getElementById("btn-shop-close").onclick = closeAllMenus;
    }
    
    // Caso especial: Inventário vazio
    if ((uiState.inv && invCount === 0) || (uiState.shop && shopItems.length === 0)) { 
        hideTooltip(); 
        document.getElementById('ui-btn-equip').innerText = 'SEM ITENS'; 
        document.getElementById('ui-btn-drop').innerText = 'SAIR (B)'; 
    } 
    
    if (!uiState.inv && !uiState.char && !uiState.craft && !uiState.shop) uiActionButtons.style.display = 'none';
}

// Apenas a seção updateUI e getIcon precisa ser ajustada.

function getIcon(key) {
    // CORREÇÃO: Adiciona verificação de key
    if (!key) return "❓"; 
    
    // EXPANSÃO: Mais variação visual para tipos de armas
    if(key.includes("sword")) {
        const swords = ["🗡️", "⚔️", "🔪"]; return swords[Math.floor(Math.random()*swords.length)];
    }
    if(key.includes("axe")) {
        const axes = ["🪓", "⚒️", "⛏️"]; return axes[Math.floor(Math.random()*axes.length)];
    }
    if(key.includes("dagger")) {
        const daggers = ["🗡️", "🔪", "✂️"]; return daggers[Math.floor(Math.random()*daggers.length)];
    }
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
    return "📦";
}

function updateUI() {
    if(!me) return;
    const hpPct = (me.hp/me.stats.maxHp)*100; const mpPct = (me.mp/me.stats.maxMp)*100; const xpPct = (me.xp/(me.level*100))*100;
    let diffName = state.theme === "#f00" ? "HORDE I" : state.theme === "#900" ? "HORDE II" : state.theme === "#102" ? "HELL" : state.theme === "#311" ? "NIGHTMARE" : "NORMAL";

    // 1. ATUALIZAÇÃO DO HUD PC (Sempre atualiza)
    document.getElementById("hp-bar").style.width = hpPct + "%"; 
    document.getElementById("mp-bar").style.width = mpPct + "%"; 
    document.getElementById("xp-bar").style.width = xpPct + "%";
    document.getElementById("hp-txt").innerText = `HP: ${Math.floor(me.hp)}/${me.stats.maxHp}`; 
    document.getElementById("mp-txt").innerText = `MP: ${Math.floor(me.mp)}/${me.stats.maxMp}`; 
    document.getElementById("xp-txt").innerText = `${Math.floor(xpPct)}%`; 
    document.getElementById("lvl-txt").innerText = `${diffName} [${me.level}]`;
    
    // 2. ATUALIZAÇÃO DO HUD MOBILE HORIZONTAL/MINIMALISTA (Sempre atualiza)
    document.getElementById("h-lvl-txt").innerText = `${diffName} [${me.level}]`; 
    document.getElementById("h-gold-txt").innerText = `${me.gold}G`;
    document.getElementById("h-hp-bar").style.width = hpPct + "%"; 
    document.getElementById("h-mp-bar").style.width = mpPct + "%"; 
    document.getElementById("h-xp-bar").style.width = xpPct + "%";

    document.getElementById("cp-pts").innerText = me.pts;
    document.getElementById("val-str").innerText = me.attrs.str; document.getElementById("val-dex").innerText = me.attrs.dex; document.getElementById("val-int").innerText = me.attrs.int;
    document.getElementById("stat-dmg").innerText = me.stats.dmg + ` (CRIT: ${Math.floor((me.stats.crit || 0.01)*100)}%)`; document.getElementById("stat-spd").innerText = Math.floor(me.stats.spd*100);
    document.getElementById("hud-gold").innerText = "GOLD: " + me.gold;

    const uiActionButtons = document.getElementById("ui-action-buttons");
    if (uiState.inv || uiState.char || uiState.shop || uiState.craft) { 
        uiActionButtons.style.display = 'flex'; 
        hideTooltip(); 
    } else { 
        uiActionButtons.style.display = 'none'; 
        hideTooltip(); 
    }

    document.getElementById("inventory").style.display = uiState.inv ? "block" : "none";
    document.getElementById("char-panel").style.display = uiState.char ? "block" : "none";
    document.getElementById("shop-panel").style.display = uiState.shop ? "block" : "none";
    document.getElementById("craft-panel").style.display = uiState.craft ? "block" : "none";

    // LÓGICA DE FOCO E TOOLTIP PARA EQUIPAMENTO E STATS
    const eq_slots = ["head","body","hand","rune","potion"];
    eq_slots.forEach((slot, index) => {
        const el = document.getElementById("eq-"+slot); if (!el) return; 
        el.innerHTML = ""; el.style.outline = 'none'; el.style.outlineOffset = '0px';
        
        // Foco
        if (uiState.char && focusArea === 'equipment' && focusIndex === index) { 
            el.style.outline = '2px solid yellow'; el.style.outlineOffset = '2px'; 
            if (me.equipment[slot]) {
                showTooltip(me.equipment[slot]); 
                // CORREÇÃO: Potion usa, outros desequipam
                if (slot === 'potion') {
                    document.getElementById('ui-btn-equip').innerText = 'USAR (A)';
                } else {
                    document.getElementById('ui-btn-equip').innerText = 'DESEQUIPAR (A)';
                }
            } else { 
                hideTooltip(); 
                document.getElementById('ui-btn-equip').innerText = 'ESPAÇO VAZIO (A)'; 
            }
            document.getElementById('ui-btn-drop').innerText = 'CANCELAR (B)';
        }
        
        // Item Visual e Interação
        if(me.equipment[slot]) {
            const it = me.equipment[slot];
            el.style.borderColor = it.color; el.innerHTML = getIcon(it.key); el.style.boxShadow = it.rarity === "legendary" ? "0 0 5px #f0f" : "none";
            el.onmouseover = () => showTooltip(it); el.onmouseout = hideTooltip; 
            // CORREÇÃO: Poção no slot de equipment usa ao clicar. Outros desequipam.
            el.onclick = () => slot === 'potion' ? socket.emit("potion") : socket.emit("unequip", slot);
        } else { 
            el.style.borderColor = "#0f0"; el.style.boxShadow = "none"; el.onclick=null; 
        }
    });
    
    // LÓGICA DE FOCO PARA STATS
    const stat_btns = ['str', 'dex', 'int'];
    const focusIndexOffset = eq_slots.length; // 5
    stat_btns.forEach((stat, index) => {
        const btn = document.getElementById("btn-"+stat);
        const globalIndex = index + focusIndexOffset;
        btn.style.outline = 'none'; btn.style.outlineOffset = '0px';
        
        if (uiState.char && focusArea === 'equipment' && focusIndex === globalIndex) {
             btn.style.outline = '2px solid yellow'; btn.style.outlineOffset = '2px';
             hideTooltip();
             if (me.pts > 0) document.getElementById('ui-btn-equip').innerText = `ADICIONAR ${stat.toUpperCase()} (A)`; 
             else document.getElementById('ui-btn-equip').innerText = `PONTOS ESGOTADOS`;
             document.getElementById('ui-btn-drop').innerText = 'CANCELAR (B)';
        }
    });
    
    // LÓGICA DE FOCO E TOOLTIP PARA INVENTÁRIO
    const ig = document.getElementById("inv-grid"); ig.innerHTML = "";
    const invCount = me.inventory.length;
    if (uiState.inv && focusArea === 'inventory' && invCount > 0 && focusIndex >= invCount) focusIndex = Math.max(0, invCount - 1); else if (uiState.inv && invCount === 0) focusIndex = 0;

    // CORREÇÃO: Garante que o inventário é renderizado corretamente no PC e no Mobile.
    me.inventory.forEach((it, idx) => {
        // CORREÇÃO: Adiciona verificação de item para evitar erro de item undefined
        if (!it) return;

        const d = document.createElement("div"); d.className = "slot"; d.style.borderColor = it.color; d.style.outline = 'none'; d.style.outlineOffset = '0px';
        
        // Foco
        if (uiState.inv && focusArea === 'inventory' && focusIndex === idx) {
             d.style.outline = '2px solid yellow'; d.style.outlineOffset = '2px'; showTooltip(it); 
             if (it.key === 'potion') {
                 // CORREÇÃO: Poção no inventário usa, não equipa
                 document.getElementById('ui-btn-equip').innerText = 'USAR POÇÃO (A)';
             } else if (it.slot && it.type !== "material" && it.type !== "consumable") {
                document.getElementById('ui-btn-equip').innerText = 'EQUIPAR (A)';
             } else { 
                document.getElementById('ui-btn-equip').innerText = 'ITEM DE CRAFT/VENDA';
             }
             document.getElementById('ui-btn-drop').innerText = 'DROPAR (B)';
        } 
        
        // Item Visual
        if(it.rarity === "legendary") d.style.boxShadow = "0 0 4px " + it.color;
        d.innerHTML = getIcon(it.key);
        if(it.sockets && it.sockets.length > 0) {
            const socks = document.createElement("div"); socks.style.cssText="position:absolute;bottom:0;right:0;display:flex;";
            it.sockets.forEach((s, i) => { const dot = document.createElement("div"); dot.style.cssText=`width:4px;height:4px;background:${it.gems[i]?it.gems[i].color:"#222"};border:1px solid #555;margin-right:1px;`; socks.appendChild(dot); });
            d.appendChild(socks);
        }
        d.draggable = true; d.ondragstart = (e) => { dragItem = { idx, item: it }; }; d.ondragover = (e) => e.preventDefault();
        d.ondrop = (e) => { e.preventDefault(); if(dragItem && dragItem.item.type === "gem" && it.type !== "gem") socket.emit("craft", {action:"socket", itemIdx:idx, gemIdx:dragItem.idx}); };
        d.onmouseover = () => showTooltip(it); d.onmouseout = hideTooltip; 
        
        // CORREÇÃO CRÍTICA: O clique no PC agora deve funcionar corretamente para Equipar/Usar.
        // Item equipável ou consumível (poção)
        d.onclick = () => { 
            if(it.key === "potion") {
                socket.emit("potion"); 
            } else if(it.slot && it.type !== "material" && it.type !== "consumable") {
                socket.emit("equip", idx); 
            }
        }; 
        
        // CORREÇÃO: Mouse direito (contextmenu) deve prevenir o menu padrão
        d.oncontextmenu = (e) => { 
            e.preventDefault(); 
            socket.emit("drop", idx); 
        };
        
        ig.appendChild(d);
    });

    // LÓGICA DE FOCO E TOOLTIP PARA CRAFTING
    if (uiState.craft) {
        const craftList = document.getElementById("craft-list");
        const recipeElements = Array.from(craftList.children);
        
        if (focusIndex >= recipes.length) focusIndex = Math.max(0, recipes.length - 1);
        
        recipeElements.forEach((d, idx) => {
            d.style.outline = 'none';
            const recipe = recipes[idx];
            if (focusArea === 'craft' && focusIndex === idx) {
                 d.style.outline = '2px solid yellow'; 
                 document.getElementById('ui-btn-equip').innerText = `CRAFT ${recipe.res.toUpperCase()} (A)`;
                 document.getElementById('ui-btn-drop').innerText = 'SAIR (B)';
            }
        });
    }
    
    // LÓGICA DE FOCO E BOTÕES PARA SHOP
    if(uiState.shop) {
        const sg = document.getElementById("shop-grid"); sg.innerHTML = "";
        const shopCount = shopItems.length;
        if (focusIndex >= shopCount) focusIndex = Math.max(0, shopCount - 1);

        shopItems.forEach((it, idx) => {
            const d = document.createElement("div"); d.className = "slot"; d.style.borderColor = it.color; d.style.outline = 'none'; d.style.outlineOffset = '0px';
            
            // Foco
            if (focusArea === 'shop' && focusIndex === idx) {
                d.style.outline = '2px solid yellow'; d.style.outlineOffset = '2px'; showTooltip(it);
                document.getElementById('ui-btn-equip').innerText = `COMPRAR ${it.price}G (A)`;
                document.getElementById('ui-btn-drop').innerText = 'VENDER/SAIR (B)';
            }
            
            d.innerHTML = getIcon(it.key); d.onmouseover = () => showTooltip(it); d.onmouseout = hideTooltip; d.onclick = () => window.buy(idx);
            sg.appendChild(d);
        });
        document.getElementById("btn-shop-close").onclick = closeAllMenus;
    }
    
    // Caso especial: Inventário vazio
    if ((uiState.inv && invCount === 0) || (uiState.shop && shopItems.length === 0)) { 
        hideTooltip(); 
        document.getElementById('ui-btn-equip').innerText = 'SEM ITENS'; 
        document.getElementById('ui-btn-drop').innerText = 'SAIR (B)'; 
    } 
    
    if (!uiState.inv && !uiState.char && !uiState.craft && !uiState.shop) uiActionButtons.style.display = 'none';
}

function showTooltip(it) {
    // CORREÇÃO: Adiciona verificação de item para evitar erro de item undefined
    if (!it) return;

    let html = `<b style="color:${it.color}">${it.name}</b><br><span style="color:#aaa">${(it.type || "UNKNOWN").toUpperCase()}</span>`;
    if(it.price) html += `<br>Price: ${it.price}G`;
    
    // Adiciona o preço de venda se estiver no shop ou inventário
    const isSellable = (uiState.inv || uiState.shop) && it.key !== 'gold';
    if (isSellable) {
        const sellPrice = Math.floor((it.price || 1) * 0.5);
        html += `<br><span style="color:#fff">Sell Value: ${sellPrice}G</span>`;
    }

    if(it.stats) { for(let k in it.stats) { 
        if(k==="crit") html += `<br>Crit Chance: ${Math.floor(it.stats[k]*100)}%`; 
        else if(k==="cd_red") html += `<br>Cooldown Red: ${Math.floor(it.stats[k]*100)}%`;
        else if(k==="spd" && it.stats[k] > 0.01) html += `<br>Speed: +${Math.floor(it.stats[k]*100)}%`;
        else if (k !== "spd") html += `<br>${k.toUpperCase()}: ${it.stats[k]}`; 
    } }
    if(it.sockets && it.sockets.length > 0) { html += `<br><br>SOCKETS [${it.gems.length}/${it.sockets.length}]`; it.gems.forEach(g => html += `<br><span style="color:${g.color}">* ${g.desc}</span>`); }
    tooltip.innerHTML = html; tooltip.style.display = "block";
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

// NOVO: Função para desenhar indicadores de jogadores fora da tela
function drawOffscreenPlayerIndicators() {
    if (!me || !state.pl) return;

    const screenCenterX = canvas.width / 2;
    const screenCenterY = canvas.height / 2;
    // Define um raio ligeiramente menor que o menor eixo da tela
    const indicatorRadius = Math.min(screenCenterX, screenCenterY) - 20; 
    const indicatorSize = 8;
    const ox = -cam.x, oy = -cam.y;
    
    // Filtra outros jogadores
    const otherPlayers = Object.values(state.pl).filter(p => p.id !== myId);

    otherPlayers.forEach(p => {
        const playerScreenX = ox + p.x * SCALE + SCALE/2;
        const playerScreenY = oy + p.y * SCALE + SCALE/2;

        const dx = playerScreenX - screenCenterX;
        const dy = playerScreenY - screenCenterY;
        const distSq = dx * dx + dy * dy;
        const screenRadiusSq = indicatorRadius * indicatorRadius;

        // Se o jogador estiver dentro do raio do indicador (ou na tela), ignora
        if (distSq < screenRadiusSq) {
             // O jogador está na tela ou muito perto, não precisa de indicador
            return;
        }

        const angle = Math.atan2(dy, dx);
        
        // Ponto de interseção na borda imaginária
        let ix = screenCenterX + Math.cos(angle) * indicatorRadius;
        let iy = screenCenterY + Math.sin(angle) * indicatorRadius;

        // Desenha o triângulo (indicador)
        ctx.save();
        ctx.translate(ix, iy);
        ctx.rotate(angle); 
        ctx.fillStyle = "#0ff"; // Cor ciano para outros jogadores
        ctx.shadowBlur = 5;
        ctx.shadowColor = "#0ff";

        // Desenha um triângulo apontando para o centro (direção oposta ao ângulo de rotação)
        ctx.beginPath();
        // Move o triângulo ligeiramente para dentro do raio para não tocar a borda imediata
        ctx.moveTo(indicatorSize, 0);
        ctx.lineTo(-indicatorSize, -indicatorSize);
        ctx.lineTo(-indicatorSize, indicatorSize);
        ctx.closePath();
        ctx.fill();
        
        ctx.font = "8px Courier New";
        ctx.textAlign = "center";
        ctx.fillText(p.name, 0, -indicatorSize - 2); // Nome acima do triângulo (girado)

        ctx.restore();
        ctx.shadowBlur = 0;
    });
}

function draw() {
    requestAnimationFrame(draw);
    handleGamepadInput();
    
    const mobileControls = document.getElementById("mobile-controls"); 
    const mobileMenuButtons = document.getElementById("mobile-menu-buttons"); 
    const mobileHorizontalHud = document.getElementById("hud-horizontal-mobile");
    const hudGold = document.getElementById("hud-gold");
    const hudBottom = document.querySelector('.hud-bottom');
    const gameLogContainer = document.getElementById("game-log-container");
    
    // CORREÇÃO FINAL DA INTERFACE MOBILE
    if(isMobile) {
        // 1. HUD Display: Minimalista for all mobile
        mobileHorizontalHud.style.display = "flex"; 
        hudBottom.style.display = "none"; 
        gameLogContainer.style.display = "none"; // Esconde log no mobile para simplicidade

        // 2. Control Display: Show Joystick only when Gamepad is NOT active
        if (!gamepadActive) {
            mobileControls.style.display = "block";
            hudGold.style.display = "none"; 
        } else { 
            mobileControls.style.display = "none"; 
            hudGold.style.display = "block"; // Show PC Gold for gamepad (like PC)
        }
        mobileMenuButtons.style.display = "flex";
    } else { 
        // PC (Desktop)
        mobileControls.style.display = "none"; 
        mobileMenuButtons.style.display = "none"; 
        mobileHorizontalHud.style.display = "none"; 
        hudBottom.style.display = "flex";
        hudGold.style.display = "block"; 
        gameLogContainer.style.display = "block"; // Mostra log no PC
    }

    ctx.fillStyle = "#000"; ctx.fillRect(0,0,canvas.width,canvas.height);
    if(!me) return;

    cam.x += (me.x*SCALE - canvas.width/2 - cam.x)*0.2; cam.y += (me.y*SCALE - canvas.height/2 - cam.y)*0.2;
    const ox = -cam.x, oy = -cam.y; const now = Date.now();
    const lightRadiusTiles = state.lightRadius; const lightRadiusPixels = lightRadiusTiles * SCALE;
    const playerScreenX = ox + me.x * SCALE + SCALE/2; const playerScreenY = oy + me.y * SCALE + SCALE/2;

    const map = state.map; const explored = state.explored || []; const theme = state.theme || "#222";
    if(map.length){
        const sy=Math.floor(cam.y/SCALE), ey=sy+Math.ceil(canvas.height/SCALE)+1; const sx=Math.floor(cam.x/SCALE), ex=sx+Math.ceil(canvas.width/SCALE)+1;
        for(let y=sy; y<ey; y++){ if(!map[y]) continue; for(let x=sx; x<ex; x++){ if(map[y][x]===0) { ctx.fillStyle="#080808"; ctx.fillRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE); if((x+y)%3===0) { ctx.fillStyle=theme; ctx.fillRect(ox+x*SCALE+6, oy+y*SCALE+6, 2, 2); } } else if(map[y][x]===1) { ctx.fillStyle="#000"; ctx.fillRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE); ctx.strokeStyle=theme; ctx.strokeRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE); } } }
    }
    
    if(state.props) state.props.forEach(p => { const px=ox+p.x*SCALE, py=oy+p.y*SCALE; if(p.type==="rock") { ctx.fillStyle="#333"; ctx.fillRect(px,py,4,3); } else if(p.type==="bones") { ctx.fillStyle="#ccc"; ctx.fillRect(px,py,3,1); ctx.fillRect(px+2,py+1,3,1); } else { ctx.fillStyle="#232"; ctx.fillRect(px,py,2,4); ctx.fillRect(px+3,py+1,2,3); } });
    for(let k in state.it){ let i=state.it[k]; let yb = Math.sin(now/200)*2; if(i.item.key === "gold") { ctx.shadowBlur=5; ctx.shadowColor="#fb0"; ctx.fillStyle="#fb0"; ctx.fillRect(ox+i.x*SCALE+4, oy+i.y*SCALE+6+yb, 3, 3); ctx.shadowBlur=0; } else { ctx.shadowBlur = i.item.rarity==="legendary"?10:i.item.rarity==="rare"?5:0; ctx.shadowColor=i.item.color; ctx.fillStyle=i.item.color; ctx.fillRect(ox+i.x*SCALE+4, oy+i.y*SCALE+4+yb, 8, 8); ctx.shadowBlur=0; } }

    if(state.pr) state.pr.forEach(p => {
        ctx.save(); ctx.translate(ox+p.x*SCALE, oy+p.y*SCALE); ctx.rotate(p.angle || 0); ctx.shadowBlur=10;
        if(p.type === "arrow") { ctx.shadowColor="#ff0"; ctx.fillStyle = "#ff0"; ctx.fillRect(-6, -1, 12, 2); } 
        else if (p.type === "fireball") { ctx.shadowColor="#f80"; ctx.fillStyle = "#f80"; ctx.beginPath(); ctx.arc(0,0, 4, 0, Math.PI*2); ctx.fill(); }
        else if (p.type === "meteor") { ctx.shadowColor="#f00"; ctx.fillStyle = "#f00"; ctx.beginPath(); ctx.arc(0,0, 8, 0, Math.PI*2); ctx.fill(); } 
        else if (p.type === "web") { ctx.shadowColor="#fff"; ctx.strokeStyle="#fff"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(-4,-4); ctx.lineTo(4,4); ctx.moveTo(4,-4); ctx.lineTo(-4,4); ctx.stroke(); }
        else if (p.type === "laser") { ctx.shadowColor="#f0f"; ctx.fillStyle="#f0f"; ctx.fillRect(-10, -2, 20, 4); }
        else if (p.type === "frostball") { ctx.shadowColor="#0ff"; ctx.fillStyle="#0ff"; ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2); ctx.fill(); }
        else { ctx.shadowColor="#0ff"; ctx.fillStyle = "#0ff"; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill(); }
        ctx.shadowBlur=0; ctx.restore();
    });

    for(let i=effects.length-1; i>=0; i--) {
        let e = effects[i]; e.life--; if(e.life<=0) { effects.splice(i,1); continue; }
        const x = ox + e.x*SCALE, y = oy + e.y*SCALE; ctx.shadowBlur=10; ctx.shadowColor="#fff";
        if(e.type==="slash") { ctx.strokeStyle=`rgba(255,255,255,${e.life/10})`; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(x,y,20,e.angle-0.8,e.angle+0.8); ctx.stroke(); } 
        else if(e.type==="spin") { ctx.strokeStyle=`rgba(255, 255, 0, ${e.life/20})`; ctx.lineWidth=4; ctx.beginPath(); const radius = 35 - (20 - e.life)*2; if(radius > 0) ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.stroke(); }
        else if(e.type==="nova") { ctx.strokeStyle=`rgba(255,0,0,${e.life/(e.life>15?20:10)})`; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,30-e.life,0,6.28); ctx.stroke(); }
        else if(e.type==="alert") { ctx.fillStyle="#f00"; ctx.font="bold 16px Courier New"; ctx.textAlign="center"; ctx.fillText("!", x, y-20); }
        ctx.shadowBlur=0;
    }

    const ents = [...Object.values(state.mb), ...Object.values(state.pl)]; ents.sort((a,b)=>a.y-b.y);
    ents.forEach(e => {
        const x = ox+e.x*SCALE+SCALE/2, y = oy+e.y*SCALE+SCALE/2; const s = e.size || 12;
        if(e.equipment && e.equipment.body) {
             if(e.equipment.body.rarity === "legendary") drawAura(x, y, "#f0f", 15); else if(e.equipment.body.rarity === "rare") drawAura(x, y, "#ff0", 8);
        }
        if(e.boss) drawAura(x, y, "#f00", 10);

        ctx.save(); ctx.translate(x, y);
        let blink = e.hitFlash>0; let dirX = (e.vx > 0.01) ? 1 : (e.vx < -0.01) ? -1 : 1; 
        if (e.id === myId) {
            // Lógica de direção do corpo baseada em Mouse (PC) ou Movimento (Mobile/Gamepad/Joystick)
            if (!isMobile && !gamepadActive) { dirX = (mouse.x > canvas.width/2) ? 1 : -1; } 
            else { 
                const currentInputX = joystick.normX || keys.game_x || (keys.a ? -1 : keys.d ? 1 : 0);
                if (Math.abs(currentInputX) > 0.1) dirX = Math.sign(currentInputX); 
                else dirX = (e.vx > 0.01) ? 1 : (e.vx < -0.01) ? -1 : 1; 
            }
        } else { dirX = (e.vx > 0.01) ? 1 : (e.vx < -0.01) ? -1 : 1; }
        ctx.scale(dirX, 1);

        if(e.ai==="resource") { if(e.drop==="wood") { ctx.fillStyle="#420"; ctx.fillRect(-3,-2,6,8); ctx.fillStyle="#141"; ctx.beginPath(); ctx.moveTo(0,-12); ctx.lineTo(-8,-2); ctx.lineTo(0,-2); ctx.lineTo(8,-2); ctx.fill(); } else { ctx.fillStyle="#666"; ctx.beginPath(); ctx.arc(0,0,7,0,Math.PI*2); ctx.fill(); } }
        else if(e.npc) { ctx.fillStyle="#0aa"; ctx.fillRect(-5,-8,10,14); ctx.fillStyle="#fff"; ctx.fillRect(-2,-6,4,4); ctx.font="10px monospace"; ctx.fillStyle="#0f0"; ctx.fillText("$", -3, -15); }
        else if(e.boss) { ctx.shadowBlur=15; ctx.shadowColor=e.state==="rage"?"#f00":"#fff"; ctx.fillStyle=blink?"#fff": (e.state==="rage"?"#f00":"#800"); ctx.fillRect(-s/2,-s/2,s,s); ctx.fillStyle="#f00"; ctx.fillRect(-8,-8,4,4); ctx.fillRect(4,-8,4,4); ctx.shadowBlur=0; }
        else if(e.type === "imp") { ctx.fillStyle = blink?"#fff":e.color||"#f80"; ctx.fillRect(-4,-4,8,8); ctx.fillStyle="#000"; ctx.fillRect(-2,-2,4,4); }
        else if(e.type === "succubus") { ctx.fillStyle = blink?"#fff":e.color||"#f0f"; ctx.fillRect(-5,-8,10,14); ctx.fillStyle="#000"; ctx.fillRect(-3,-4,6,2); }
        else if(e.type === "hellknight") { ctx.fillStyle = blink?"#fff":e.color||"#900"; ctx.fillRect(-7, -8, 14, 14); ctx.fillStyle = "#000"; ctx.fillRect(-8, -10, 16, 2); }
        else if(e.type === "rat") { ctx.fillStyle = blink?"#fff":"#864"; ctx.fillRect(-5, 0, 10, 6); ctx.fillStyle = "#f88"; ctx.fillRect(-6, 2, 2, 2); ctx.fillRect(5, 4, 4, 1); } 
        else if(e.type === "bat") { ctx.fillStyle = blink?"#fff":"#444"; ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(-8,-5); ctx.lineTo(0,-2); ctx.lineTo(8,-5); ctx.fill(); } 
        else if(e.type === "slime") { ctx.fillStyle = blink?"#fff":`rgba(0,255,0,0.7)`; ctx.fillRect(-5, -2, 10, 8); ctx.fillStyle = "#0f0"; ctx.fillRect(-3, -4, 6, 2); }
        else if(e.type === "goblin") { ctx.fillStyle = blink?"#fff":"#484"; ctx.fillRect(-4, -6, 8, 12); ctx.fillStyle = "#000"; ctx.fillRect(-2, -4, 4, 2); }
        else if(e.type === "skeleton") { ctx.fillStyle = blink?"#fff":"#ccc"; ctx.fillRect(-3, -8, 6, 6); ctx.fillRect(-2, 0, 4, 8); ctx.fillStyle = "#000"; ctx.fillRect(0, -6, 2, 2); }
        else if(e.type === "orc") { ctx.fillStyle = blink?"#fff":"#252"; ctx.fillRect(-7, -8, 14, 14); ctx.fillStyle = "#131"; ctx.fillRect(-8, -10, 4, 4); ctx.fillStyle = "#eee"; ctx.fillRect(2, -4, 2, 4); }
        else if(e.type === "demon") { ctx.fillStyle = blink?"#fff":"#900"; ctx.fillRect(-6, -8, 12, 12); ctx.fillStyle = "#000"; ctx.fillRect(-8, -10, 16, 2); ctx.fillRect(2, -12, 2, 4); }
        else if(e.type === "chest") { ctx.fillStyle = "#a80"; ctx.fillRect(-6, -4, 12, 8); ctx.fillStyle="#ff0"; ctx.fillRect(-1, -2, 2, 2); }
        else if(e.class) {
            let c = e.class; ctx.fillStyle = blink?"#fff" : (c==="knight"?"#668":c==="hunter"?"#464":"#448"); ctx.fillRect(-4, -6, 8, 12);
            if(e.equipment.head) { ctx.fillStyle=e.equipment.head.color; ctx.fillRect(-4,-8,8,4); }
            if(e.equipment.body) { ctx.fillStyle=e.equipment.body.color; ctx.fillRect(-3,-4,6,6); }
            if(e.equipment.hand) {
                let k = e.equipment.hand.key;
                if(k.includes("sword")||k.includes("axe")||k.includes("dagger")) { ctx.fillStyle="#ddd"; ctx.fillRect(4, -4, 2, 10); ctx.fillStyle="#840"; ctx.fillRect(3, 2, 4, 2); }
                if(k.includes("bow")||k.includes("xbow")) { ctx.strokeStyle="#a84"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(4, 0, 6, -1, 1); ctx.stroke(); }
                if(k.includes("staff")||k.includes("wand")) { ctx.fillStyle="#840"; ctx.fillRect(4, -8, 2, 16); ctx.fillStyle=e.equipment.hand.color; ctx.fillRect(3,-10,4,4); }
            }
            if(e.equipment.rune) { ctx.fillStyle = e.equipment.rune.color; ctx.globalAlpha = 0.8; ctx.fillRect(-2, 0, 4, 4); ctx.globalAlpha = 1.0; }
            
            // OLHOS DO VAZIO QUE SEGUEM O MOUSE/ALVO
            if (e.id === myId) {
                ctx.fillStyle = "white"; ctx.fillRect(-3, -3, 2, 2); ctx.fillRect(1, -3, 2, 2); // Whites
                // MUDANÇA: O angulo de ataque determina o olhar
                let lookAngle;
                if (!isMobile && !gamepadActive) {
                    lookAngle = getMouseAngle(); // Mouse/Teclado: Segue o mouse
                } else {
                    lookAngle = getAttackAngle(); // Mobile/Gamepad: Segue o alvo (inimigo/movimento)
                }
                
                let lx = Math.cos(lookAngle) * 1.5; let ly = Math.sin(lookAngle) * 1.5;
                if (dirX === -1) lx = -lx; // Inverte olhar se corpo invertido
                ctx.fillStyle = "black"; ctx.fillRect(-3 + lx, -3 + ly, 1, 1); ctx.fillRect(1 + lx, -3 + ly, 1, 1); // Pupils
            }
        }
        else { ctx.fillStyle = blink?"#fff":"#ccc"; ctx.fillRect(-s/2, -s/2, s, s); }
        // BLOQUEIO VISUAL
        if(e.input && e.input.block) { ctx.strokeStyle = "#0ff"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(0,0,12,0,6.28); ctx.stroke(); }
        ctx.restore();

        // CORREÇÃO: Lógica de MaxHp para Mobs vs Players (linha 634 original)
        // Mobs têm maxHp na raiz; Players têm maxHp em stats
        const maxHp = e.stats ? e.stats.maxHp : e.maxHp;
        
        if(e.hp > 0 && e.hp < maxHp && e.ai!=="static" && !e.npc && e.ai!=="resource") { 
            const pct = Math.max(0, e.hp/maxHp); const bw = e.boss ? 30 : 16;
            ctx.fillStyle="#000"; ctx.fillRect(x-bw/2, y-s-4, bw, 3); ctx.fillStyle=e.boss?"#d00":"#f00"; ctx.fillRect(x-bw/2, y-s-4, bw*pct, 3); 
        }
        // NOVO: Exibe Nível + Nome para Jogadores
        if(e.class || e.boss || e.npc) { 
            ctx.fillStyle = e.npc ? "#0ff" : e.boss ? "#f00" : (e.id === myId ? "#0f0" : "#fff"); 
            ctx.font = "8px Courier New"; 
            ctx.textAlign="center"; 
            
            let displayName = e.name;
            if (e.class) { // É um jogador
                displayName = `[Lvl ${e.level}] ${e.name}`;
            }
            
            ctx.fillText(displayName, x, y - s - 8); 
        }

        if(e.chatMsg && e.chatTimer > 0) {
            ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.strokeStyle="#fff";
            const w = ctx.measureText(e.chatMsg).width + 6;
            ctx.fillRect(x - w/2, y - s - 25, w, 14); ctx.strokeRect(x - w/2, y - s - 25, w, 14);
            ctx.fillStyle = "#fff"; ctx.font = "10px Courier New";
            ctx.fillText(e.chatMsg, x, y - s - 15);
        }
    });

    ctx.save();
    const sy=Math.floor(cam.y/SCALE), ey=sy+Math.ceil(canvas.height/SCALE)+1; const sx=Math.floor(cam.x/SCALE), ex=sx+Math.ceil(canvas.width/SCALE)+1;
    for(let y=sy; y<ey; y++){
        if(!explored[y]) continue;
        for(let x=sx; x<ex; x++){
            const dist = Math.hypot(x - me.x, y - me.y);
            if (dist > lightRadiusTiles) {
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
    
    if (!fogPattern) createFogPattern();
    ctx.fillStyle = fogPattern; ctx.globalAlpha = 0.5; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.globalAlpha = 1.0;
    
    // DESENHA OS INDICADORES DE JOGADORES FORA DA TELA
    drawOffscreenPlayerIndicators(); 
    
    for(let i=texts.length-1; i>=0; i--){ 
        let t=texts[i]; t.y+=t.vy; t.vy += 0.003; t.life--; 
        ctx.globalAlpha = t.life / 100; ctx.fillStyle=t.color; ctx.font=t.size || "10px Courier New"; ctx.textAlign="center"; ctx.fillText(t.val, ox+t.x*SCALE, oy+t.y*SCALE); ctx.globalAlpha = 1.0; 
        if(t.life<=0) texts.splice(i,1); 
    }
}

window.login = () => { if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume(); AudioCtrl.init(); socket.emit("login", document.getElementById("username").value); };
window.create = () => socket.emit("create_char", {name:document.getElementById("cname").value, cls:document.getElementById("cclass").value});
window.addStat = (s) => socket.emit("add_stat", s);
window.buy = (idx) => socket.emit("buy", shopItems[idx]);
window.sell = () => { 
    if(!me || !uiState.shop || focusArea !== 'inventory' || me.inventory.length === 0) return;
    socket.emit("sell", focusIndex);
    updateUI(); 
};
window.closeShop = closeAllMenus;

draw();