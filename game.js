const socket = io();
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const SCALE = 16;
let myId = null, me = null;
// Adicionando explored e lightRadius ao estado local para o cliente
let state = { pl:{}, mb:{}, it:{}, pr:[], props:[], map:[], explored: [], lightRadius: 15 }; 
let recipes = [];
let cam = { x:0, y:0 }, mouse = { x:0, y:0 };
let texts = [], effects = [];
let uiState = { inv: false, char: false, shop: false, craft: false, chat: false };
let inputState = { x:0, y:0, block: false };
let shopItems = [];
const tooltip = document.getElementById("tooltip");
let dragItem = null;
let isMobile = window.matchMedia("(max-width: 768px)").matches; // Reavaliado durante o draw
let gamepad = null;
let gamepadActive = false; // Novo flag para controlar a UI mobile

// NOVO: Variável para foco de navegação por Gamepad/Touch
let focusIndex = 0;
let focusArea = 'equipment'; // 'equipment', 'inventory', 'stats', 'shop', 'craft'

window.addEventListener("gamepadconnected", (e) => {
    console.log("Gamepad connected:", e.gamepad.id);
    gamepad = e.gamepad;
    gamepadActive = true;
    document.getElementById("mobile-controls").style.display = "none"; // Esconde os controles touch
    document.getElementById("mobile-menu-buttons").style.display = "flex"; // Mantém os botões de menu visíveis no DOM
});
window.addEventListener("gamepaddisconnected", (e) => {
    console.log("Gamepad disconnected:", e.gamepad.id);
    gamepad = null;
    gamepadActive = false;
    // O reexibir os controles mobile é tratado no loop draw()
});


// --- AUDIO SYSTEM (MANTIDO INTACTO) ---
const AudioCtrl = {
    ctx: new (window.AudioContext || window.webkitAudioContext)(),
    bgm: null,
    muted: false,
    init: function() {
        if(!this.bgm) {
            this.bgm = new Audio("/assets/bgm.mp3");
            this.bgm.loop = true;
            this.bgm.volume = 0.3;
            this.bgm.play().catch(e => console.log("Click/Tap required to play audio."));
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
        case "dash": AudioCtrl.playTone(300, "slide", 0.2, 0.1); break;
        case "gold": AudioCtrl.playTone(1200, "sine", 0.3, 0.1); AudioCtrl.playTone(1800, "sine", 0.3, 0.1); break;
        case "craft": AudioCtrl.playTone(400, "triangle", 0.5, 0.2); break;
        case "levelup": 
            [440, 554, 659, 880].forEach((f,i) => setTimeout(()=>AudioCtrl.playTone(f,"square",0.4,0.2), i*100));
            break;
        case "chat": AudioCtrl.playTone(800, "sine", 0.1, 0.05); break;
    }
}

const resize = () => { 
    canvas.width=innerWidth; 
    canvas.height=innerHeight; 
    ctx.imageSmoothingEnabled=false; 
    // Reavalia o estado móvel
    isMobile = window.matchMedia("(max-width: 768px)").matches; 
    updateUI(); 
};
resize(); window.onresize=resize;

socket.on("connect", () => myId=socket.id);
socket.on("char_list", list => {
    document.getElementById("login-form").style.display="none"; document.getElementById("char-select").style.display="block";
    const l = document.getElementById("char-list"); l.innerHTML="";
    for(let n in list){
        let d=document.createElement("div"); d.className="btn"; d.innerHTML=`${n} <small>Lvl ${list[n].level}</small>`;
        d.onclick=()=>{ 
            socket.emit("enter_game", n); 
            document.getElementById("menu").style.display="none"; 
            AudioCtrl.init();
        };
        l.appendChild(d);
    }
});
socket.on("game_start", d => { recipes = d.recipes; renderCrafting(); });
// A função on("u", ...) agora recebe mais dados (explored, lightRadius)
socket.on("u", d => { 
    Object.assign(state, d); // Mescla o novo estado (incluindo explored e lightRadius)
    me=state.pl[myId]; 
    if(me) updateUI(); 
});
socket.on("txt", d => {
    // AJUSTE FINO DO TEXTO
    let vy = -0.25; 
    let life = 100; 
    
    if(d.val.includes("LEVEL UP!")) { vy = -0.5; life = 150; }
    else if(d.val.includes("CRIT!")) { vy = -0.4; life = 100; d.color="#f0f"; d.size="14px"; d.isCrit=true; }
    else if(d.val.includes("CRAFT") || d.val.includes("SOCKETED")) { vy = -0.35; life = 80; }
    else if(d.val.includes("+")) { vy = -0.3; life = 80; } 

    texts.push({...d, life:life, vy:vy});
    
    if(d.val.includes("CRAFT")) playSfx("craft");
    if(d.val.includes("LEVEL")) playSfx("levelup");
});
socket.on("fx", d => {
    if (d.type === "slash") { effects.push({ type: "slash", x: d.x, y: d.y, angle: d.angle, life: 10 }); playSfx("atk"); }
    // CORREÇÃO 1: Aumenta a duração do efeito 'spin' do Knight para 20
    else if (d.type === "spin") { effects.push({ type: "spin", x: d.x, y: d.y, life: 20 }); playSfx("atk"); }
    else if (d.type === "nova") effects.push({ type: "nova", x: d.x, y: d.y, life: 20 });
    else if (d.type === "dash") playSfx("dash");
    else if (d.type === "gold_txt") {
        texts.push({ val: d.val, x: d.x, y: d.y, color: "#fb0", life: 75, vy: -0.3, size: "10px" });
        playSfx("gold");
    }
    else if (d.type === "hit") playSfx("hit");
    else if (d.type === "gold") playSfx("gold");
});
socket.on("chat", d => {
    const p = state.pl[d.id];
    if(p) { p.chatMsg = d.msg; p.chatTimer = 180; playSfx("chat"); }
});
socket.on("open_shop", items => { shopItems = items; uiState.shop = true; updateUI(); });

// --- INPUT HANDLERS (MANTIDO INTACTO) ---
const keys = { w:false, a:false, s:false, d:false, q:false, game_x: 0, game_y: 0 };
function sendInput() {
    let dx = keys.a?-1:keys.d?1:0, dy = keys.w?-1:keys.s?1:0;
    
    // Sobrescreve com input do Gamepad (se ativo e movendo)
    if (gamepadActive && (Math.abs(keys.game_x) > 0.1 || Math.abs(keys.game_y) > 0.1)) {
        dx = keys.game_x;
        dy = keys.game_y;
    }
    
    // Envia o estado
    if(dx!==inputState.x || dy!==inputState.y || keys.q !== inputState.block){ inputState={x:dx,y:dy,block:keys.q}; socket.emit("input", inputState); }
}
function getMouseAngle() { return Math.atan2((mouse.y - canvas.height/2), (mouse.x - canvas.width/2)); }

// Encontra o inimigo mais próximo para Auto-Aim
function getClosestEnemyAngle() {
    if (!me || !state.mb) return null;
    let closestEnemy = null;
    let minDistSq = Infinity;

    Object.values(state.mb).forEach(m => {
        if (m.ai === "static" || m.ai === "npc" || m.ai === "resource" || m.hp <= 0) return;
        
        const dx = m.x - me.x;
        const dy = m.y - me.y;
        const distSq = dx * dx + dy * dy;

        // Limita o auto-aim a 8 unidades de distância
        if (distSq < minDistSq && distSq < 64) { 
            minDistSq = distSq;
            closestEnemy = m;
        }
    });

    if (closestEnemy) {
        return Math.atan2(closestEnemy.y - me.y, closestEnemy.x - me.x);
    }
    return null;
}

// Retorna o ângulo de ataque baseado na nova prioridade (Auto-Aim > Mouse (PC) / Movimento (Mobile/Gamepad) > Last Direction)
function getAttackAngle() {
    // 1. Checa Auto-Aim (Inimigo mais próximo) - PRIORIDADE MÁXIMA para combate, permite fugir
    const closestAngle = getClosestEnemyAngle();
    if (closestAngle !== null) {
        return closestAngle;
    }

    // 2. Checa Mouse (PC/Teclado) - PRÓXIMA PRIORIDADE para PC
    if (!isMobile) {
        return getMouseAngle();
    }
    
    // 3. Checa Movimento (Mobile/Gamepad) - PARA MOBILE/GAMEPAD sem Auto-Aim, usa a direção de movimento
    const isMoving = (keys.d - keys.a !== 0) || (keys.s - keys.w !== 0) || (Math.abs(keys.game_x) > 0.1) || (Math.abs(keys.game_y) > 0.1);
    
    if (isMoving) {
        const dx = (keys.d - keys.a) || keys.game_x;
        const dy = (keys.s - keys.w) || keys.game_y;
        return Math.atan2(dy, dx);
    }

    // 4. Fallback (Last Direction)
    // Mobile/Gamepad sem movimento, usa a última direção ou 0
    return me ? Math.atan2(me.vy || 0, me.vx || 1) : 0;
}


// CHAT INPUT
const chatInput = document.getElementById("chat-input");
chatInput.onkeydown = (e) => {
    if(e.key === "Enter") {
        if(chatInput.value.trim().length > 0) socket.emit("chat", chatInput.value.substring(0,30));
        chatInput.value = "";
        document.getElementById("chat-container").style.display = "none";
        uiState.chat = false;
        canvas.focus();
    }
};

window.onkeydown = e => {
    if (document.getElementById("menu").style.display !== "none") return;
    if(uiState.chat) return;
    let k=e.key.toLowerCase();
    
    if(k === "enter") {
        if(uiState.inv || uiState.char) {
            // Se um painel de UI está aberto, usa ENTER como botão de ação/confirmação
            handleGamepadAction(); 
        } else {
             // Abre o chat
            uiState.chat = true;
            document.getElementById("chat-container").style.display = "block";
            setTimeout(()=>chatInput.focus(), 10);
        }
        return;
    }
    
    // Gamepad/Teclado UI Navigation
    if (uiState.inv || uiState.char || uiState.shop || uiState.craft) {
        if (k === 'arrowup' || k === 'w') { handleGamepadNavigation('up'); e.preventDefault(); return; }
        if (k === 'arrowdown' || k === 's') { handleGamepadNavigation('down'); e.preventDefault(); return; }
        if (k === 'arrowleft' || k === 'a') { handleGamepadNavigation('left'); e.preventDefault(); return; }
        if (k === 'arrowright' || k === 'd') { handleGamepadNavigation('right'); e.preventDefault(); return; }
    }


    if(keys.hasOwnProperty(k)){ keys[k]=true; sendInput(); }
    if(k==="i") uiState.inv = !uiState.inv; 
    if(k==="c") uiState.char = !uiState.char; 
    if(k==="k") uiState.craft = !uiState.craft;
    if(k==="escape") { uiState.inv=false; uiState.char=false; uiState.shop=false; uiState.craft=false; uiState.chat=false; document.getElementById("chat-container").style.display="none"; }
    if(k===" ") { socket.emit("dash", getAttackAngle()); } // Usa AttackAngle para o Dash
    if(k==="q") { socket.emit("potion"); }
    
    // Sempre reinicia o foco ao abrir/fechar painéis
    if (k === 'i' || k === 'c' || k === 'k' || k === 'escape') {
        focusIndex = 0;
        focusArea = (uiState.inv || uiState.char || uiState.shop || uiState.craft) ? (uiState.inv ? 'inventory' : uiState.char ? 'equipment' : uiState.shop ? 'shop' : 'craft') : 'none';
    }
    
    updateUI();
};
window.onkeyup = e => { let k=e.key.toLowerCase(); if(keys.hasOwnProperty(k)){ keys[k]=false; sendInput(); } };
window.onmousemove = e => { mouse.x=e.clientX; mouse.y=e.clientY; tooltip.style.left = (mouse.x+10)+"px"; tooltip.style.top = (mouse.y+10)+"px"; };
window.onmousedown = e => {
    if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume().catch(err => console.error("Could not resume AudioContext on mousedown", err));
    AudioCtrl.init();
    
    if(!me || uiState.chat || isMobile || gamepadActive || document.getElementById("menu").style.display !== "none") return;
    const isPanel = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return mouse.x > r.left && mouse.x < r.right && mouse.y > r.top && mouse.y < r.bottom && document.getElementById(id).style.display==="block"; };
    if(isPanel("inventory") || isPanel("char-panel") || isPanel("shop-panel") || isPanel("craft-panel")) return;
    
    const ang = getAttackAngle(); // Usa mira automática/manual para mouse click
    
    if(e.button===0) socket.emit("attack", ang);
    if(e.button===2) socket.emit("skill", {idx:1, angle:ang});
};


// --- INPUT HANDLERS (MOBILE/TOUCH - MANTIDO INTACTO) ---
let touchMap = {};

const handleTouchStart = (e) => {
    // Se o Gamepad estiver ativo, ignora todos os inputs de toque na tela principal
    if (gamepadActive) return;

    if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume().catch(err => console.error("Could not resume AudioContext on touch", err));
    AudioCtrl.init();

    if (uiState.chat || document.getElementById("menu").style.display !== "none") return;

    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const target = touch.target;
        const id = touch.identifier;
        let processed = false;
        
        // CORREÇÃO: Touch no slot deve focar para navegação
        if (target.closest('.slot')) {
            const slotElements = document.querySelectorAll('.slot');
            const clickedIndex = Array.from(slotElements).indexOf(target.closest('.slot'));
            if (clickedIndex !== -1) {
                focusIndex = clickedIndex;
                focusArea = target.closest('#inv-grid') ? 'inventory' : target.closest('.equip-slots') ? 'equipment' : 'none';
                updateUI();
                // Deixa o toque ser processado para equipar/dropar (se for o caso)
            }
        }


        // 1. D-Pad
        if (target.closest('.dpad-btn')) {
            const key = target.closest('.dpad-btn').dataset.key;
            if (keys.hasOwnProperty(key)) {
                keys[key] = true;
                sendInput();
                touchMap[id] = { type: 'dpad', key: key };
                processed = true;
            }
        } 
        
        // 2. Action Buttons: Usa getAttackAngle()
        else if (target.closest('.action-btn')) {
            const action = target.closest('.action-btn').dataset.action;
            const ang = getAttackAngle(); // Usa mira automática/direcional
            
            if (action === "attack") {
                socket.emit("attack", ang);
            } else if (action === "skill") {
                socket.emit("skill", {idx:1, angle:ang});
            } else if (action === "dash") {
                socket.emit("dash", ang);
            } else if (action === "potion") {
                socket.emit("potion");
            }
            touchMap[id] = { type: 'action', action: action };
            processed = true;
        }
        
        // 3. Menus de HUD (INV/CHR)
        else if (target.closest('#btn-inv-mobile')) {
            uiState.inv = !uiState.inv;
            uiState.char = false;
            updateUI();
            processed = true;
        }
        else if (target.closest('#btn-char-mobile')) {
            uiState.char = !uiState.char;
            uiState.inv = false;
            updateUI();
            processed = true;
        }
        
        if (processed) e.preventDefault();
    }
};

const handleTouchEnd = (e) => {
    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const id = touch.identifier;
        
        if (touchMap[id]) {
            if (touchMap[id].type === 'dpad') {
                keys[touchMap[id].key] = false;
                sendInput();
            }
            delete touchMap[id];
        }
    }
};

document.addEventListener('touchstart', handleTouchStart, { passive: false });
document.addEventListener('touchend', handleTouchEnd);
document.addEventListener('touchcancel', handleTouchEnd);

// --- GAMEPAD / TOUCH UI NAVIGATION LOGIC (NOVO) ---
let lastNavTimestamp = 0;
const NAV_DELAY = 150; // Delay em ms para evitar navegação muito rápida

function handleGamepadNavigation(direction) {
    if (Date.now() - lastNavTimestamp < NAV_DELAY) return;

    let elements = [];
    let cols = 8;
    
    // Mapeia elementos baseados na área de foco
    if (uiState.inv) {
        elements = Array.from(document.querySelectorAll('#inv-grid .slot'));
        cols = 8;
    } else if (uiState.char) {
        // Combina slots de equipamento (5) e botões de stats (3)
        const eq_slots = Array.from(document.querySelectorAll('.equip-slots .slot'));
        const stat_btns = Array.from(document.querySelectorAll('.stat-row .plus-btn'));
        elements = eq_slots.concat(stat_btns);
        cols = 5; // Trata como uma linha para equipamentos (índices 0-4)
    } else {
        return; // Nenhuma UI navegável aberta
    }

    if (elements.length === 0) return;

    let newIndex = focusIndex;
    const maxIndex = elements.length - 1;

    if (uiState.inv) {
        // Navegação em grade 8xN (Inventário)
        if (direction === 'left') newIndex--;
        else if (direction === 'right') newIndex++;
        else if (direction === 'up') newIndex -= cols;
        else if (direction === 'down') newIndex += cols;
        
        // Wrap/Clamp Navigation
        if (newIndex < 0) newIndex = 0;
        if (newIndex > maxIndex) newIndex = maxIndex;
        
    } else if (uiState.char) {
        // Navegação em blocos (Equipamento: 0-4, Stats: 5-7)
        if (direction === 'left' && newIndex > 0) newIndex--;
        else if (direction === 'right' && newIndex < maxIndex) newIndex++;
        
        // Mover entre Equipamento (0-4) e Stats (5-7)
        if (direction === 'down' && newIndex < 5) newIndex = 5;
        // CORREÇÃO: Garante que o up de stats cai no último equipamento (4)
        if (direction === 'up' && newIndex >= 5) newIndex = 4;
        
        // Clamp final para Char panel
        newIndex = Math.max(0, Math.min(newIndex, maxIndex));
    }

    focusIndex = newIndex;
    updateUI();
    lastNavTimestamp = Date.now();
}

// NOVO: Lógica para executar a ação do Gamepad (Botão de Ataque/Ação Primária)
function handleGamepadAction() {
    if (!me) return;
    
    if (uiState.char) {
        const eq_slots = Array.from(document.querySelectorAll('.equip-slots .slot'));
        const stat_btns = Array.from(document.querySelectorAll('.stat-row .plus-btn'));
        const elements = eq_slots.concat(stat_btns);
        
        const focusedElement = elements[focusIndex];

        if (focusedElement) {
            if (focusedElement.classList.contains('plus-btn')) {
                // Ação: Adicionar ponto de atributo
                focusedElement.click(); 
            } else if (focusIndex >= 0 && focusIndex <= 4) { // Slot de equipamento
                 // Ação: Unequip/Desequipar (simula o clique no slot equipado)
                 const slotNames = ["head", "body", "hand", "rune", "potion"];
                 const slot = slotNames[focusIndex];
                 if (me.equipment[slot]) {
                     socket.emit("unequip", slot);
                 }
            }
        }
    } 
    else if (uiState.inv && me.inventory.length > 0) {
        // Ação Principal no Inventário: Equipar (se for slot de equipamento) ou Usar (Poção)
        const item = me.inventory[focusIndex];
        if (item) {
            if (item.slot && item.type !== "material" && item.type !== "consumable") {
                socket.emit("equip", focusIndex);
            } else if (item.key === "potion") {
                socket.emit("potion");
            }
        }
    }
    // Outras UIs (Shop, Craft) podem ter suas ações implementadas aqui
}

// NOVO: Lógica para executar a Ação Secundária (Botão de Skill/Ação Secundária)
function handleGamepadSecondaryAction() {
    if (!me) return;

    if (uiState.inv && me.inventory.length > 0) {
        // Ação Secundária no Inventário: Dropar (Drop)
        if (me.inventory[focusIndex]) {
             socket.emit("drop", focusIndex);
        }
    }
}

let lastButtons = {};

function handleGamepadInput() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    gamepad = gamepads[0]; 

    if (!gamepad) {
        gamepadActive = false;
        return;
    }
    
    gamepadActive = true;
    
    // Atualiza o objeto gamepad para ter os dados mais recentes
    gamepad = navigator.getGamepads()[gamepad.index];

    // --- 1. MOVEMENT (AXES: Left Stick/D-Pad) ---
    const stickX = gamepad.axes[0] || 0; // Left Stick Horizontal
    const stickY = gamepad.axes[1] || 0; // Left Stick Vertical
    const deadzone = 0.3;
    
    keys.game_x = (Math.abs(stickX) > deadzone) ? stickX : 0;
    keys.game_y = (Math.abs(stickY) > deadzone) ? stickY : 0;
    
    // Mapeamento do D-Pad (Botões 12, 13, 14, 15 no layout padrão)
    if (gamepad.buttons[14]?.pressed) keys.game_x = -1; 
    if (gamepad.buttons[15]?.pressed) keys.game_x = 1;  
    if (gamepad.buttons[12]?.pressed) keys.game_y = -1; 
    if (gamepad.buttons[13]?.pressed) keys.game_y = 1;  

    sendInput(); // Envia o novo estado de movimento

    // --- 2. ACTIONS (BUTTONS) ---
    
    const processButton = (buttonIndex, action) => {
        const button = gamepad.buttons[buttonIndex];
        const isPressed = button?.pressed;
        const wasPressed = lastButtons[buttonIndex] || false;
        
        if (isPressed && !wasPressed) {
            if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume().catch(err => console.error("Could not resume AudioContext on button press", err));
            
            // Lógica de navegação ou ação da UI
            if (uiState.inv || uiState.char || uiState.shop || uiState.craft) {
                if (action === 'attack') { handleGamepadAction(); } // Botão A -> Ação Primária/Equipar/Usar/Add Stat
                if (action === 'skill') { handleGamepadSecondaryAction(); } // Botão B -> Ação Secundária/Dropar
                // D-Pad/Sticks são tratados na navegação abaixo
            }
            
            // Lógica de Combate
            else {
                const ang = getAttackAngle(); 
                if (action === 'attack') { socket.emit("attack", ang); } 
                if (action === 'skill') { socket.emit("skill", {idx:1, angle:ang}); }
                if (action === 'dash') { socket.emit("dash", ang); } 
                if (action === 'potion') { socket.emit("potion"); } 
            }
            
            // Lógica de abertura/fechamento de Painéis
            if (action === 'inventory') { uiState.inv = !uiState.inv; uiState.char = false; uiState.shop = false; uiState.craft = false; }
            if (action === 'character') { uiState.char = !uiState.char; uiState.inv = false; uiState.shop = false; uiState.craft = false; }
            
            // Sempre reinicia o foco ao abrir/fechar painéis
            if (action === 'inventory' || action === 'character') {
                 focusIndex = 0;
                 focusArea = (uiState.inv || uiState.char || uiState.shop || uiState.craft) ? (uiState.inv ? 'inventory' : uiState.char ? 'equipment' : 'none') : 'none';
            }
            
            updateUI();

        }
        lastButtons[buttonIndex] = isPressed;
    };

    // Mapeamento de Botões Padrão (Xbox Layout)
    processButton(0, 'attack'); // A
    processButton(1, 'skill'); // B
    processButton(3, 'dash'); // Y (Mantido como dash, mas pode ser usado para Drop se Gamepad for focado na UI)
    processButton(4, 'potion'); // LB (Poção)
    processButton(9, 'inventory'); // Start (Options)
    processButton(8, 'character'); // Select (View/Back)

    // Tratamento de navegação por Gamepad Stick/Dpad
    if (uiState.inv || uiState.char || uiState.shop || uiState.craft) {
        if (gamepad.buttons[12]?.pressed && !lastButtons[12]) handleGamepadNavigation('up');
        if (gamepad.buttons[13]?.pressed && !lastButtons[13]) handleGamepadNavigation('down');
        if (gamepad.buttons[14]?.pressed && !lastButtons[14]) handleGamepadNavigation('left');
        if (gamepad.buttons[15]?.pressed && !lastButtons[15]) handleGamepadNavigation('right');
        
        // Sticks (se o Gamepad não tiver Dpad, os botões 12-15 podem ser 0-3)
        if (Math.abs(stickY) > deadzone && Math.abs(stickY) > Math.abs(stickX)) {
             if (stickY < 0 && !lastNavTimestamp || stickY < 0 && Date.now() - lastNavTimestamp > NAV_DELAY) { handleGamepadNavigation('up'); }
             else if (stickY > 0 && !lastNavTimestamp || stickY > 0 && Date.now() - lastNavTimestamp > NAV_DELAY) { handleGamepadNavigation('down'); }
        } else if (Math.abs(stickX) > deadzone && Math.abs(stickX) > Math.abs(stickY)) {
             if (stickX < 0 && !lastNavTimestamp || stickX < 0 && Date.now() - lastNavTimestamp > NAV_DELAY) { handleGamepadNavigation('left'); }
             else if (stickX > 0 && !lastNavTimestamp || stickX > 0 && Date.now() - lastNavTimestamp > NAV_DELAY) { handleGamepadNavigation('right'); }
        }
        
        lastButtons[12] = gamepad.buttons[12]?.pressed;
        lastButtons[13] = gamepad.buttons[13]?.pressed;
        lastButtons[14] = gamepad.buttons[14]?.pressed;
        lastButtons[15] = gamepad.buttons[15]?.pressed;
    }
}


// --- UI AND DRAWING FUNCTIONS (AJUSTADA PARA FOCO) ---

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
    
    const hpPct = (me.hp/me.stats.maxHp)*100;
    const mpPct = (me.mp/me.stats.maxMp)*100;
    const xpPct = (me.xp/(me.level*100))*100;
    let diffName = state.theme === "#f00" ? "HORDE I" : state.theme === "#900" ? "HORDE II" : state.theme === "#102" ? "HELL" : state.theme === "#311" ? "NIGHTMARE" : "NORMAL";

    // --- PC/MOBILE VERTICAL HUD (barras grandes) ---
    if (!isMobile || (isMobile && innerWidth < innerHeight)) {
        document.getElementById("hp-bar").style.width = hpPct + "%";
        document.getElementById("mp-bar").style.width = mpPct + "%";
        document.getElementById("xp-bar").style.width = xpPct + "%";
        
        document.getElementById("hp-txt").innerText = `HP: ${Math.floor(me.hp)}/${me.stats.maxHp}`;
        document.getElementById("mp-txt").innerText = `MP: ${Math.floor(me.mp)}/${me.stats.maxMp}`;
        document.getElementById("xp-txt").innerText = `${Math.floor(xpPct)}%`;
        document.getElementById("lvl-txt").innerText = `${diffName} [${me.level}]`;
    }
    
    // --- MOBILE HORIZONTAL HUD (barra minúscula) ---
    const mobileHorizontalHud = document.getElementById("hud-horizontal-mobile");
    if (isMobile && innerWidth > innerHeight) {
         // Ajusta o HUD minúsculo (no DOM)
         document.getElementById("h-lvl-txt").innerText = `${diffName} [${me.level}]`;
         document.getElementById("h-gold-txt").innerText = `${me.gold}G`;
         
         document.getElementById("h-hp-bar").style.width = hpPct + "%";
         document.getElementById("h-mp-bar").style.width = mpPct + "%";
         document.getElementById("h-xp-bar").style.width = xpPct + "%";
         
    } 

    // --- UI Panels (Comum) ---
    document.getElementById("cp-pts").innerText = me.pts;
    document.getElementById("val-str").innerText = me.attrs.str;
    document.getElementById("val-dex").innerText = me.attrs.dex;
    document.getElementById("val-int").innerText = me.attrs.int;
    document.getElementById("stat-dmg").innerText = me.stats.dmg;
    document.getElementById("stat-spd").innerText = Math.floor(me.stats.spd*100);
    // NOVO STAT CRIT
    document.getElementById("stat-dmg").innerText += ` (CRIT: ${Math.floor(me.stats.crit*100)}%)`;
    
    document.getElementById("hud-gold").innerText = "GOLD: " + me.gold;

    const uiActionButtons = document.getElementById("ui-action-buttons");

    // Lógica para mostrar/esconder painéis e botões de ação da UI (Gamepad/Touch)
    if (uiState.inv || uiState.char || uiState.shop || uiState.craft) {
        uiActionButtons.style.display = 'flex';
    } else {
        uiActionButtons.style.display = 'none';
        hideTooltip(); // Esconde o tooltip se nenhum painel estiver aberto
    }

    document.getElementById("inventory").style.display = uiState.inv ? "block" : "none";
    document.getElementById("char-panel").style.display = uiState.char ? "block" : "none";
    document.getElementById("shop-panel").style.display = uiState.shop ? "block" : "none";
    document.getElementById("craft-panel").style.display = uiState.craft ? "block" : "none";

    // --- RENDERIZAÇÃO DE EQUIPAMENTO (com foco) ---
    const eq_slots = ["head","body","hand","rune","potion"];
    eq_slots.forEach((slot, index) => {
        const el = document.getElementById("eq-"+slot); 
        if (!el) return; 
        
        el.innerHTML = "";
        el.style.outline = 'none'; // Limpa o foco
        el.style.outlineOffset = '0px';

        // Verifica se este slot está focado
        if (uiState.char && focusArea === 'equipment' && focusIndex === index) {
            el.style.outline = '2px solid yellow';
            el.style.outlineOffset = '2px';
            if (me.equipment[slot]) showTooltip(me.equipment[slot]); else hideTooltip();
        }

        if(me.equipment[slot]) {
            const it = me.equipment[slot];
            el.style.borderColor = it.color; el.innerHTML = getIcon(it.key);
            el.style.boxShadow = it.rarity === "legendary" ? "0 0 5px #f0f" : "none";
            el.onmouseover = () => showTooltip(it); el.onmouseout = hideTooltip;
            el.onclick = () => socket.emit("unequip", slot);
        } else { 
            el.style.borderColor = "#0f0"; el.style.boxShadow = "none"; 
            el.onclick=null; 
            // Se estiver focado em um slot vazio, esconde o tooltip
            if (uiState.char && focusArea === 'equipment' && focusIndex === index) {
                hideTooltip();
                document.getElementById('ui-btn-equip').innerText = 'ESPAÇO VAZIO (A)';
            }
        }
    });
    
    // --- RENDERIZAÇÃO DOS BOTÕES DE STATS (com foco) ---
    const stat_btns = ['str', 'dex', 'int'];
    stat_btns.forEach((stat, index) => {
        const btn = document.getElementById("btn-"+stat);
        const focusIndexOffset = eq_slots.length; // 5
        
        btn.style.outline = 'none';
        btn.style.outlineOffset = '0px';

        if (uiState.char && focusArea === 'equipment' && focusIndex === index + focusIndexOffset) {
             btn.style.outline = '2px solid yellow';
             btn.style.outlineOffset = '2px';
             
             if (me.pts > 0) {
                 document.getElementById('ui-btn-equip').innerText = `ADICIONAR ${stat.toUpperCase()} (A)`;
             } else {
                 document.getElementById('ui-btn-equip').innerText = `PONTOS ESGOTADOS`;
             }
        }
    });
    
    // --- RENDERIZAÇÃO DO INVENTÁRIO (com foco) ---
    const ig = document.getElementById("inv-grid"); 
    
    // **TRECHO CRÍTICO DE RECONSTRUÇÃO DO INVENTÁRIO**
    ig.innerHTML = ""; // Limpa a grade (essencial para mostrar novos itens)
    
    // CORREÇÃO 4: Recalcula o foco se o inventário encolheu
    // *Removida a chamada recursiva desnecessária.*
    if (uiState.inv && focusArea === 'inventory' && me.inventory.length > 0 && focusIndex >= me.inventory.length) {
         focusIndex = Math.max(0, me.inventory.length - 1);
    } else if (uiState.inv && me.inventory.length === 0) {
        focusIndex = 0;
    }


    me.inventory.forEach((it, idx) => {
        const d = document.createElement("div"); d.className = "slot"; d.style.borderColor = it.color;
        
        d.style.outline = 'none';
        d.style.outlineOffset = '0px';

        if (uiState.inv && focusArea === 'inventory' && focusIndex === idx) {
             d.style.outline = '2px solid yellow';
             d.style.outlineOffset = '2px';
             showTooltip(it); 
             
             // Atualiza botões de ação
             if (it.slot && it.type !== "material" && it.type !== "consumable") {
                document.getElementById('ui-btn-equip').innerText = 'EQUIPAR (A)';
             } else if (it.key === 'potion') {
                 document.getElementById('ui-btn-equip').innerText = 'USAR POÇÃO (A)';
             } else {
                document.getElementById('ui-btn-equip').innerText = 'NÃO EQUIPÁVEL (A)';
             }
             document.getElementById('ui-btn-drop').innerText = 'DROPAR (B)';

        } 

        if(it.rarity === "legendary") d.style.boxShadow = "0 0 4px " + it.color;
        d.innerHTML = getIcon(it.key);
        if(it.sockets && it.sockets.length > 0) {
            const socks = document.createElement("div"); socks.style.cssText="position:absolute;bottom:0;right:0;display:flex;";
            it.sockets.forEach((s, i) => {
                const dot = document.createElement("div"); 
                dot.style.cssText=`width:4px;height:4px;background:${it.gems[i]?it.gems[i].color:"#222"};border:1px solid #555;margin-right:1px;`;
                socks.appendChild(dot);
            });
            d.appendChild(socks);
        }
        
        // Eventos de mouse/touch originais (mantidos)
        d.draggable = true;
        d.ondragstart = (e) => { dragItem = { idx, item: it }; };
        d.ondragover = (e) => e.preventDefault();
        d.ondrop = (e) => { e.preventDefault(); if(dragItem && dragItem.item.type === "gem" && it.type !== "gem") socket.emit("craft", {action:"socket", itemIdx:idx, gemIdx:dragItem.idx}); };
        d.onmouseover = () => showTooltip(it); d.onmouseout = hideTooltip;
        d.oncontextmenu = (e) => { e.preventDefault(); if(it.slot) socket.emit("equip", idx); else socket.emit("drop", idx); };
        
        ig.appendChild(d); // Adiciona o slot recém-criado
    });
    
    // Lógica de fallback para botões de ação se o inventário estiver vazio ou sem foco
    if (uiState.inv && (me.inventory.length === 0 || focusArea !== 'inventory')) {
        hideTooltip();
        document.getElementById('ui-btn-equip').innerText = 'INVENTÁRIO VAZIO';
        document.getElementById('ui-btn-drop').innerText = 'DROPAR';
    } 
    
    if (!uiState.inv && !uiState.char) {
        // Esconde botões de ação se nenhum painel crítico estiver aberto
        uiActionButtons.style.display = 'none';
    }


    if(uiState.shop) {
        const sg = document.getElementById("shop-grid"); sg.innerHTML = "";
        shopItems.forEach((it, idx) => {
            const d = document.createElement("div"); d.className = "slot"; d.style.borderColor = it.color;
            d.innerHTML = getIcon(it.key);
            d.onmouseover = () => showTooltip(it); d.onmouseout = hideTooltip;
            d.onclick = () => window.buy(idx);
            sg.appendChild(d);
        });
    }
}

function getIcon(key) {
    if(key.includes("sword")) return "🗡️"; if(key.includes("axe")) return "🪓"; if(key.includes("dagger")) return "🔪";
    if(key.includes("bow")) return "🏹"; if(key.includes("staff")) return "🪄"; if(key.includes("potion")) return "🧪";
    if(key.includes("helm")) return "🪖"; if(key.includes("armor")) return "👕"; if(key.includes("wood")) return "🪵";
    if(key.includes("stone")) return "🪨"; if(key.includes("ruby")) return "💎"; if(key.includes("sapphire")) return "🔹";
    if(key.includes("emerald")) return "🟩"; if(key.includes("diamond")) return "⚪";
    if(key.includes("topaz")) return "🔶"; if(key.includes("amethyst")) return "🟣";
    if(key.includes("runa")) return "⚛️"; // Novo ícone para Runas
    return "📦";
}

function showTooltip(it) {
    let html = `<b style="color:${it.color}">${it.name}</b><br><span style="color:#aaa">${it.type.toUpperCase()}</span>`;
    if(it.price) html += `<br>Price: ${it.price}G`;
    if(it.stats) { 
        for(let k in it.stats) {
             if(k==="crit") html += `<br>Crit Chance: ${Math.floor(it.stats[k]*100)}%`;
             else html += `<br>${k.toUpperCase()}: ${it.stats[k]}`;
        }
    }
    if(it.sockets && it.sockets.length > 0) {
        html += `<br><br>SOCKETS [${it.gems.length}/${it.sockets.length}]`;
        it.gems.forEach(g => html += `<br><span style="color:${g.color}">* ${g.desc}</span>`);
    }
    tooltip.innerHTML = html; tooltip.style.display = "block";
}
function hideTooltip() { tooltip.style.display = "none"; }

function drawAura(x, y, color, intensity) {
    ctx.shadowBlur = intensity; ctx.shadowColor = color;
    ctx.fillStyle = color; ctx.globalAlpha = 0.2;
    ctx.beginPath(); ctx.arc(x, y, 10 + Math.sin(Date.now()/200)*2, 0, Math.PI*2); ctx.fill();
    ctx.globalAlpha = 1.0; ctx.shadowBlur = 0;
}

let fogPattern = null;
function createFogPattern() {
    const size = 32;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = size;
    tempCanvas.height = size;
    const tempCtx = tempCanvas.getContext('2d');
    tempCtx.fillStyle = 'rgba(0, 0, 0, 0.4)'; 
    tempCtx.fillRect(0, 0, size, size);

    // Adiciona pontos de ruído (estilo MSDOS/CRT)
    for (let i = 0; i < size * size * 0.1; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        tempCtx.fillStyle = `rgba(0, 15, 0, ${Math.random() * 0.1 + 0.05})`; 
        tempCtx.fillRect(x, y, 1, 1);
    }
    fogPattern = ctx.createPattern(tempCanvas, 'repeat');
}

function draw() {
    requestAnimationFrame(draw);
    
    // --- GAMEPAD CHECK & POLLING ---
    handleGamepadInput();
    
    // --- MOBILE UI HIDE/SHOW ---
    const mobileControls = document.getElementById("mobile-controls");
    const mobileMenuButtons = document.getElementById("mobile-menu-buttons");
    const mobileHorizontalHud = document.getElementById("hud-horizontal-mobile");
    
    if(isMobile) {
        if (innerWidth > innerHeight) {
            // Modo Horizontal (Paisagem) - Esconde controles de movimento/ação
            mobileControls.style.display = "none";
            document.getElementById("hud-gold").style.display = "none"; // Esconde Gold na vertical
            mobileHorizontalHud.style.display = "flex"; // Mostra HUD minúsculo
            
        } else {
            // Modo Vertical (Retrato) - Mostra controles de movimento/ação no canto inferior
            if (!gamepadActive) {
                mobileControls.style.display = "block";
            } else {
                 mobileControls.style.display = "none";
            }
            document.getElementById("hud-gold").style.display = "block"; // Mostra Gold no topo
            mobileHorizontalHud.style.display = "none"; // Esconde HUD minúsculo
        }
        // Os botões de menu (INV/CHR) permanecem visíveis para acesso aos painéis
        mobileMenuButtons.style.display = "flex";
    } else {
        mobileControls.style.display = "none";
        mobileMenuButtons.style.display = "none";
        mobileHorizontalHud.style.display = "none";
    }

    ctx.fillStyle = "#000"; ctx.fillRect(0,0,canvas.width,canvas.height);
    if(!me) return;

    cam.x += (me.x*SCALE - canvas.width/2 - cam.x)*0.2; cam.y += (me.y*SCALE - canvas.height/2 - cam.y)*0.2;
    const ox = -cam.x, oy = -cam.y;
    const now = Date.now();
    
    const lightRadiusTiles = state.lightRadius; // Raio em tiles
    const lightRadiusPixels = lightRadiusTiles * SCALE;
    const playerScreenX = ox + me.x * SCALE + SCALE/2;
    const playerScreenY = oy + me.y * SCALE + SCALE/2;

    // --- 1. RENDERIZAÇÃO DO MAPA E CONTEÚDO (Sem Sombra) ---
    
    const map = state.map; 
    const explored = state.explored || []; 
    const theme = state.theme || "#222";
    
    if(map.length){
        const sy=Math.floor(cam.y/SCALE), ey=sy+Math.ceil(canvas.height/SCALE)+1;
        const sx=Math.floor(cam.x/SCALE), ex=sx+Math.ceil(canvas.width/SCALE)+1;
        
        // Desenha o mapa base
        for(let y=sy; y<ey; y++){
            if(!map[y]) continue;
            for(let x=sx; x<ex; x++){
                if(map[y][x]===0) { ctx.fillStyle="#080808"; ctx.fillRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE); if((x+y)%3===0) { ctx.fillStyle=theme; ctx.fillRect(ox+x*SCALE+6, oy+y*SCALE+6, 2, 2); } }
                else if(map[y][x]===1) { ctx.fillStyle="#000"; ctx.fillRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE); ctx.strokeStyle=theme; ctx.strokeRect(ox+x*SCALE,oy+y*SCALE,SCALE,SCALE); }
            }
        }
    }
    
    // PROPS
    if(state.props) state.props.forEach(p => {
        const px=ox+p.x*SCALE, py=oy+p.y*SCALE;
        if(p.type==="rock") { ctx.fillStyle="#333"; ctx.fillRect(px,py,4,3); } else if(p.type==="bones") { ctx.fillStyle="#ccc"; ctx.fillRect(px,py,3,1); ctx.fillRect(px+2,py+1,3,1); } else { ctx.fillStyle="#232"; ctx.fillRect(px,py,2,4); ctx.fillRect(px+3,py+1,2,3); }
    });
    
    // ITEMS
    for(let k in state.it){
        let i=state.it[k]; let yb = Math.sin(now/200)*2;
        if(i.item.key === "gold") { 
            ctx.shadowBlur=5; ctx.shadowColor="#fb0"; ctx.fillStyle="#fb0"; ctx.fillRect(ox+i.x*SCALE+4, oy+i.y*SCALE+6+yb, 3, 3); ctx.shadowBlur=0;
        } else { 
            ctx.shadowBlur = i.item.rarity==="legendary"?10:i.item.rarity==="rare"?5:0;
            ctx.shadowColor=i.item.color;
            ctx.fillStyle=i.item.color; ctx.fillRect(ox+i.x*SCALE+4, oy+i.y*SCALE+4+yb, 8, 8); 
            ctx.shadowBlur=0;
        }
    }

    // PROJECTILES
    if(state.pr) state.pr.forEach(p => {
        ctx.save(); ctx.translate(ox+p.x*SCALE, oy+p.y*SCALE); ctx.rotate(p.angle || 0); ctx.shadowBlur=10;
        // CORREÇÃO 2: Adiciona/ajusta a renderização de projéteis de skill para maior visibilidade
        if(p.type === "arrow") { 
             ctx.shadowColor="#ff0"; ctx.fillStyle = "#ff0"; ctx.fillRect(-6, -1, 12, 2); 
        } 
        else if (p.type === "fireball") { 
             ctx.shadowColor="#f80"; ctx.fillStyle = "#f80"; ctx.beginPath(); ctx.arc(0,0, 4, 0, Math.PI*2); ctx.fill(); 
        }
        else if (p.type === "meteor") { 
             // Projétil da Skill do Mago (Aumentado o tamanho/brilho)
             ctx.shadowColor="#f00"; ctx.fillStyle = "#f00"; ctx.beginPath(); ctx.arc(0,0, 8, 0, Math.PI*2); ctx.fill(); 
        } 
        else if (p.type === "web") { 
             ctx.shadowColor="#fff"; ctx.strokeStyle="#fff"; ctx.lineWidth=1; ctx.beginPath(); 
             ctx.moveTo(-4,-4); ctx.lineTo(4,4); ctx.moveTo(4,-4); ctx.lineTo(-4,4); ctx.stroke(); 
        }
        else if (p.type === "laser") { 
             ctx.shadowColor="#f0f"; ctx.fillStyle="#f0f"; ctx.fillRect(-10, -2, 20, 4); 
        }
        else if (p.type === "frostball") { 
             ctx.shadowColor="#0ff"; ctx.fillStyle="#0ff"; ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2); ctx.fill(); 
        }
        else { 
             ctx.shadowColor="#0ff"; ctx.fillStyle = "#0ff"; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill(); 
        }
        ctx.shadowBlur=0; ctx.restore();
    });

    // EFFECTS
    for(let i=effects.length-1; i>=0; i--) {
        let e = effects[i]; e.life--; if(e.life<=0) { effects.splice(i,1); continue; }
        const x = ox + e.x*SCALE, y = oy + e.y*SCALE; ctx.shadowBlur=10; ctx.shadowColor="#fff";
        if(e.type==="slash") { ctx.strokeStyle=`rgba(255,255,255,${e.life/10})`; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(x,y,20,e.angle-0.8,e.angle+0.8); ctx.stroke(); } 
        // CORREÇÃO 3: Efeito de rotação do Knight (Skill) mais visível
        else if(e.type==="spin") { 
             ctx.strokeStyle=`rgba(255, 255, 0, ${e.life/20})`; 
             ctx.lineWidth=4; 
             ctx.beginPath(); 
             // O raio da animação diminui enquanto o efeito "morre" (life)
             const radius = 35 - (20 - e.life)*2; // Aumentado o raio inicial para 35
             if(radius > 0) ctx.arc(x, y, radius, 0, Math.PI * 2); 
             ctx.stroke(); 
        }
        else if(e.type==="nova") { ctx.strokeStyle=`rgba(255,0,0,${e.life/20})`; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,30-e.life,0,6.28); ctx.stroke(); }
        else if(e.type==="alert") { ctx.fillStyle="#f00"; ctx.font="bold 16px Courier New"; ctx.textAlign="center"; ctx.fillText("!", x, y-20); }
        ctx.shadowBlur=0;
    }

    // ENTITIES (RESTANTE MANTIDO INTACTO)
    const ents = [...Object.values(state.mb), ...Object.values(state.pl)]; ents.sort((a,b)=>a.y-b.y);
    ents.forEach(e => {
        const x = ox+e.x*SCALE+SCALE/2, y = oy+e.y*SCALE+SCALE/2; const s = e.size || 12;
        
        // AURAS based on Equipment/Type
        if(e.equipment && e.equipment.body) {
             if(e.equipment.body.rarity === "legendary") drawAura(x, y, "#f0f", 15);
             else if(e.equipment.body.rarity === "rare") drawAura(x, y, "#ff0", 8);
        }
        if(e.boss) drawAura(x, y, "#f00", 10);

        ctx.save(); ctx.translate(x, y);
        let blink = e.hitFlash>0; let dirX = (e.vx > 0.01) ? 1 : (e.vx < -0.01) ? -1 : 1; 
        
        // Determina a direção visual (Prioriza Mouse para PC, Movimento para Mobile/Gamepad)
        if (e.id === myId) {
            // Se NÃO for mobile OU for mobile no modo paisagem/horizontal
            if (!isMobile || (isMobile && innerWidth > innerHeight)) { 
                dirX = (mouse.x > canvas.width/2) ? 1 : -1;
            } else { // Mobile Vertical (Retrato) - Foco no movimento D-pad/touch
                const currentInputX = keys.a ? -1 : keys.d ? 1 : keys.game_x;
                if (Math.abs(currentInputX) > 0.1) {
                    dirX = Math.sign(currentInputX);
                } else {
                    dirX = (e.vx > 0.01) ? 1 : (e.vx < -0.01) ? -1 : 1;
                }
            }
        } else {
            dirX = (e.vx > 0.01) ? 1 : (e.vx < -0.01) ? -1 : 1;
        }

        ctx.scale(dirX, 1);

        // --- ART (MANTIDO INTACTO) ---
        if(e.ai==="resource") { 
            if(e.drop==="wood") { ctx.fillStyle="#420"; ctx.fillRect(-3,-2,6,8); ctx.fillStyle="#141"; ctx.beginPath(); ctx.moveTo(0,-12); ctx.lineTo(-8,-2); ctx.lineTo(0,-2); ctx.lineTo(8,-2); ctx.fill(); }
            else { ctx.fillStyle="#666"; ctx.beginPath(); ctx.arc(0,0,7,0,Math.PI*2); ctx.fill(); }
        }
        else if(e.npc) { ctx.fillStyle="#0aa"; ctx.fillRect(-5,-8,10,14); ctx.fillStyle="#fff"; ctx.fillRect(-2,-6,4,4); ctx.font="10px monospace"; ctx.fillStyle="#0f0"; ctx.fillText("$", -3, -15); }
        else if(e.boss) {
            ctx.shadowBlur=15; ctx.shadowColor=e.state==="rage"?"#f00":"#fff";
            ctx.fillStyle=blink?"#fff": (e.state==="rage"?"#f00":"#800"); 
            ctx.fillRect(-s/2,-s/2,s,s); 
            ctx.fillStyle="#f00"; ctx.fillRect(-8,-8,4,4); ctx.fillRect(4,-8,4,4);
            ctx.shadowBlur=0;
        }
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
            // Equipment Rendering
            if(e.equipment.head) { ctx.fillStyle=e.equipment.head.color; ctx.fillRect(-4,-8,8,4); }
            if(e.equipment.body) { ctx.fillStyle=e.equipment.body.color; ctx.fillRect(-3,-4,6,6); }
            if(e.equipment.hand) {
                let k = e.equipment.hand.key;
                if(k.includes("sword")||k.includes("axe")||k.includes("dagger")) { ctx.fillStyle="#ddd"; ctx.fillRect(4, -4, 2, 10); ctx.fillStyle="#840"; ctx.fillRect(3, 2, 4, 2); }
                if(k.includes("bow")||k.includes("xbow")) { ctx.strokeStyle="#a84"; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(4, 0, 6, -1, 1); ctx.stroke(); }
                if(k.includes("staff")||k.includes("wand")) { ctx.fillStyle="#840"; ctx.fillRect(4, -8, 2, 16); ctx.fillStyle=e.equipment.hand.color; ctx.fillRect(3,-10,4,4); }
            }
            if(e.equipment.rune) { // Renderiza a runa (pequeno brilho)
                 ctx.fillStyle = e.equipment.rune.color; 
                 ctx.globalAlpha = 0.8;
                 ctx.fillRect(-2, 0, 4, 4);
                 ctx.globalAlpha = 1.0;
            }
        }
        else { ctx.fillStyle = blink?"#fff":"#ccc"; ctx.fillRect(-s/2, -s/2, s, s); }
        if(e.input && e.input.block) { ctx.strokeStyle = "#0ff"; ctx.beginPath(); ctx.arc(0,0,12,0,6.28); ctx.stroke(); }
        ctx.restore();

        // NAME & HP BAR
        if(e.hp < e.maxHp && e.ai!=="static" && !e.npc && e.ai!=="resource") { 
            const pct = Math.max(0, e.hp/e.maxHp); 
            const bw = e.boss ? 30 : 16;
            ctx.fillStyle="#000"; ctx.fillRect(x-bw/2, y-s-4, bw, 3); 
            ctx.fillStyle=e.boss?"#d00":"#f00"; ctx.fillRect(x-bw/2, y-s-4, bw*pct, 3); 
        }
        // NAMES
        if(e.class || e.boss || e.npc) {
             ctx.fillStyle = e.npc ? "#0ff" : e.boss ? "#f00" : "#fff";
             ctx.font = "8px Courier New"; ctx.textAlign="center";
             ctx.fillText(e.name, x, y - s - 8);
        }

        // CHAT BUBBLES
        if(e.chatMsg && e.chatTimer > 0) {
            e.chatTimer--;
            ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.strokeStyle="#fff";
            const w = ctx.measureText(e.chatMsg).width + 6;
            ctx.fillRect(x - w/2, y - s - 25, w, 14); ctx.strokeRect(x - w/2, y - s - 25, w, 14);
            ctx.fillStyle = "#fff"; ctx.font = "10px Courier New";
            ctx.fillText(e.chatMsg, x, y - s - 15);
        }
    });

    // --- 2. FOG OF WAR (MANTIDO INTACTO) ---
    
    // 2a. Escurece tudo que não está no FoV atual (Sombra Persistente)
    ctx.save();
    
    const sy=Math.floor(cam.y/SCALE), ey=sy+Math.ceil(canvas.height/SCALE)+1;
    const sx=Math.floor(cam.x/SCALE), ex=sx+Math.ceil(canvas.width/SCALE)+1;

    // A cor de fundo é preta, então preenchemos apenas com a sombra persistente
    for(let y=sy; y<ey; y++){
        if(!explored[y]) continue;
        for(let x=sx; x<ex; x++){
            const tileExplored = explored[y][x];
            
            // Checa a distância em tiles do centro do jogador
            const dx_tile = x - me.x;
            const dy_tile = y - me.y;
            const dist = Math.hypot(dx_tile, dy_tile);

            if (dist > lightRadiusTiles) {
                // ÁREA FORA DO FOV (Aplica Sombra Persistente)
                if (tileExplored === 1) {
                    // FOV Antigo (Escuro, mas Visível)
                    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)'; 
                    ctx.fillRect(ox+x*SCALE, oy+y*SCALE, SCALE, SCALE);
                } else if (tileExplored === 0) {
                     // NÃO EXPLORADO (Preto Total)
                    ctx.fillStyle = 'rgba(0, 0, 0, 1.0)'; 
                    ctx.fillRect(ox+x*SCALE, oy+y*SCALE, SCALE, SCALE);
                }
            } else {
                 // ÁREA DENTRO DO FOV (Totalmente visível, sem sombra)
                 // Não faz nada aqui. A iluminação será aplicada na próxima etapa.
            }
        }
    }
    
    // 2b. Gradiente de luz (Gradiente Radial Inverso)
    const innerRadius = lightRadiusPixels * 0.7; // Começa a escurecer mais cedo (gradiente)
    const outerRadius = lightRadiusPixels * 1.0; // Escuridão total no limite do FoV

    const gradient = ctx.createRadialGradient(
        playerScreenX, playerScreenY, innerRadius,
        playerScreenX, playerScreenY, outerRadius
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(0.75, 'rgba(0, 0, 0, 0.2)'); 
    gradient.addColorStop(1, 'rgba(0, 0, 0, 1)'); 

    // 2. Preenche a tela inteira com o gradiente
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.restore(); // Restaura globalCompositeOperation para 'source-over'
    
    // 2c. Efeito de Ruído Sombrio Final (Para dar o aspecto MSDOS/Sombrio)
    if (!fogPattern) {
        createFogPattern();
    }
    ctx.fillStyle = fogPattern;
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1.0;
    
    // --- TEXTOS (Sempre por último, acima de tudo) ---
    for(let i=texts.length-1; i>=0; i--){ 
        let t=texts[i]; 
        
        t.y+=t.vy; 
        t.vy += 0.003; 
        
        t.life--; 
        ctx.globalAlpha = t.life / 100;

        ctx.fillStyle=t.color; 
        ctx.font=t.size || "10px Courier New"; 
        ctx.textAlign="center";
        ctx.fillText(t.val, ox+t.x*SCALE, oy+t.y*SCALE); 
        
        ctx.globalAlpha = 1.0; 

        if(t.life<=0) texts.splice(i,1); 
    }

    // RENDERIZAÇÃO DE HUD MOBILE (dentro do canvas, no topo) - APENAS NA VERTICAL (RETRATO)
    if (isMobile && innerWidth < innerHeight && me && !gamepadActive) { 
        ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillRect(0, 0, canvas.width, 30);
        
        ctx.fillStyle = "#0f0"; ctx.font = "12px Courier New"; ctx.textAlign = "left";
        let diffName = state.theme === "#f00" ? "HORDE I" : state.theme === "#900" ? "HORDE II" : state.theme === "#102" ? "HELL" : state.theme === "#311" ? "NIGHTMARE" : "NORMAL";
        ctx.fillText(`LVL ${me.level} ${diffName}`, 5, 12);
        
        const barX = 5;
        const barY = 15;
        const barW = canvas.width / 4;
        
        // HP
        ctx.fillStyle = "#111"; ctx.fillRect(barX, barY, barW, 5);
        ctx.fillStyle = "#f00"; ctx.fillRect(barX, barY, barW * (me.hp/me.stats.maxHp), 5);
        
        // MP
        ctx.fillStyle = "#111"; ctx.fillRect(barX + barW + 5, barY, barW, 5);
        ctx.fillStyle = "#00f"; ctx.fillRect(barX + barW + 5, barY, barW * (me.mp/me.stats.maxMp), 5);
        
        // XP
        ctx.fillStyle = "#111"; ctx.fillRect(barX, barY + 6, (barW*2) + 5, 3);
        ctx.fillStyle = "#fb0"; ctx.fillRect(barX, barY + 6, ((barW*2) + 5) * (me.xp/(me.level*100)), 3);
    }
}

window.login = () => { 
    if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume().catch(err => console.error("Could not resume AudioContext after login click", err));
    AudioCtrl.init(); 
    socket.emit("login", document.getElementById("username").value); 
};
window.create = () => socket.emit("create_char", {name:document.getElementById("cname").value, cls:document.getElementById("cclass").value});
window.addStat = (s) => socket.emit("add_stat", s);
window.buy = (idx) => socket.emit("buy", shopItems[idx]);

draw();