/* =====================================================

   DIABLOCK — FINAL STABLE EDITION

   Fix: Camera Movement & Map Rendering Logic

   Visual: Procedural 2D + Modern Animation

   ===================================================== */



const HIT_FLASH_FRAMES = 5;

const TILE_SIZE = 16;

const SCALE = 16;



/* =========================

   AUDIO SYSTEM

   ========================= */

let bgm = null;

let cameraShake = 0;



const AudioCtrl = {

    ctx: new (window.AudioContext || window.webkitAudioContext)(),

    muted: false,

    init: function() { if (this.ctx.state === 'suspended') this.ctx.resume(); },

    playTone: function(freq, type, dur, vol=0.1, slide=0) {

        if(this.muted || this.ctx.state === 'suspended') return;

        try {

            const o = this.ctx.createOscillator(); const g = this.ctx.createGain();

            o.type = type; o.frequency.setValueAtTime(freq, this.ctx.currentTime);

            if(slide !== 0) o.frequency.linearRampToValueAtTime(freq + slide, this.ctx.currentTime + dur);

            g.gain.setValueAtTime(vol, this.ctx.currentTime); 

            g.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime+dur);

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

            const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 800;

            s.connect(f); f.connect(g); g.connect(this.ctx.destination); s.start();

        } catch(e) {}

    }

};



function ensureAudio() { AudioCtrl.init(); }



function playSfx(name) {

    if(Math.random() > 0.9 && name === "atk") return; 

    switch(name) {

        case "atk": AudioCtrl.playNoise(0.1, 0.08); break;

        case "hit": AudioCtrl.playTone(80, "square", 0.1, 0.2, -40); break;

        case "dash": AudioCtrl.playTone(300, "sawtooth", 0.2, 0.1, -150); break;

        case "door": AudioCtrl.playTone(150, "sine", 0.5, 0.2, 50); break;

        case "gold": AudioCtrl.playTone(1200, "sine", 0.1, 0.1); break;

    }

}



/* =========================

   ARTISAN RENDERER (VISUAL SYSTEM)

   ========================= */

const ArtisanRender = {

    // 1. CHÃO PROCEDURAL CORRIGIDO

    // sx, sy = Posição na Tela (Onde desenhar)

    // gx, gy = Posição no Grid (Para gerar o desenho fixo)

    drawFloor: function(ctx, sx, sy, gx, gy, theme) {

        // Seed baseada no GRID para não "dançar" ao mover a câmera

        const seed = Math.sin(gx * 12.9898 + gy * 78.233) * 43758.5453;

        const type = Math.abs(seed - Math.floor(seed));

        

        // Fundo

        ctx.fillStyle = theme === "#444" ? "#2a2a2a" : "#111"; 

        ctx.fillRect(sx, sy, SCALE, SCALE);



        // Detalhes

        ctx.fillStyle = "rgba(0,0,0,0.3)";

        ctx.strokeStyle = "rgba(255,255,255,0.05)";

        

        if (type > 0.90) { // Rachadura

            ctx.beginPath(); 

            ctx.moveTo(sx+4, sy+4); ctx.lineTo(sx+10, sy+10); ctx.lineTo(sx+12, sy+8); 

            ctx.stroke();

        } else if (type < 0.10) { // Pedrinhas

            ctx.fillRect(sx+3, sy+10, 2, 2); 

            ctx.fillRect(sx+10, sy+4, 1, 1);

        } else if (type > 0.4 && type < 0.45) { // Mancha

            ctx.beginPath(); ctx.arc(sx+8, sy+8, 3, 0, Math.PI*2); ctx.fill();

        }

        

        // Grade sutil

        ctx.strokeStyle = "rgba(0,0,0,0.2)"; 

        ctx.strokeRect(sx, sy, SCALE, SCALE);

    },



    // 2. PAREDES 2.5D

    drawWall: function(ctx, sx, sy, gx, gy) {

        // Topo da parede

        ctx.fillStyle = "#222"; 

        ctx.fillRect(sx, sy, SCALE, SCALE);

        ctx.fillStyle = "#333"; ctx.fillRect(sx, sy, SCALE, 1); // Highlight



        // Frente (Profundidade)

        ctx.fillStyle = "#0f0f0f"; 

        ctx.fillRect(sx, sy + SCALE, SCALE, 10); 

        

        // Detalhe Tijolo

        if ((gx + gy) % 2 === 0) {

            ctx.fillStyle = "#1a1a1a";

            ctx.fillRect(sx + 4, sy + SCALE + 2, 8, 2);

        }



        // Sombra Projetada no Chão

        ctx.fillStyle = "rgba(0,0,0,0.5)";

        ctx.fillRect(sx, sy + SCALE + 10, SCALE, 4);

    },



    // 3. ITENS (Pixel Art Style via Code)

    drawItem: function(ctx, item, x, y, size, angleOffset = 0) {

        if(!item) return;

        const rng = (seed) => { let x = Math.sin(seed) * 10000; return x - Math.floor(x); };

        let seed = 0; if (item.id) { for(let i=0; i<item.id.length; i++) seed += item.id.charCodeAt(i); }

        

        ctx.save();

        ctx.translate(x, y);

        const s = size / 16; 

        ctx.scale(s, s);

        ctx.rotate(angleOffset);



        const key = item.key || "";

        const color = item.color || "#aaa";



        // Glow

        if (item.rarity && item.rarity !== "common") {

            ctx.shadowBlur = 8; ctx.shadowColor = color;

        }



        if (key.includes("sword") || key.includes("dagger")) {

            const len = key.includes("dagger") ? 10 : 18 + rng(seed) * 6; 

            const width = 3 + rng(seed) * 2; 

            ctx.rotate(-Math.PI/4); 

            ctx.fillStyle = "#421"; ctx.fillRect(-2, 0, 4, 5); // Cabo

            ctx.fillStyle = color; ctx.beginPath(); ctx.moveTo(-6, -2); ctx.lineTo(6, -2); ctx.lineTo(0, 2); ctx.fill(); // Guarda

            ctx.fillStyle = "#eee"; ctx.beginPath(); ctx.moveTo(-width/2, -2); ctx.lineTo(width/2, -2); ctx.lineTo(0, -len); ctx.fill(); // Lamina

            ctx.fillStyle = item.rarity==="legendary" ? color : "rgba(0,0,0,0.2)"; ctx.fillRect(-0.5, -len+4, 1, len-6);

        } 

        else if (key.includes("axe")) {

            ctx.rotate(-Math.PI/4);

            ctx.fillStyle = "#532"; ctx.fillRect(-2, 0, 4, 18); 

            ctx.fillStyle = color; 

            ctx.beginPath(); ctx.moveTo(0, 2); ctx.quadraticCurveTo(14, -4, 8, 12); ctx.quadraticCurveTo(2, 8, 0, 6); ctx.fill();

            ctx.fillStyle = "#fff"; ctx.globalAlpha=0.4; ctx.beginPath(); ctx.moveTo(8, 2); ctx.lineTo(8, 12); ctx.stroke(); 

        } 

        else if (key.includes("staff")) {

            ctx.rotate(-Math.PI/4);

            ctx.fillStyle = "#421"; ctx.fillRect(-1, -10, 2, 24);

            ctx.shadowBlur = 15; ctx.shadowColor = item.color;

            ctx.fillStyle = item.color || "#0ff"; ctx.beginPath(); ctx.arc(0, -12, 4, 0, Math.PI*2); ctx.fill();

        } 

        else if (key.includes("bow")) {

            ctx.rotate(-Math.PI/4);

            ctx.strokeStyle = "#642"; ctx.lineWidth = 2;

            ctx.beginPath(); ctx.arc(0,0, 10, -Math.PI/2, Math.PI/2); ctx.stroke();

            ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.lineWidth = 0.5;

            ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(0, 10); ctx.stroke();

        }

        else if (key.includes("potion")) {

            const liquid = Math.sin(Date.now()/200)*2;

            ctx.fillStyle = "rgba(255,255,255,0.2)"; ctx.beginPath(); ctx.arc(0,0,6,0,Math.PI*2); ctx.stroke();

            ctx.fillStyle = color; ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2); ctx.fill();

            ctx.fillStyle = "#fff"; ctx.globalAlpha=0.5; ctx.beginPath(); ctx.arc(2,-2,2,0,Math.PI*2); ctx.fill();

            ctx.fillStyle = "#852"; ctx.fillRect(-2, -7, 4, 3);

        }

        else { 

            ctx.fillStyle = "#642"; ctx.fillRect(-5,-5,10,10);

            ctx.fillStyle = color; ctx.fillRect(-2,-2,4,4); 

            ctx.strokeStyle = "#864"; ctx.strokeRect(-5,-5,10,10);

        }

        ctx.restore();

    },



    // 4. ENTIDADES (Seus Modelos + Animação "Juicy")

    drawEntity: function(ctx, e, x, y, isMe) {

        const s = e.size || 12;

        const color = e.color || "#ccc";

        const t = Date.now() / 1000;

        

        // --- ANIMAÇÃO ---

        const breathe = 1 + Math.sin(t * 3) * 0.02; // Respira

        const isMoving = Math.abs(e.vx) > 0.01 || Math.abs(e.vy) > 0.01;

        const walkBob = isMoving ? Math.sin(t * 15) * 2 : 0; // Pula

        const walkTilt = isMoving ? Math.sin(t * 15) * 0.15 : 0; // Inclina

        

        let attackRot = 0;

        let attackThrust = 0;

        if (e.attackAnim > 0) {

            const p = 1 - (e.attackAnim / 10); 

            if(p < 0.3) attackRot = -0.5 * (p/0.3); // Puxa

            else attackRot = -0.5 + (2.0 * ((p-0.3)/0.7)); // Bate

            attackThrust = Math.sin(p * Math.PI) * 5; 

            e.attackAnim--; 

        }



        ctx.save();

        ctx.translate(x, y + walkBob);

        

        let dirX = (e.vx > 0.01) ? 1 : (e.vx < -0.01) ? -1 : 1;

        if(isMe && !isMobile) dirX = (mouse.x > canvas.width/2) ? 1 : -1;

        

        // Pivô nos pés

        ctx.translate(0, s/2); 

        ctx.rotate(walkTilt * dirX);

        ctx.scale(dirX, breathe);

        ctx.translate(0, -s/2);

        

        ctx.translate(attackThrust, 0);



        // --- MODELOS ---

        if (e.class) { // PLAYER

            // Capa

            const capeSway = Math.sin(t*5 + (isMoving?t*10:0))*2;

            ctx.fillStyle = (e.class==="knight"?"#900":e.class==="mage"?"#205":"#242");

            ctx.beginPath(); ctx.moveTo(-4,-6); ctx.lineTo(-6+capeSway, 8); ctx.lineTo(6+capeSway, 8); ctx.lineTo(4,-6); ctx.fill();

            

            // Corpo & Cabeça

            ctx.fillStyle = e.equipment && e.equipment.body ? e.equipment.body.color : "#ccc"; ctx.fillRect(-4, -6, 8, 10);

            ctx.fillStyle = e.equipment && e.equipment.head ? e.equipment.head.color : "#fb0"; ctx.fillRect(-3, -10, 6, 4);



            // Olhos

            if (e.id === myId) {

                ctx.fillStyle = "white"; ctx.fillRect(-2, -8, 2, 2); ctx.fillRect(2, -8, 2, 2); 

                let lookAngle = (!isMobile && !gamepadActive) ? getMouseAngle() : getAttackAngle();

                let lx = Math.cos(lookAngle); let ly = Math.sin(lookAngle); if (dirX === -1) lx = -lx;

                ctx.fillStyle = "black"; ctx.fillRect(-1.5 + lx, -7.5 + ly, 1, 1); ctx.fillRect(2.5 + lx, -7.5 + ly, 1, 1);

            } else {

                ctx.fillStyle = "#000"; ctx.fillRect(-2, -8, 1, 1); ctx.fillRect(2, -8, 1, 1);

            }



            // ARMA

            if(e.equipment && e.equipment.hand) {

                ctx.save(); 

                ctx.translate(5, 2); 

                const idleRot = isMoving ? Math.sin(t * 15) * 0.5 : Math.sin(t * 2) * 0.1;

                ctx.rotate(idleRot + attackRot * 2.5); 

                ctx.scale(0.7, 0.7); 

                ArtisanRender.drawItem(ctx, e.equipment.hand, 0, 0, 16, Math.PI/2); 

                ctx.restore();

            } else { // Soco

                ctx.fillStyle = "#ecc";

                ctx.save(); ctx.translate(6 + (attackRot*5), 2); ctx.beginPath(); ctx.arc(0,0,2,0,Math.PI*2); ctx.fill(); ctx.restore();

            }

        } 

        else if (e.name && e.name.includes("TIAMAT")) {

            const bs = s; const pulse = Math.sin(t * 5) * bs * 0.05;

            ctx.shadowBlur = 30; ctx.shadowColor = "#f00"; ctx.fillStyle = "#100"; ctx.strokeStyle = "#602"; ctx.lineWidth = 2;

            ctx.beginPath(); ctx.ellipse(0, 0, bs*0.6, bs*0.8 + pulse, 0, 0, Math.PI*2); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;

            const headColors = ["#f33", "#b0f", "#f33"];

            for (let i = -1; i <= 1; i++) {

                const hx = i * bs * 0.45; const hy = -bs * 0.95 + Math.sin(t * 4 + i) * 5;

                ctx.strokeStyle = "#301"; ctx.lineWidth = bs * 0.15; 

                ctx.beginPath(); ctx.moveTo(0, -bs*0.4); ctx.quadraticCurveTo(hx*0.5, -bs*0.7, hx, hy); ctx.stroke();

                ctx.save(); ctx.translate(hx, hy); ctx.rotate(Math.sin(t*5+i)*0.2); 

                ctx.fillStyle = headColors[i+1]; ctx.beginPath(); ctx.moveTo(-5, -5); ctx.lineTo(5, -5); ctx.lineTo(0, 8); ctx.fill();

                ctx.fillStyle = "#ff0"; ctx.shadowBlur=10; ctx.shadowColor="#ff0"; ctx.fillRect(-2, -2, 4, 2); ctx.shadowBlur=0;

                ctx.restore();

            }

        }

        else if (e.name && e.name.includes("Butcher")) {

            ctx.fillStyle = "#964"; ctx.fillRect(-s/1.5, -s, s*1.3, s*1.8);

            ctx.fillStyle = "#400"; ctx.fillRect(-s/1.5, 0, s*1.3, s);

            ctx.save(); ctx.translate(s/2, -s/2); ctx.rotate(attackRot*3); 

            ctx.fillStyle = "#311"; ctx.fillRect(0, 0, 4, 10);

            ctx.fillStyle = "#ddd"; ctx.fillRect(0, -15, 12, 20); 

            ctx.restore();

            ctx.fillStyle = "#000"; ctx.fillRect(-4, -s+4, 2, 2); ctx.fillRect(2, -s+4, 2, 2);

        }

        else if (e.type === "rat") {

            ctx.fillStyle = "#654"; ctx.beginPath(); ctx.ellipse(0, 2, 6, 3, 0, 0, Math.PI*2); ctx.fill();

            const tailWag = Math.sin(t * 20) * 3; ctx.strokeStyle="#fbb"; ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(6, 2); ctx.quadraticCurveTo(8, 2, 10, 2 + tailWag); ctx.stroke();

            ctx.fillStyle = "#654"; ctx.beginPath(); ctx.arc(-4, -1, 2, 0, Math.PI*2); ctx.fill();

        }

        else { // Genérico

            ctx.fillStyle = color; ctx.fillRect(-s/2, -s/2, s, s);

            ctx.fillStyle = "#ff0"; ctx.fillRect(-2, -2, 1, 1); ctx.fillRect(2, -2, 1, 1);

        }

        ctx.restore();

    }

};



/* =========================

   ENGINE & STATE

   ========================= */

const socket = io({ transports: ['websocket'], upgrade: false });

const canvas = document.getElementById("c");

const ctx = canvas.getContext("2d", { alpha: false });



let myId = null, me = null;

let state = { pl:{}, mb:{}, it:{}, pr:[], props:[], map:[], explored: [], lightRadius: 15, hint: null };

let recipes = [];

let cam = { x:0, y:0 }, mouse = { x:0, y:0 };

let texts = [], effects = [];

let uiState = { inv:false, char:false, shop:false, craft:false, chat:false };

let inputState = { x:0, y:0, block:false };

let shopItems = [];

const tooltip = document.getElementById("tooltip");



let isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

let gamepad = null, gamepadActive = false;

let focusIndex = 0;



let joystick = { active: false, id: null, startX: 0, startY: 0, normX: 0, normY: 0, radius: 50, knob: document.getElementById('joystick-knob') };

const keys = { w:false, a:false, s:false, d:false, q:false, game_x: 0, game_y: 0 };

let lastInputTime = 0;

let modalOpen = false;



/* =========================

   INPUT HANDLING

   ========================= */

function sendInput(force=false) {

    const now = Date.now();

    let dx = (keys.d ? 1 : 0) - (keys.a ? 1 : 0);

    let dy = (keys.s ? 1 : 0) - (keys.w ? 1 : 0);

    if (gamepadActive && (Math.abs(keys.game_x) > 0.1 || Math.abs(keys.game_y) > 0.1)) { dx = keys.game_x; dy = keys.game_y; }

    if (joystick.active) { dx = joystick.normX; dy = joystick.normY; }

    if (uiState.chat) { dx = 0; dy = 0; }

    const isStopping = (dx === 0 && dy === 0 && (inputState.x !== 0 || inputState.y !== 0));

    if (!force && !isStopping && now - (window.lastInputTime||0) < 50) return;

    inputState = { x: dx, y: dy, block: keys.q };

    socket.emit("input", inputState);

    window.lastInputTime = now;

}



window.addEventListener("keydown", e => {

    if (document.getElementById("menu").style.display !== "none") return;

    const k = e.key.toLowerCase();

    if (k === "enter" && !uiState.chat) {

        uiState.chat = true; document.getElementById("chat-container").style.display = "block";

        setTimeout(() => document.getElementById("chat-input").focus(), 50); return;

    }

    if (uiState.chat && k !== "escape") return;

    if (keys.hasOwnProperty(k)) { keys[k] = true; sendInput(true); }

    if (k === "i") toggleMenu("inv"); if (k === "c") toggleMenu("char"); if (k === "k") toggleMenu("craft");

    if (k === "r" && uiState.shop) socket.emit("repair_all");

    if (k === "escape") closeAllMenus();

    if (k === " ") socket.emit("dash", getDashAngle()); if (k === "e") socket.emit("potion");

    updateUI();

});

window.addEventListener("keyup", e => { const k = e.key.toLowerCase(); if (keys.hasOwnProperty(k)) { keys[k] = false; sendInput(true); } });

window.onmousemove = e => { mouse.x = e.clientX; mouse.y = e.clientY; if(!isMobile) { tooltip.style.left = (mouse.x+15)+"px"; tooltip.style.top = (mouse.y+15)+"px"; } };

window.onmousedown = (e) => {

    if (isClickOnUI(e)) return; ensureAudio();

    if (!me || uiState.chat || gamepadActive) return;

    const ang = getAttackAngle();

    if (e.button === 0) socket.emit("attack", ang);

    if (e.button === 2) socket.emit("skill", { idx: 1, angle: ang });

};



function toggleMenu(menu) {

    const wasOpen = uiState[menu];

    uiState.inv = uiState.char = uiState.shop = uiState.craft = false;

    uiState[menu] = !wasOpen;

    focusIndex = 0; updateUI();

}

function isClickOnUI(e) {

    const uiIds = ["inventory", "char-panel", "shop-panel", "craft-panel", "menu", "chat-container"];

    for (const id of uiIds) {

        const el = document.getElementById(id);

        if (el && el.offsetParent !== null) { 

            const r = el.getBoundingClientRect();

            if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return true;

        }

    }

    return false;

}



const JOYSTICK_EL = document.getElementById('joystick-area');

JOYSTICK_EL.addEventListener('touchstart', e => { if (gamepadActive) return; const t = e.touches[0]; joystick.active = true; joystick.id = t.identifier; joystick.startX = t.clientX; joystick.startY = t.clientY; joystick.knob.style.display = 'block'; }, {passive:false});

JOYSTICK_EL.addEventListener('touchmove', e => { if (!joystick.active) return; const t = e.changedTouches[0]; if(t.identifier !== joystick.id) return; let dx = t.clientX - joystick.startX; let dy = t.clientY - joystick.startY; let dist = Math.hypot(dx, dy); if (dist > joystick.radius) { dx = dx / dist * joystick.radius; dy = dy / dist * joystick.radius; } joystick.normX = dx / joystick.radius; joystick.normY = dy / joystick.radius; joystick.knob.style.transform = `translate(${dx}px, ${dy}px)`; sendInput(); }, {passive:false});

const endTouch = () => { joystick.active = false; joystick.normX = 0; joystick.normY = 0; joystick.knob.style.display = 'none'; sendInput(true); };

JOYSTICK_EL.addEventListener('touchend', endTouch); JOYSTICK_EL.addEventListener('touchcancel', endTouch);



/* =========================

   SOCKET & UI

   ========================= */

socket.on("connect", () => myId=socket.id);

socket.on("char_list", list => {

    document.getElementById("login-form").style.display="none"; document.getElementById("char-select").style.display="block";

    const l = document.getElementById("char-list"); l.innerHTML="";

    for(let n in list){ let d=document.createElement("div"); d.className="btn"; d.innerHTML=`${n} <span style="color:#fb0; font-size:0.8em">LVL ${list[n].level}</span>`; d.onclick=()=>{ socket.emit("enter_game", n); document.getElementById("menu").style.display="none"; ensureAudio(); }; l.appendChild(d); }

});

socket.on("game_start", d => { if(d.recipes) recipes = d.recipes; renderCrafting(); });

socket.on("map_data", d => { state.map = d.map; state.theme = d.theme; state.explored = []; cameraShake = 5; });

socket.on("u", d => { 

    Object.assign(state, d); me = state.pl[myId];

    if(me && state.theme === "#444") { 

        const stairs = state.props.find(p => p.type === "stairs");

        if(stairs && Math.hypot(me.x - stairs.x, me.y - stairs.y) < 2.5) {

            if(!modalOpen) { document.getElementById('entry-modal').style.display = 'block'; modalOpen = true; playSfx("door"); }

        } else if(modalOpen) { document.getElementById('entry-modal').style.display = 'none'; modalOpen = false; }

    }

    if(me) updateUI(); 

});

socket.on("txt", d => {

    let vy = -0.5 - Math.random() * 0.5;

    if(String(d.val).includes("!")) { vy *= 1.5; spawnParticle(d.x, d.y, d.color, 10, 1.5); }

    texts.push({ val: String(d.val), x: d.x, y: d.y, vx: (Math.random()-0.5)*1, vy, life: 60, color: d.color || "#fff", gravity: 0.02 });

});

socket.on("fx", d => {

    if (d.type === "slash") { 

        playSfx("atk"); 

        let actor = null;

        if (me && Math.hypot(me.x-d.x, me.y-d.y) < 1.0) actor = me;

        else for(let id in state.pl) if(Math.hypot(state.pl[id].x-d.x, state.pl[id].y-d.y)<1) actor=state.pl[id];

        else for(let id in state.mb) if(Math.hypot(state.mb[id].x-d.x, state.mb[id].y-d.y)<1.5) actor=state.mb[id];

        if(actor) actor.attackAnim = 12; 

        

        let style = "slash";

        if(actor && actor.equipment && actor.equipment.hand) {

            const k = actor.equipment.hand.key;

            if(k.includes("axe")) style = "chop"; else if(k.includes("dagger")) style="stab";

        }

        effects.push({ type: style, x: d.x, y: d.y, angle: d.angle, life: 10, color: "#fff" });

    }

    else if (d.type === "hit") { spawnParticle(d.x, d.y, "#900", 6, 1.0, 20, "blood"); playSfx("hit"); }

    else if (d.type === "nova") { effects.push({ type: "nova", x: d.x, y: d.y, life: 20, color: d.color || "#0ff" }); }

    else if (d.type === "fireball") { spawnParticle(d.x, d.y, "#f50", 8, 1.5, 25, "spark"); }

    else if (d.type === "dash") { playSfx("dash"); spawnParticle(d.x, d.y, "#fff", 5, 0.5, 10, "trail"); }

});

socket.on("chat", d => { playSfx("chat"); addLog(`${state.pl[d.id]?.name || "Unk"}: ${d.msg}`, "#fff"); });

socket.on("open_shop", items => { uiState.shop = true; shopItems = items; updateUI(); });

socket.on("log", d => addLog(d.msg, d.color));



function addLog(msg, color="#0f0") {

    const d = new Date(); const time = `[${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}]`;

    const logDiv = document.getElementById("game-log"); const entry = document.createElement("div");

    entry.innerHTML = `<span style="color:#555">${time}</span> <span style="color:${color}; text-shadow:0 0 5px ${color}">${msg}</span>`;

    logDiv.prepend(entry); if(logDiv.children.length > 50) logDiv.removeChild(logDiv.lastChild);

}



function getMouseAngle() { return Math.atan2((mouse.y - canvas.height/2), (mouse.x - canvas.width/2)); }

function getDashAngle() {

    if (joystick.active) return Math.atan2(joystick.normY, joystick.normX);

    if (gamepadActive) return Math.atan2(keys.game_y, keys.game_x);

    const kdx = (keys.d?1:0)-(keys.a?1:0); const kdy = (keys.s?1:0)-(keys.w?1:0);

    if(kdx!==0||kdy!==0) return Math.atan2(kdy, kdx);

    return (!isMobile) ? getMouseAngle() : (me ? Math.atan2(me.vy||0, me.vx||1) : 0);

}

function getAttackAngle() {

    if (!isMobile && !gamepadActive) return getMouseAngle();

    let closest = null, minD = 100; 

    if (state.mb) { for(let k in state.mb) { let m = state.mb[k]; if(m.hp>0 && !m.npc && m.ai!=="resource") { let d = Math.hypot(m.x - me.x, m.y - me.y); if(d < minD) { minD = d; closest = m; } } } }

    if (closest) return Math.atan2(closest.y - me.y, closest.x - me.x);

    return getDashAngle();

}



function updateUI() {

    if(!me) return;

    const maxHp = me.stats.maxHp||100; const maxMp = me.stats.maxMp||50;

    document.getElementById("hp-bar").style.width = ((me.hp/maxHp)*100)+"%";

    document.getElementById("mp-bar").style.width = ((me.mp/maxMp)*100)+"%";

    document.getElementById("xp-bar").style.width = ((me.xp/((me.level+1)*100))*100)+"%";

    document.getElementById("hp-txt").innerText = `${Math.ceil(me.hp)}/${maxHp}`;

    document.getElementById("mp-txt").innerText = `${Math.ceil(me.mp)}/${maxMp}`;

    document.getElementById("lvl-txt").innerText = state.theme === "#444" ? "SAFE ZONE" : `DEPTH ${me.level}`;

    document.getElementById("hud-gold").innerText = `${me.gold} G`;

    document.getElementById("cp-pts").innerText = me.pts;

    document.getElementById("val-str").innerText = me.attrs.str; document.getElementById("val-dex").innerText = me.attrs.dex; document.getElementById("val-int").innerText = me.attrs.int;

    document.getElementById("stat-dmg").innerText = me.stats.dmg;

    

    document.getElementById("inventory").style.display = uiState.inv ? "block" : "none";

    document.getElementById("char-panel").style.display = uiState.char ? "block" : "none";

    document.getElementById("shop-panel").style.display = uiState.shop ? "block" : "none";

    document.getElementById("craft-panel").style.display = uiState.craft ? "block" : "none";

    

    if(uiState.inv) renderInventory();

    if(uiState.char) renderEquipment();

    if(uiState.shop) renderShop();

}



function getIconCanvas(it) {

    const c = document.createElement("canvas"); c.width=32; c.height=32;

    const ctx = c.getContext("2d"); ArtisanRender.drawItem(ctx, it, 16, 16, 30);

    return c;

}

function renderInventory() {
    const g = document.getElementById("inv-grid");
    g.innerHTML = "";

    for (let i = 0; i < 20; i++) {
        const it = me.inventory[i];
        const slot = document.createElement("div");
        slot.className = "slot";

        if (it) {
            slot.appendChild(getIconCanvas(it));
            slot.style.borderColor = it.color || "#444";

            // ✅ CLIQUE CORRETO (mousedown)
            slot.onmousedown = (e) => {
                e.preventDefault();
                e.stopPropagation();

                // Botão direito → DROP
                if (e.button === 2) {
                    socket.emit("drop", i);
                    return;
                }

                // Botão esquerdo → EQUIPAR / USAR
                if (it.key === "potion") {
                    socket.emit("potion");
                } 
                else if (it.slot) {
                    socket.emit("equip", i);
                }
            };

            // ❌ Desativa menu do navegador
            slot.oncontextmenu = (e) => e.preventDefault();

            slot.onmouseenter = () => showTooltip(it, slot);
            slot.onmouseleave = () => hideTooltip();
        }

        g.appendChild(slot);
    }
}


function renderEquipment() {

    const slots = ["head", "body", "hand", "rune", "potion"];

    slots.forEach(s => {

        const el = document.getElementById("eq-"+s); el.innerHTML = "";

        const it = me.equipment[s];

        el.style.borderColor = it ? it.color : "#333";

        if(it) {

            el.appendChild(getIconCanvas(it));

            el.onclick = () => socket.emit(s==="potion"?"potion":"unequip", s);

            el.onmouseenter = () => showTooltip(it, el); el.onmouseleave = () => hideTooltip();

        }

    });

}

function renderShop() {

    const g = document.getElementById("shop-grid"); g.innerHTML = "";

    shopItems.forEach((it, idx) => {

        const slot = document.createElement("div"); slot.className = "slot";

        slot.appendChild(getIconCanvas(it)); slot.style.borderColor = it.color;

        slot.onclick = () => socket.emit("buy", idx);

        slot.onmouseenter = () => showTooltip(it, slot); slot.onmouseleave = () => hideTooltip();

        g.appendChild(slot);

    });

}

function renderCrafting() {

    const l = document.getElementById("craft-list");

    if(l.children.length > 0 && !uiState.craft) return;

    l.innerHTML = "";

    if(!recipes) return;

    recipes.forEach((r, idx) => {

        const d = document.createElement("div"); 

        d.style.cssText = "padding:8px; border-bottom:1px solid #333; cursor:pointer; display:flex; justify-content:space-between;";

        d.innerHTML = `<span style="color:#ddd">${r.res.toUpperCase()}</span> <span style="font-size:0.8em; color:#888">W:${r.req.wood} S:${r.req.stone}</span>`;

        d.onclick = () => socket.emit("craft", {action:"create", recipeIdx:idx});

        d.onmouseenter = () => { d.style.background = "#202"; }; d.onmouseleave = () => { d.style.background = "transparent"; };

        l.appendChild(d);

    });

}

function showTooltip(it, el) {

    if(!it) return;

    const rect = el.getBoundingClientRect();

    tooltip.style.display = "block"; tooltip.style.left = (rect.right + 10) + "px"; tooltip.style.top = rect.top + "px";

    let h = `<div style="color:${it.color}; font-weight:bold;">${it.name}</div>`;

    if(it.price) h += `<br>Price: ${it.price}G`;

    if(it.stats) { for(let s in it.stats) h += `<br>${s.toUpperCase()}: ${it.stats[s]}`; }

    if(it.dur !== undefined) h += `<br>Dur: ${it.dur}/${it.maxDur}`;

    tooltip.innerHTML = h;

}

function hideTooltip() { tooltip.style.display = "none"; }

function closeAllMenus() { uiState.inv=false; uiState.char=false; uiState.shop=false; uiState.craft=false; tooltip.style.display="none"; updateUI(); }



/* =========================

   MAIN RENDER LOOP

   ========================= */

const COLORS = { void: "#050005", floor: "#0a050a", wallTop: "#2a1a2a", grid: "rgba(50, 0, 50, 0.1)" };



function spawnParticle(x, y, color, count=1, speed=1, life=20, type="spark") {

    for(let i=0; i<count; i++) {

        const angle = Math.random() * Math.PI * 2; const vel = Math.random() * speed;

        effects.push({ type: type, x: x, y: y, vx: Math.cos(angle) * vel, vy: Math.sin(angle) * vel, color: color, life: life + Math.random() * 10, maxLife: life + 10 });

    }

}



function draw() {

    requestAnimationFrame(draw);

    if (canvas.width !== window.innerWidth) canvas.width = window.innerWidth;

    if (canvas.height !== window.innerHeight) canvas.height = window.innerHeight;



    if(me) {

        let shakeX = 0, shakeY = 0;

        if(cameraShake > 0) { shakeX = (Math.random()-0.5)*cameraShake; shakeY = (Math.random()-0.5)*cameraShake; cameraShake *= 0.9; }

        cam.x += (me.x * SCALE - canvas.width/2 - cam.x) * 0.1;

        cam.y += (me.y * SCALE - canvas.height/2 - cam.y) * 0.1;

        cam.x += shakeX; cam.y += shakeY;

    }

    const ox = -Math.floor(cam.x), oy = -Math.floor(cam.y);

    

    ctx.fillStyle = COLORS.void; ctx.fillRect(0, 0, canvas.width, canvas.height);



    const buffer = 4;

    const startCol = Math.floor(cam.x / SCALE) - buffer;

    const endCol = startCol + (canvas.width / SCALE) + (buffer * 2);

    const startRow = Math.floor(cam.y / SCALE) - buffer;

    const endRow = startRow + (canvas.height / SCALE) + (buffer * 2);



    // 1. CHÃO (Floor)

    if(state.map) {

        for (let y = startRow; y <= endRow; y++) {

            if(!state.map[y]) continue;

            for (let x = startCol; x <= endCol; x++) {

                if (state.map[y][x] === 0) ArtisanRender.drawFloor(ctx, ox + x*SCALE, oy + y*SCALE, x, y, state.theme);

            }

        }

    }



    // 2. ORDENAÇÃO Y (Paredes, Items, Entidades)

    let renderList = [];

    if(state.map) {

        for (let y = startRow; y <= endRow; y++) {

            if(!state.map[y]) continue;

            for (let x = startCol; x <= endCol; x++) {

                if(state.map[y][x]===1) renderList.push({type:"wall", x:x*SCALE, y:y*SCALE, gx:x, gy:y});

            }

        }

    }

    state.props.forEach(p => renderList.push({type:"prop", obj:p, x:p.x*SCALE, y:p.y*SCALE}));

    for(let k in state.it) renderList.push({type:"item", obj:state.it[k], x:state.it[k].x*SCALE, y:state.it[k].y*SCALE});

    [...Object.values(state.pl), ...Object.values(state.mb)].forEach(e => renderList.push({type:"entity", obj:e, x:e.x*SCALE+SCALE/2, y:e.y*SCALE+SCALE/2}));



    renderList.sort((a,b) => a.y - b.y);



    renderList.forEach(r => {

        const px = ox + r.x; const py = oy + r.y;

        

        if(r.type === "wall") {

            ArtisanRender.drawWall(ctx, px, py, r.gx, r.gy);

        }

        else if(r.type === "prop") {

            const p = r.obj;

            if (p.type === "stairs") {

                ctx.fillStyle = p.locked ? "#500" : "#0f0"; ctx.fillRect(px - 6, py - 6, 12, 12);

                ctx.fillStyle = "#fff"; ctx.font = "10px monospace"; ctx.fillText(p.locked ? "🔒" : "⇩", px-3, py+4);

                if(me && Math.hypot(me.x - p.x, me.y - p.y) < 3.0) {

                    const float = Math.sin(Date.now()/200)*2;

                    ctx.fillStyle = "#fff"; ctx.font = "10px monospace"; ctx.textAlign = "center";

                    ctx.fillText("⇩ ENTRAR", px, py - 15 + float);

                }

            } else if (p.type === "shrine") {

                const float = Math.sin(Date.now()/500)*3;

                ctx.fillStyle = "#0ff"; ctx.fillRect(px-4, py-6 + float, 8, 12);

                ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "rgba(0, 255, 255, 0.2)"; 

                ctx.beginPath(); ctx.arc(px, py, 20 + float, 0, Math.PI*2); ctx.fill(); 

                ctx.globalCompositeOperation = "source-over";

            }

        }

        else if(r.type === "item") {

            const float = Math.sin(Date.now()/300) * 3;

            if(r.obj.item.rarity !== "common") {

                ctx.globalCompositeOperation = "lighter";

                const grad = ctx.createLinearGradient(0, -30, 0, 10);

                grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, r.obj.item.color);

                ctx.save(); ctx.translate(px, py); ctx.fillStyle = grad; ctx.fillRect(-2, -30, 4, 40); ctx.restore();

                ctx.globalCompositeOperation = "source-over";

            }

            ArtisanRender.drawItem(ctx, r.obj.item, px, py + float, 16);

        }

        else if(r.type === "entity") {

            const e = r.obj;

            const shadowScale = 1 + Math.sin(Date.now()/200)*0.1;

            ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.beginPath(); ctx.ellipse(px, py+4, 6*shadowScale, 3*shadowScale, 0, 0, Math.PI*2); ctx.fill();

            if(e.hitFlash > 0) { ctx.globalCompositeOperation = "lighter"; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(px, py, 10, 0, Math.PI*2); ctx.fill(); ctx.globalCompositeOperation = "source-over"; }

            

            ArtisanRender.drawEntity(ctx, e, px, py, e.id===myId);



            if(e.hp < (e.maxHp||100) && e.hp > 0) {

                const pct = e.hp / (e.maxHp||100);

                ctx.fillStyle = "#000"; ctx.fillRect(px - 8, py - (e.size||12) - 6, 16, 3);

                ctx.fillStyle = e.boss ? "#f0f" : "#f00"; ctx.fillRect(px - 8, py - (e.size||12) - 6, 16 * pct, 3);

            }

            if((e.id === myId) || e.boss || e.npc) {

                ctx.font = "8px 'VT323'"; ctx.fillStyle = "#fff"; ctx.textAlign = "center";

                ctx.fillText(e.name, px, py - (e.size||12) - 8);

            }

        }

    });



    state.pr.forEach(p => {

        const px = Math.floor(ox + p.x * SCALE), py = Math.floor(oy + p.y * SCALE);

        if(!isMobile) spawnParticle(p.x, p.y, p.type==="fireball"?"#f80":"#0ff", 1, 0.2, 5, "trail");

        ctx.save(); ctx.translate(px, py); ctx.rotate(p.angle || 0);

        if(p.type === "arrow") { ctx.fillStyle = "#ff0"; ctx.fillRect(-6, -1, 12, 2); } 

        else if (p.type.includes("fireball")) { ctx.fillStyle = "#f80"; ctx.beginPath(); ctx.arc(0,0,4,0,Math.PI*2); ctx.fill(); }

        else { ctx.fillStyle = "#0ff"; ctx.beginPath(); ctx.arc(0,0, 3, 0, Math.PI*2); ctx.fill(); }

        ctx.restore();

    });



    ctx.globalCompositeOperation = "lighter";

    for(let i = effects.length - 1; i >= 0; i--) {

        let e = effects[i]; e.life--; e.x += e.vx || 0; e.y += e.vy || 0;

        e.vx *= 0.9; e.vy *= 0.9; if (e.type === "blood") e.vy += 0.05; 

        const px = Math.floor(ox + e.x * SCALE), py = Math.floor(oy + e.y * SCALE);

        ctx.globalAlpha = e.life / (e.maxLife || 20); ctx.fillStyle = e.color || "#fff";

        

        if(e.type==="slash") {

            ctx.strokeStyle = `rgba(255,255,255,${e.life/8})`; ctx.lineWidth=3;

            ctx.beginPath(); ctx.arc(px, py, 20, e.angle-1.2, e.angle+1.2); ctx.stroke();

        }

        else if(e.type==="chop") {

            ctx.strokeStyle = `rgba(255,200,200,${e.life/8})`; ctx.lineWidth=4;

            ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(px + Math.cos(e.angle)*20, py + Math.sin(e.angle)*20); ctx.stroke();

        }

        else if(e.type==="stab") {

            ctx.fillStyle = "#fff"; ctx.font="14px monospace"; ctx.fillText("X", px, py);

        }

        else if(e.type==="nova") { ctx.strokeStyle=e.color; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(px,py,(20-e.life)*2,0,Math.PI*2); ctx.stroke(); }

        else ctx.fillRect(px, py, 2, 2);

        

        if(e.life <= 0) effects.splice(i, 1);

    }

    ctx.globalAlpha = 1.0; ctx.globalCompositeOperation = "source-over";



    for(let i=texts.length-1; i>=0; i--){ 

        let t=texts[i]; t.y += t.vy; t.x += t.vx; t.life--; 

        if (t.gravity) t.vy += t.gravity; 

        ctx.globalAlpha = Math.min(1.0, t.life / 20); ctx.fillStyle = t.color; 

        ctx.font = `bold ${t.size||10}px 'VT323'`; ctx.textAlign = "center"; 

        ctx.strokeStyle = "#000"; ctx.lineWidth = 3; ctx.strokeText(t.val, ox + t.x * SCALE, oy + t.y * SCALE);

        ctx.fillText(t.val, ox + t.x * SCALE, oy + t.y * SCALE); 

        if(t.life<=0) texts.splice(i,1); 

    }

    ctx.globalAlpha = 1.0;



    const screenCx = ox + me.x * SCALE, screenCy = oy + me.y * SCALE;

    const flicker = Math.random() * 0.5;

    const r = (state.lightRadius * SCALE) + flicker;

    const grad = ctx.createRadialGradient(screenCx, screenCy, r * 0.4, screenCx, screenCy, r);

    grad.addColorStop(0, "rgba(0,0,0,0)"); grad.addColorStop(1, "rgba(5,0,5,1)");

    ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);



    if(!isMobile) {

        const gps = navigator.getGamepads ? navigator.getGamepads() : [];

        if(gps[0]) {

            gamepad = gps[0]; gamepadActive = true;

            let ax0 = gamepad.axes[0], ay0 = gamepad.axes[1];

            if(Math.abs(ax0)<0.2) ax0=0; if(Math.abs(ay0)<0.2) ay0=0;

            keys.game_x = ax0; keys.game_y = ay0;

            if(gamepad.buttons[0].pressed) socket.emit("attack", getAttackAngle());

            if(gamepad.buttons[1].pressed) socket.emit("dash", getDashAngle());

            if(gamepad.buttons[2].pressed) socket.emit("potion");

            if(gamepad.buttons[3].pressed) socket.emit("skill", {idx:1, angle:getAttackAngle()});

            sendInput();

        }

    }

}



window.login = () => { ensureAudio(); socket.emit("login", document.getElementById("username").value); };

window.create = () => socket.emit("create_char", {name:document.getElementById("cname").value, cls:document.getElementById("cclass").value});

window.addStat = (s) => socket.emit("add_stat", s);

window.buy = (idx) => socket.emit("buy", idx);

window.sell = () => { if(focusIndex>=0) socket.emit("sell", focusIndex); updateUI(); };

window.closeShop = closeAllMenus;



draw();
