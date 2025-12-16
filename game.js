const socket = io();
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const SCALE = 16;
let myId = null, me = null;
let state = { pl:{}, mb:{}, it:{}, pr:[], props:[], map:[] };
let recipes = [];
let cam = { x:0, y:0 }, mouse = { x:0, y:0 };
let texts = [], effects = [];
let uiState = { inv: false, char: false, shop: false, craft: false, chat: false };
let inputState = { x:0, y:0, block: false };
let shopItems = [];
const tooltip = document.getElementById("tooltip");
let dragItem = null;
const isMobile = window.matchMedia("(max-width: 768px)").matches;

// --- AUDIO SYSTEM (REVERTED TO STABLE VERSION) ---
const AudioCtrl = {
    ctx: new (window.AudioContext || window.webkitAudioContext)(),
    bgm: null,
    muted: false,
    init: function() {
        // Tenta tocar o BGM logo após o login (gesto do usuário)
        if(!this.bgm) {
            this.bgm = new Audio("/assets/bgm.mp3");
            this.bgm.loop = true;
            this.bgm.volume = 0.3;
            this.bgm.play().catch(e => console.log("Click/Tap required to play audio."));
        }
    },
    // Funções SFX (sem resume() embutido, confiando no estado inicial)
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

const resize = () => { canvas.width=innerWidth; canvas.height=innerHeight; ctx.imageSmoothingEnabled=false; };
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
            AudioCtrl.init(); // Tenta iniciar o BGM no login (gating the experience)
        };
        l.appendChild(d);
    }
});
socket.on("game_start", d => { recipes = d.recipes; renderCrafting(); });
socket.on("u", d => { state=d; me=state.pl[myId]; if(me) updateUI(); });
socket.on("txt", d => {
    texts.push({...d, life:40, vy:-0.5});
    if(d.val.includes("CRAFT")) playSfx("craft");
    if(d.val.includes("LEVEL")) playSfx("levelup");
});
socket.on("fx", d => {
    if(d.type === "slash") { effects.push({ type:"slash", x:d.x, y:d.y, angle:d.angle, life:10 }); playSfx("atk"); }
    else if (d.type === "spin") { effects.push({ type:"spin", x:d.x, y:d.y, life:15 }); playSfx("atk"); }
    else if (d.type === "nova") effects.push({ type:"nova", x:d.x, y:d.y, life:20 });
    else if (d.type === "dash") playSfx("dash");
    else if (d.type === "gold_txt") texts.push({ val:d.val, x:d.x, y:d.y, color:"#fb0", life:30, vy:-0.8 });
    else if (d.type === "hit") playSfx("hit");
    else if (d.type === "gold") playSfx("gold");
});
socket.on("chat", d => {
    const p = state.pl[d.id];
    if(p) { p.chatMsg = d.msg; p.chatTimer = 180; playSfx("chat"); }
});
socket.on("open_shop", items => { shopItems = items; uiState.shop = true; updateUI(); });

// --- INPUT HANDLERS (PC) ---
const keys = { w:false, a:false, s:false, d:false, q:false };
function sendInput() {
    let dx = keys.a?-1:keys.d?1:0, dy = keys.w?-1:keys.s?1:0;
    if(dx!==inputState.x || dy!==inputState.y || keys.q !== inputState.block){ inputState={x:dx,y:dy,block:keys.q}; socket.emit("input", inputState); }
}
function getAngle() { return Math.atan2((mouse.y - canvas.height/2), (mouse.x - canvas.width/2)); }
// Nova função para obter ângulo baseado no movimento (para mobile)
function getMovementAngle() {
    const dx = keys.d - keys.a;
    const dy = keys.s - keys.w;
    if (dx === 0 && dy === 0) {
        return me ? Math.atan2(me.vy || 0, me.vx || 1) : 0;
    }
    return Math.atan2(dy, dx);
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
        uiState.chat = true;
        document.getElementById("chat-container").style.display = "block";
        setTimeout(()=>chatInput.focus(), 10);
        return;
    }
    if(keys.hasOwnProperty(k)){ keys[k]=true; sendInput(); }
    if(k==="i") uiState.inv = !uiState.inv; 
    if(k==="c") uiState.char = !uiState.char; 
    if(k==="k") uiState.craft = !uiState.craft;
    if(k==="escape") { uiState.inv=false; uiState.char=false; uiState.shop=false; uiState.craft=false; uiState.chat=false; document.getElementById("chat-container").style.display="none"; }
    if(k===" ") { socket.emit("dash", getAngle()); }
    if(k==="q") { socket.emit("potion"); }
    updateUI();
};
window.onkeyup = e => { let k=e.key.toLowerCase(); if(keys.hasOwnProperty(k)){ keys[k]=false; sendInput(); } };
window.onmousemove = e => { mouse.x=e.clientX; mouse.y=e.clientY; tooltip.style.left = (mouse.x+10)+"px"; tooltip.style.top = (mouse.y+10)+"px"; };
window.onmousedown = e => {
    // Ação do mouse/clique para garantir que o AudioContext comece
    if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume().catch(err => console.error("Could not resume AudioContext on mousedown", err));
    AudioCtrl.init();
    
    if(!me || uiState.chat || isMobile || document.getElementById("menu").style.display !== "none") return;
    const isPanel = (id) => { const r = document.getElementById(id).getBoundingClientRect(); return mouse.x > r.left && mouse.x < r.right && mouse.y > r.top && mouse.y < r.bottom && document.getElementById(id).style.display==="block"; };
    if(isPanel("inventory") || isPanel("char-panel") || isPanel("shop-panel") || isPanel("craft-panel")) return;
    const ang = getAngle();
    if(e.button===0) socket.emit("attack", ang);
    if(e.button===2) socket.emit("skill", {idx:1, angle:ang});
};


// --- INPUT HANDLERS (MOBILE) ---
let touchMap = {};

const handleTouchStart = (e) => {
    // Tenta iniciar o áudio no toque
    if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume().catch(err => console.error("Could not resume AudioContext on touch", err));
    AudioCtrl.init();

    if (uiState.chat || document.getElementById("menu").style.display !== "none") return;

    for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        const target = touch.target;
        const id = touch.identifier;
        let processed = false;

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
        
        // 2. Action Buttons: Usa getMovementAngle()
        else if (target.closest('.action-btn')) {
            const action = target.closest('.action-btn').dataset.action;
            const ang = getMovementAngle(); // Mira na direção do movimento

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
        
        // 3. Menus de HUD (Abrir/Fechar)
        // **LÓGICA DE BOTÕES DE MENU DEDICADOS**
        else if (target.closest('#btn-inv-mobile')) {
            uiState.inv = !uiState.inv;
            uiState.char = false; // Fecha o outro painel
            updateUI();
            processed = true;
        }
        else if (target.closest('#btn-char-mobile')) {
            uiState.char = !uiState.char;
            uiState.inv = false; // Fecha o outro painel
            updateUI();
            processed = true;
        }
        // Lógica de fallback para o ícone "☰" desenhado no canvas
        else if (isMobile) {
            const rect = canvas.getBoundingClientRect();
            // Área de toque aproximada do botão de menu (canto superior direito do HUD Mobile)
            if (touch.clientX > rect.width - 50 && touch.clientY < 30) { 
                 uiState.inv = !uiState.inv; // Assume INV como padrão do '☰'
                 updateUI();
                 processed = true;
            }
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

// --- UI AND DRAWING FUNCTIONS ---

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
    
    // Atualização de Barras (PC DOM UI) - Melhorada na V20
    if (!isMobile) {
        const hpPct = (me.hp/me.stats.maxHp)*100;
        const mpPct = (me.mp/me.stats.maxMp)*100;
        const xpPct = (me.xp/(me.level*100))*100;

        document.getElementById("hp-bar").style.width = hpPct + "%";
        document.getElementById("mp-bar").style.width = mpPct + "%";
        document.getElementById("xp-bar").style.width = xpPct + "%";
        
        document.getElementById("hp-txt").innerText = `HP: ${Math.floor(me.hp)}/${me.stats.maxHp}`;
        document.getElementById("mp-txt").innerText = `MP: ${Math.floor(me.mp)}/${me.stats.maxMp}`;
        document.getElementById("xp-txt").innerText = `${Math.floor(xpPct)}%`;

        let diffName = state.theme === "#f00" ? "HORDE I" : state.theme === "#900" ? "HORDE II" : state.theme === "#102" ? "HELL" : state.theme === "#311" ? "NIGHTMARE" : "NORMAL";
        document.getElementById("lvl-txt").innerText = `${diffName} [${me.level}]`;
    }

    // Atualização de Status e Inventário (Comum)
    document.getElementById("cp-pts").innerText = me.pts;
    document.getElementById("val-str").innerText = me.attrs.str;
    document.getElementById("val-dex").innerText = me.attrs.dex;
    document.getElementById("val-int").innerText = me.attrs.int;
    document.getElementById("stat-dmg").innerText = me.stats.dmg;
    document.getElementById("stat-spd").innerText = Math.floor(me.stats.spd*100);
    document.getElementById("hud-gold").innerText = "GOLD: " + me.gold;

    document.getElementById("inventory").style.display = uiState.inv ? "block" : "none";
    document.getElementById("char-panel").style.display = uiState.char ? "block" : "none";
    document.getElementById("shop-panel").style.display = uiState.shop ? "block" : "none";
    document.getElementById("craft-panel").style.display = uiState.craft ? "block" : "none";

    ["head","body","hand","potion"].forEach(slot => {
        const el = document.getElementById("eq-"+slot); el.innerHTML = "";
        if(me.equipment[slot]) {
            const it = me.equipment[slot];
            el.style.borderColor = it.color; el.innerHTML = getIcon(it.key);
            el.style.boxShadow = it.rarity === "legendary" ? "0 0 5px #f0f" : "none";
            el.onmouseover = () => showTooltip(it); el.onmouseout = hideTooltip;
            el.onclick = () => socket.emit("unequip", slot);
        } else { el.style.borderColor = "#0f0"; el.style.boxShadow = "none"; el.onclick=null; }
    });

    const ig = document.getElementById("inv-grid"); ig.innerHTML = "";
    me.inventory.forEach((it, idx) => {
        const d = document.createElement("div"); d.className = "slot"; d.style.borderColor = it.color;
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
        d.draggable = true;
        d.ondragstart = (e) => { dragItem = { idx, item: it }; };
        d.ondragover = (e) => e.preventDefault();
        d.ondrop = (e) => { e.preventDefault(); if(dragItem && dragItem.item.type === "gem" && it.type !== "gem") socket.emit("craft", {action:"socket", itemIdx:idx, gemIdx:dragItem.idx}); };
        d.onmouseover = () => showTooltip(it); d.onmouseout = hideTooltip;
        d.oncontextmenu = (e) => { e.preventDefault(); if(it.slot) socket.emit("equip", idx); else socket.emit("drop", idx); };
        ig.appendChild(d);
    });

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
    return "📦";
}

function showTooltip(it) {
    let html = `<b style="color:${it.color}">${it.name}</b><br><span style="color:#aaa">${it.type.toUpperCase()}</span>`;
    if(it.price) html += `<br>Price: ${it.price}G`;
    if(it.stats) { for(let k in it.stats) html += `<br>${k.toUpperCase()}: ${it.stats[k]}`; }
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

function draw() {
    requestAnimationFrame(draw);
    ctx.fillStyle = "#000"; ctx.fillRect(0,0,canvas.width,canvas.height);
    if(!me) return;

    cam.x += (me.x*SCALE - canvas.width/2 - cam.x)*0.2; cam.y += (me.y*SCALE - canvas.height/2 - cam.y)*0.2;
    const ox = -cam.x, oy = -cam.y;
    const now = Date.now();

    // MAP
    const map = state.map; const theme = state.theme || "#222";
    if(map.length){
        const sy=Math.floor(cam.y/SCALE), ey=sy+Math.ceil(canvas.height/SCALE)+1;
        const sx=Math.floor(cam.x/SCALE), ex=sx+Math.ceil(canvas.width/SCALE)+1;
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
        if(p.type === "arrow") { ctx.shadowColor="#ff0"; ctx.fillStyle = "#ff0"; ctx.fillRect(-6, -1, 12, 2); } 
        else if (p.type === "meteor") { ctx.shadowColor="#f00"; ctx.fillStyle = "#f00"; ctx.beginPath(); ctx.arc(0,0, 6, 0, Math.PI*2); ctx.fill(); } 
        else if (p.type === "web") { ctx.shadowColor="#fff"; ctx.strokeStyle="#fff"; ctx.beginPath(); ctx.moveTo(-4,-4); ctx.lineTo(4,4); ctx.moveTo(4,-4); ctx.lineTo(-4,4); ctx.stroke(); }
        else if (p.type === "laser") { ctx.shadowColor="#f0f"; ctx.fillStyle="#f0f"; ctx.fillRect(-10, -2, 20, 4); }
        else if (p.type === "frostball") { ctx.shadowColor="#0ff"; ctx.fillStyle="#0ff"; ctx.beginPath(); ctx.arc(0,0,5,0,Math.PI*2); ctx.fill(); }
        else { ctx.shadowColor="#0ff"; ctx.fillStyle = "#0ff"; ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI*2); ctx.fill(); }
        ctx.shadowBlur=0; ctx.restore();
    });

    // EFFECTS
    for(let i=effects.length-1; i>=0; i--) {
        let e = effects[i]; e.life--; if(e.life<=0) { effects.splice(i,1); continue; }
        const x = ox + e.x*SCALE, y = oy + e.y*SCALE; ctx.shadowBlur=10; ctx.shadowColor="#fff";
        if(e.type==="slash") { ctx.strokeStyle=`rgba(255,255,255,${e.life/10})`; ctx.lineWidth=3; ctx.beginPath(); ctx.arc(x,y,20,e.angle-0.8,e.angle+0.8); ctx.stroke(); } 
        else if(e.type==="nova") { ctx.strokeStyle=`rgba(255,0,0,${e.life/20})`; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(x,y,30-e.life,0,6.28); ctx.stroke(); }
        else if(e.type==="alert") { ctx.fillStyle="#f00"; ctx.font="bold 16px Courier New"; ctx.textAlign="center"; ctx.fillText("!", x, y-20); }
        ctx.shadowBlur=0;
    }

    // ENTITIES
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
        if(e.id === myId) dirX = (isMobile && (keys.a || keys.d || keys.w || keys.s)) ? (keys.d||keys.w)?1:-1 : ((mouse.x > canvas.width/2) ? 1 : -1); // Força a direção de movimento no mobile
        ctx.scale(dirX, 1);

        // --- ART ---
        if(e.ai==="resource") { 
            if(e.drop==="wood") { ctx.fillStyle="#420"; ctx.fillRect(-3,-2,6,8); ctx.fillStyle="#141"; ctx.beginPath(); ctx.moveTo(0,-12); ctx.lineTo(-8,-2); ctx.lineTo(8,-2); ctx.fill(); }
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

    for(let i=texts.length-1; i>=0; i--){ let t=texts[i]; t.y+=t.vy; t.life--; ctx.fillStyle=t.color; ctx.font="10px Courier New"; ctx.fillText(t.val, ox+t.x*SCALE, oy+t.y*SCALE); if(t.life<=0) texts.splice(i,1); }

    // RENDERIZAÇÃO DE HUD MOBILE (dentro do canvas, no topo)
    if (isMobile && me) {
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

        // Inventory/Stats Button (Área de clique foi ajustada no handleTouchStart)
        ctx.fillStyle = "#0f0"; ctx.font = "bold 18px Courier New"; ctx.textAlign = "right";
        ctx.fillText("☰", canvas.width - 10, 20);
    }
}

window.login = () => { 
    // Tenta resumir o contexto de áudio se for no mobile e o login for bem-sucedido
    if (AudioCtrl.ctx.state === 'suspended') AudioCtrl.ctx.resume().catch(err => console.error("Could not resume AudioContext after login click", err));
    AudioCtrl.init(); 
    socket.emit("login", document.getElementById("username").value); 
};
window.create = () => socket.emit("create_char", {name:document.getElementById("cname").value, cls:document.getElementById("cclass").value});
window.addStat = (s) => socket.emit("add_stat", s);
window.buy = (idx) => socket.emit("buy", shopItems[idx]);

draw();