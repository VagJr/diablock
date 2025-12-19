const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");
const { Pool } = require("pg");

// ===================================
// 0. CONFIGURAÇÃO DE GM (ADMIN)
// ===================================
const GM_USERS = ["admin", "dev", "god", "creator"];

// ===================================
// 1. DATABASE CONFIGURATION
// ===================================
let DB_MODE = process.env.DATABASE_URL ? "POSTGRES" : "NONE";
let pgPool = null;
let isDbReady = false;

async function initializeServer() {
    if (DB_MODE === 'POSTGRES') {
        try {
            pgPool = new Pool({
                connectionString: process.env.DATABASE_URL,
                ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
            });
            if (process.env.WIPE_DB === "true") await pgPool.query("DROP TABLE IF EXISTS characters;");
            await pgPool.query(`
                CREATE TABLE IF NOT EXISTS characters (
                    id TEXT PRIMARY KEY, user_name TEXT NOT NULL, char_name TEXT NOT NULL,
                    data JSONB NOT NULL, updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            `);
            isDbReady = true;
            console.log("PostgreSQL connected. Persistence ENABLED.");
        } catch (err) {
            console.error("FATAL ERROR: PostgreSQL connection failed.", err.message);
            DB_MODE = 'NONE';
        }
    }
    server.listen(3000, () => { console.log("Server running on port 3000"); });
}

// ===================================
// 2. FUNÇÕES DE PERSISTÊNCIA
// ===================================
let localCharacters = {};

async function loadUserChars(user) {
    if (DB_MODE === 'NONE' || !isDbReady) return localCharacters[user] || {};
    try {
        const r = await pgPool.query("SELECT char_name, data->>'level' AS level FROM characters WHERE user_name=$1", [user]);
        const chars = {}; r.rows.forEach(c => chars[c.char_name] = { level: Number(c.level) });
        return chars;
    } catch (error) { return {}; }
}

async function createChar(user, name, cls) {
    const newCharData = { 
        class: cls, level: 0, xp: 0, pts: 0, gold: 100, 
        attrs: { str: 5, dex: 5, int: 5 }, hp: 100, mp: 50, 
        inventory: [], equipment: {}, explored: [] 
    };
    if (DB_MODE === 'NONE' || !isDbReady) {
        if (!localCharacters[user]) localCharacters[user] = {};
        if (localCharacters[user][name]) return false; 
        localCharacters[user][name] = newCharData;
        return true; 
    }
    const id = `${user}:${name}`;
    try {
        await pgPool.query(`INSERT INTO characters (id, user_name, char_name, data) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [id, user, name, newCharData]);
        return true;
    } catch (error) { return false; }
}

async function loadCharData(user, name) {
    if (DB_MODE === 'NONE' || !isDbReady) return localCharacters[user]?.[name] || null;
    const id = `${user}:${name}`;
    try {
        const r = await pgPool.query("SELECT data FROM characters WHERE id=$1", [id]);
        return r.rows[0]?.data || null;
    } catch (error) { return null; }
}

async function saveCharData(user, name, data) {
    const savableData = { ...data };
    delete savableData.x; delete savableData.y; delete savableData.vx; delete savableData.vy; 
    delete savableData.input; delete savableData.cd; delete savableData.id;
    delete savableData.user; delete savableData.charName; delete savableData.chatMsg; delete savableData.chatTimer;
    delete savableData.instId; delete savableData.buffs; delete savableData.dashTime; delete savableData.god; 
    if (DB_MODE === 'NONE' || !isDbReady) {
        if(localCharacters[user]) localCharacters[user][name] = savableData;
        return;
    }
    const id = `${user}:${name}`;
    try {
        await pgPool.query(`INSERT INTO characters (id, user_name, char_name, data) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET data=$4, updated_at=NOW()`, [id, user, name, savableData]);
    } catch (error) { console.error(`Error saving char:`, error); }
}

// ===================================
// 3. INFRAESTRUTURA E CONSTANTES
// ===================================
const server = http.createServer((req, res) => {
  const safeUrl = decodeURI(req.url === "/" ? "/index.html" : req.url);
  const p = path.join(__dirname, safeUrl);
  if(fs.existsSync(p) && fs.statSync(p).isFile()) {
      let contentType = "text/html";
      if(safeUrl.endsWith(".js")) contentType = "application/javascript";
      else if(safeUrl.endsWith(".css")) contentType = "text/css";
      else if(safeUrl.endsWith(".mp3")) contentType = "audio/mpeg"; 
      res.writeHead(200, {"Content-Type": contentType});
      fs.createReadStream(p).pipe(res);
  } else { res.writeHead(404); res.end("404 Not Found"); }
});
const io = new Server(server, { transports: ['websocket'], pingInterval: 10000, pingTimeout: 5000 });

const SIZE = 120;
const TILE_FLOOR=0, TILE_WALL=1;
const TICK = 50; 
const SCALE = 16; 
const instances = {}; 

const PREFIXES = ["Ancient", "Sharp", "Heavy", "Fast", "Brutal", "Glowing", "Cursed", "Holy", "Dark", "Light"];
const SUFFIXES = ["of Doom", "of Light", "of Speed", "of Power", "of the Bear", "of the Eagle", "of Hell", "of Heaven"];
const LORE_TEXTS = ["The shadows whisper...", "Beware the Butcher...", "Tiamat sleeps below...", "Only the brave survive.", "Darkness rises."];

function generateRandomName(baseName, rarity) {
    if (rarity === "common") return baseName;
    let name = baseName;
    if (Math.random() < 0.5 || rarity === "legendary") name = `${PREFIXES[Math.floor(Math.random() * PREFIXES.length)]} ${name}`;
    if (rarity === "rare" || rarity === "legendary") if (Math.random() < 0.7) name = `${name} ${SUFFIXES[Math.floor(Math.random() * SUFFIXES.length)]}`;
    return name;
}

const DIFFICULTY = {
    CITY:      { name: "SAFE ZONE", mult: 0.0,  drop: 0.0, color: "#444" },
    NORMAL:    { name: "NORMAL",    mult: 0.8,  drop: 1.0, color: "#222" },
    NIGHTMARE: { name: "NIGHTMARE", mult: 1.8,  drop: 1.8, color: "#311" },
    HELL:      { name: "HELL",      mult: 3.5,  drop: 3.0, color: "#102" }, 
    HORDE_1:   { name: "HORDE I",   mult: 5.0,  drop: 4.0, color: "#f00" }, 
    HORDE_2:   { name: "HORDE II",  mult: 7.0,  drop: 5.5, color: "#900" },
    PRIMORDIAL:{ name: "PRIMORDIAL",mult: 12.0, drop: 10.0,color: "#000" } // NEW TIER
};

function getDifficulty(lvl) {
    if(lvl === 0) return DIFFICULTY.CITY;
    if(lvl >= 30) return DIFFICULTY.PRIMORDIAL; // TIAMAT ZONE
    if(lvl >= 15) return DIFFICULTY.HORDE_2; 
    if(lvl >= 12) return DIFFICULTY.HORDE_1; 
    if(lvl >= 9) return DIFFICULTY.HELL;      
    if(lvl >= 5) return DIFFICULTY.NIGHTMARE;
    return DIFFICULTY.NORMAL;
}

const ITEM_BASES = {
  sword: { slot: "hand", name: "Sword", dmg: 6, type: "melee", cd: 10, price:50 },
  axe:   { slot: "hand", name: "Axe", dmg: 10, spd: -0.03, type: "melee", cd: 16, price:60 },
  dagger:{ slot: "hand", name: "Dagger", dmg: 4, spd: 0.02, type: "melee", cd: 6, price:40 },
  bow:   { slot: "hand", name: "Bow", dmg: 5, type: "ranged", proj: "arrow", cd: 12, price:70 },
  staff: { slot: "hand", name: "Staff", dmg: 12, mp: 15, type: "magic", proj: "fireball", cd: 20, price:80 },
  helm:  { slot: "head", name: "Helm", hp: 20, def: 1, price:40 },
  armor: { slot: "body", name: "Armor", hp: 40, def: 3, price:100 },
  runa_dano: { slot: "rune", name: "Rune of Might", dmg: 5, type: "passive", price: 150, color:"#f0f" },
  runa_crit: { slot: "rune", name: "Rune of Fortune", crit: 0.02, type: "passive", price: 150, color:"#0ff" },
  potion:{ slot: "potion",name: "Hp Pot", heal: 50, type: "consumable", price:20 },
  key:   { slot: "inv",   name: "Dungeon Key", type: "key", price: 100, color: "#ffd700", desc: "Opens doors" },
  wood:  { slot: "mat", name: "Wood", type: "material", price: 5 },
  stone: { slot: "mat", name: "Stone", type: "material", price: 8 },
  ruby:  { slot: "mat", name: "Ruby", type: "gem", price: 100, color: "#f00", stat: "dmg", val: 3, desc: "+3 Dmg" },
  sapphire:{ slot: "mat", name: "Sapphire", type: "gem", price: 100, color: "#00f", stat: "mp",  val: 10,desc: "+10 Mana" },
  emerald:{ slot: "mat", name: "Emerald", type: "gem", price: 100, color: "#0f0", stat: "spd", val: 0.01, desc: "+Speed" },
  diamond:{ slot: "mat", name: "Diamond", type: "gem", price: 100, color: "#fff", stat: "hp",  val: 15, desc: "+15 HP" },
  topaz: { slot: "mat", name: "Topaz", type: "gem", price: 200, color: "#fb0", stat: "dmg_mp", val: 0.05, desc: "+5% Dmg/Mana" },
  amethyst: { slot: "mat", name: "Amethyst", type: "gem", price: 200, color: "#a0f", stat: "cd_red", val: 0.05, desc: "5% CD Red." }
};

const RECIPES = [
    { res: "potion", req: { wood: 2, stone: 0 } }, { res: "key", req: { wood: 10, stone: 5 } }, 
    { res: "ruby", req: { wood: 5, stone: 5 } }, { res: "sapphire", req: { wood: 5, stone: 5 } },
    { res: "emerald", req: { wood: 5, stone: 5 } }, { res: "diamond", req: { wood: 10, stone: 10 } },
    { res: "topaz", req: { wood: 15, stone: 15 } }, { res: "amethyst", req: { wood: 15, stone: 15 } }
];

const MOB_DATA = {
    tree:     { hp: 20, dmg: 0, spd: 0, ai: "resource", drop: "wood", xp: 5, size: 14, color: "#252", poise: 999 },
    rock:     { hp: 30, dmg: 0, spd: 0, ai: "resource", drop: "stone",xp: 5, size: 14, color: "#555", poise: 999 },
    chest:    { hp: 5,  dmg: 0, spd: 0, ai: "static",   xp: 0,  gold: 100,size: 12, loot: true },
    rat:      { hp: 8,  dmg: 3, spd: 0.08, ai: "chase", xp: 5,  gold: 2,  size: 8,  poise: 0 },
    bat:      { hp: 6,  dmg: 4, spd: 0.10, ai: "chase", xp: 6,  gold: 3,  size: 6,  poise: 0 },
    slime:    { hp: 15, dmg: 4, spd: 0.04, ai: "chase", xp: 8,  gold: 5,  size: 10, poise: 1 },
    goblin:   { hp: 25, dmg: 6, spd: 0.12, ai: "lunge", xp: 12, gold: 8, size: 10, poise: 2 },
    skeleton: { hp: 40, dmg: 8, spd: 0.05, ai: "lunge", xp: 18, gold: 12, size: 12, poise: 5 },
    archer:   { hp: 30, dmg: 7, spd: 0.06, ai: "range", xp: 20, gold: 15, size: 12, range: 7, proj:"arrow", poise: 3 },
    orc:      { hp: 90, dmg: 15,spd: 0.06, ai: "lunge", xp: 45, gold: 30, size: 16, poise: 20 },
    mage:     { hp: 50, dmg: 18,spd: 0.05, ai: "range", xp: 50, gold: 40, size: 12, range: 6, proj:"fireball", poise: 5 },
    ghost:    { hp: 60, dmg: 12,spd: 0.07, ai: "chase", xp: 60, gold: 35, size: 11, poise: 1 },
    demon:    { hp: 150,dmg: 25,spd: 0.09, ai: "lunge", xp: 120,gold: 80, size: 15, poise: 25 },
    imp:      { hp: 80, dmg: 20, spd: 0.15, ai: "chase", xp: 80, gold: 50, size: 8, poise: 0, color: "#f80" }, 
    succubus: { hp: 120, dmg: 30, spd: 0.07, ai: "range", xp: 150, gold: 75, size: 12, range: 8, proj: "laser", poise: 5, color: "#f0f" },
    hellknight: { hp: 250, dmg: 40, spd: 0.08, ai: "lunge", xp: 200, gold: 100, size: 16, poise: 30, color: "#900" },
    butcher:    { hp: 500, dmg: 30, spd: 0.07, ai: "boss_butcher", xp: 800, gold: 200, size: 28, poise: 99, boss:true, name:"The Butcher", color: "#a00" },
    lich:       { hp: 450, dmg: 40, spd: 0.04, ai: "boss_lich", xp: 900, gold: 250, size: 24, poise: 99, boss:true, proj:"frostball", name:"Lich King", color: "#0aa" },
    broodmother:{ hp: 400, dmg: 25, spd: 0.09, ai: "boss_brood", xp: 850, gold: 220, size: 32, poise: 99, boss:true, proj:"web", name:"Broodmother", color: "#484" },
    firelord:   { hp: 600, dmg: 50, spd: 0.05, ai: "boss_fire", xp: 1200,gold: 400, size: 36, poise: 99, boss:true, proj:"meteor", name:"Fire Lord", color: "#f50" },
    voidgazer:  { hp: 550, dmg: 60, spd: 0.06, ai: "boss_void", xp: 1500,gold: 500, size: 26, poise: 99, boss:true, proj:"laser", name:"Void Gazer", color: "#909" },
    diablo:     { hp: 1500, dmg: 80, spd: 0.10, ai: "boss_diablo", xp: 5000, gold: 1000, size: 40, poise: 99, boss:true, proj: "fireball", name: "DIABLO", color: "#f00" },
    tiamat:     { hp: 50000, dmg: 500, spd: 0.12, ai: "boss_tiamat", xp: 50000, gold: 10000, size: 240, poise: 9999, boss:true, proj: "fireball", name: "OVERLORD TIAMAT", color: "#000" },
    merchant: { hp: 999,dmg: 0, spd: 0, ai: "npc", xp: 0, gold: 0, size: 12, npc: true, name: "Merchant" },
    healer:   { hp: 999,dmg: 0, spd: 0, ai: "npc", xp: 0, gold: 0, size: 12, npc: true, name: "Healer" },
    blacksmith:{ hp: 999,dmg: 0, spd: 0, ai: "npc", xp: 0, gold: 0, size: 12, npc: true, name: "Blacksmith" }
};

function generateItem(level, diffMult=1, forceType=null) {
    if(forceType) {
        const base = ITEM_BASES[forceType];
        if (base.type === "material" || base.type === "consumable" || base.type === "key") {
             return { ...base, id: Math.random().toString(36).substr(2), key:forceType, rarity:"common", color:base.color||"#aaa", stats: base.stats || {} };
        }
        return { id: Math.random().toString(36).substr(2), key:forceType, rarity:"common", color:"#aaa", slot: base.slot, type: base.type, name: base.name, price: base.price, stats:{}, sockets:[], gems:[] };
    }
    if (Math.random() < 0.03 * diffMult) return { ...ITEM_BASES.key, id: Math.random().toString(36).substr(2), key:"key", rarity:"rare", color:"#ffd700" };
    if(Math.random() < 0.20) return { ...ITEM_BASES.potion, id: Math.random().toString(36).substr(2), key:"potion", rarity:"common", color:"#f33", stats:{heal:50+level*10} };
    
    let gemDropChance = 0.05 * diffMult;
    if(Math.random() < gemDropChance) {
        const gemKeys = ["ruby", "sapphire", "emerald", "diamond", "topaz", "amethyst"];
        const k = gemKeys[Math.floor(Math.random()*gemKeys.length)];
        return { ...ITEM_BASES[k], id:Math.random().toString(36).substr(2), key:k, rarity:"magic", color:ITEM_BASES[k].color };
    }
    
    const keys = Object.keys(ITEM_BASES).filter(k=>!["potion","wood","stone","runa_dano","runa_crit","ruby","sapphire","emerald","diamond","topaz","amethyst","key"].includes(k));
    const key = keys[Math.floor(Math.random()*keys.length)];
    const base = ITEM_BASES[key];
    let r = Math.random(), rarity;
    if (level <= 3) rarity = r > 0.95 * diffMult ? "magic" : "common";
    else rarity = r > 0.97?"legendary":r>0.85?"rare":r>0.6?"magic":"common";
    const meta = { common: {c:"#aaa", m:1, s:0}, magic: {c:"#4ff", m:1.3, s:1}, rare: {c:"#ff0", m:1.8, s:1}, legendary:{c:"#f0f", m:3.0, s:2} };
    const power = (level * meta[rarity].m) * diffMult;
    const itemName = generateRandomName(base.name, rarity);
    const item = { id: Math.random().toString(36).substr(2), key, rarity, color: meta[rarity].c, slot: base.slot, type: base.type, proj: base.proj, cd: base.cd, name: itemName, price: Math.floor(base.price * meta[rarity].m), stats: {}, sockets: [], gems: [] };
    const maxSockets = meta[rarity].s;
    if(Math.random() < 0.5 || maxSockets > 0) { for(let i=0; i<maxSockets; i++) item.sockets.push(null); }
    if(base.dmg) { const dmgMod = 0.5 + Math.random() * 0.5; item.stats.dmg = Math.floor(base.dmg + power * dmgMod); }
    if(base.hp) { const hpMod = 0.8 + Math.random() * 0.4; item.stats.hp = Math.floor(base.hp + power * 3 * hpMod); }
    if(base.def) { const defMod = 0.7 + Math.random() * 0.6; item.stats.def = Math.floor(base.def + power * defMod); }
    if(base.mp) { const mpMod = 0.8 + Math.random() * 0.4; item.stats.mp = Math.floor(base.mp + power * 2 * mpMod); }
    
    if (rarity === "rare" || rarity === "legendary") {
        const secondaryStats = ["crit", "cd_red", "spd"];
        const secondaryStat = secondaryStats[Math.floor(Math.random() * secondaryStats.length)];
        const secondaryPower = power * 0.005; 
        if (secondaryStat === "crit") item.stats.crit = (item.stats.crit || 0) + 0.01 + Math.random() * secondaryPower;
        else if (secondaryStat === "cd_red") item.stats.cd_red = (item.stats.cd_red || 0) + 0.01 + Math.random() * secondaryPower;
        else if (secondaryStat === "spd") item.stats.spd = (item.stats.spd || 0) + 0.005 + Math.random() * secondaryPower;
    }
    return item;
}

function recalcStats(p) {
    if(!p.attrs) p.attrs = { str:5, dex:5, int:5 };
    if(!p.buffs) p.buffs = {}; 
    let str=p.attrs.str, dex=p.attrs.dex, int=p.attrs.int;
    if(p.buffs.dmg) str += 10; if(p.buffs.spd) dex += 10;
    
    let addHp=0, addMp=0, addDmg=0, addDef=0, addSpd=0, critChance=0.01 + (dex * 0.002), cdRed=0;
    let baseLightRadius = p.level === 0 ? 30 : 22; 
    ["hand", "head", "body", "rune"].forEach(s => { 
        if(p.equipment[s]){ 
            const it = p.equipment[s];
            addHp+=it.stats?.hp||0; addMp+=it.stats?.mp||0; addDmg+=it.stats?.dmg||0; addDef+=it.stats?.def||0;
            critChance+=it.stats?.crit||0; cdRed+=it.stats?.cd_red||0; addSpd+=it.stats?.spd||0;
            if(it.gems) it.gems.forEach(g => {
                if(g.stat === "dmg") addDmg += g.val; if(g.stat === "hp") addHp += g.val; if(g.stat === "mp") addMp += g.val;
                if(g.stat === "spd") addSpd += g.val; if(g.stat === "cd_red") cdRed = Math.min(0.3, cdRed + g.val); 
                if(g.stat === "dmg_mp") addDmg += Math.floor(p.stats.maxMp * g.val); 
            });
        }
    });
    baseLightRadius += (p.level * 0.5) + (int * 0.2); 
    p.stats.maxHp = 90 + (str*8) + addHp + (p.level*10);
    p.stats.maxMp = 30 + (int*5) + addMp + (p.level*4);
    p.stats.spd = 0.11 + (dex*0.001) + addSpd;
    p.stats.def = addDef;
    p.stats.crit = Math.min(0.5, critChance); 
    p.stats.lightRadius = Math.ceil(baseLightRadius); 
    const wep = p.equipment.hand;
    let baseDmg = addDmg;
    if(wep) { if(wep.type === "melee") baseDmg += str * 0.6; if(wep.type === "ranged") baseDmg += dex * 0.6; if(wep.type === "magic") baseDmg += int * 0.6; } 
    else { baseDmg += str * 0.3; }
    if (p.buffs.dmg) baseDmg *= 1.5; if (p.buffs.spd) p.stats.spd *= 1.5; 
    p.stats.dmg = Math.floor(baseDmg); p.stats.cd_mult = (1 - cdRed); 
    if(p.hp > p.stats.maxHp) p.hp = p.stats.maxHp;
}

const rnd = (val) => Math.round(val * 100) / 100;

function sendPlayerUpdate(p, mobsSimple, playersSimple) {
    if (!p || !p.id || !p.instId || !instances[p.instId]) return;
    const inst = instances[p.instId];
    let hint = null; const stairs = inst.props.find(pr => pr.type === "stairs");
    if (stairs) {
        if (!stairs.locked) { hint = { x: rnd(stairs.x), y: rnd(stairs.y), type: "exit" }; } 
        else if (inst.mobCount <= 3 && inst.mobCount > 0) {
            let closest = null, minD = Infinity;
            for(let k in inst.mobs) { const m = inst.mobs[k]; if(m.npc || m.ai === "resource") continue; const d = (m.x-p.x)**2 + (m.y-p.y)**2; if(d < minD) { minD = d; closest = m; } }
            if(closest) hint = { x: rnd(closest.x), y: rnd(closest.y), type: "enemy" };
        } else if (inst.mobCount === 0) { hint = { x: rnd(stairs.x), y: rnd(stairs.y), type: "exit" }; }
    }
    io.to(p.id).emit("u", { 
        pl: playersSimple, mb: mobsSimple, it: inst.items, 
        pr: inst.projectiles.map(pr => ({...pr, x: rnd(pr.x), y: rnd(pr.y)})), 
        props: inst.props, lvl: inst.level, theme: inst.theme, 
        explored: p.explored, lightRadius: p.stats.lightRadius, hint: hint, mobCount: inst.mobCount
    });
}

function sendLog(instId, msg, color="#0f0") { if (instId.id) io.to(instId.id).emit("log", { msg, color }); else io.to(instId).emit("log", { msg, color }); }

function changeLevel(socket, player, nextLevel) {
    if (!player) return;
    const oldInst = instances[player.instId];
    if (oldInst) { sendLog(oldInst.id, `${player.name} foi para o nível ${nextLevel}.`, "#ff0"); delete oldInst.players[player.id]; }
    const nextInst = getOrCreateInstance(nextLevel);
    socket.leave(player.instId); socket.join(nextInst.id); socket.instId = nextInst.id;
    player.x = nextInst.rooms[0].cx; player.y = nextInst.rooms[0].cy; player.instId = nextInst.id;
    nextInst.players[player.id] = player;
    player.explored = Array.from({length: SIZE}, () => Array(SIZE).fill(0));
    socket.emit("map_data", { map: nextInst.dungeon, theme: nextInst.theme });
    sendLog(nextInst.id, `${player.name} chegou.`, "#ff0");
}

function isGM(player) { return player && GM_USERS.includes(player.user); }

function handleGMCommand(p, raw) {
    if (!isGM(p)) { sendLog(p, "Permission denied", "#f00"); return; }
    const args = raw.split(" "); const cmd = args.shift().toLowerCase();
    const inst = instances[p.instId]; if (!inst) return;
    switch (cmd) {
        case "gm": p.god = !p.god; sendLog(p, `GM MODE (God) ${p.god ? "ON" : "OFF"}`, "#f0f"); break;
        case "tp": {
            const arg1 = args[0]?.toLowerCase(); const GM_DIFFICULTY_MAP = { city:0, normal:1, nightmare:5, hell:9, horde1:12, horde2:15, tiamat:30 };
            let newLevel = Number(arg1); if (isNaN(newLevel) && GM_DIFFICULTY_MAP[arg1] !== undefined) newLevel = GM_DIFFICULTY_MAP[arg1];
            if (!isNaN(newLevel)) { const socket = io.sockets.sockets.get(p.id); if (socket) changeLevel(socket, p, newLevel); sendLog(p, `Teleported to Level ${newLevel}`, "#f0f"); } 
            else if (args.length >= 2) { const x = Number(args[0]), y = Number(args[1]); if (!isNaN(x) && !isNaN(y)) { p.x = x; p.y = y; sendLog(p, `Teleported to ${x}, ${y}`, "#0ff"); } } 
            else sendLog(p, "Usage: /tp <level> OR /tp <x> <y>", "#f00");
            break;
        }
        case "summon": {
            const mobType = args[0]; const qtd = Number(args[1] || 1); 
            if (!MOB_DATA[mobType]) return sendLog(p, "Invalid mob! Use codes from MOB_DATA.", "#f00");
            const diff = getDifficulty(inst.level); 
            for (let i = 0; i < qtd; i++) spawnMob(inst, p.x + (Math.random()*2-1), p.y + (Math.random()*2-1), mobType, diff.mult);
            sendLog(p, `Summoned ${qtd} ${mobType}`, "#f80"); break;
        }
        case "killall": Object.values(inst.mobs).forEach(m => { if (!m.npc) m.hp = 0; }); sendLog(p, "All mobs killed", "#f00"); break;
        case "god": p.god = !p.god; sendLog(p, `God mode ${p.god ? "ON" : "OFF"}`, "#ff0"); break;
        case "level": { const lvl = Number(args[0]); if (!isNaN(lvl)) { p.level = lvl; p.xp = 0; recalcStats(p); p.hp = p.stats.maxHp; sendLog(p, `Level set to ${lvl}`, "#0f0"); } break; }
        case "give": { const key = args[0]; const qtd = Number(args[1] || 1); if (!ITEM_BASES[key]) return sendLog(p, "Invalid item code", "#f00"); for (let i = 0; i < qtd; i++) p.inventory.push(generateItem(p.level, 1, key)); sendLog(p, `Gave ${qtd} ${key}`, "#0ff"); break; }
        case "gold": { const g = Number(args[0]); if (!isNaN(g)) { p.gold += g; sendLog(p, `Gold +${g}`, "#fb0"); } break; }
        default: sendLog(p, `Unknown command: /${cmd}`, "#f00");
    }
}

io.on("connection", socket => {
    let user = null, charName = null;
    socket.on("login", async u => { user=u; const chars = await loadUserChars(user); socket.emit("char_list", chars); });
    socket.on("create_char", async ({name, cls}) => { if(!user) return; await createChar(user, name, cls); const chars = await loadUserChars(user); socket.emit("char_list", chars); });
    socket.on("enter_game", async name => { 
        if(!user || !name) return;
        charName = name; let data = await loadCharData(user, name); 
        if (!data) data = { class: 'knight', level: 0, xp: 0, pts: 0, gold: 100, attrs: { str: 5, dex: 5, int: 5 }, hp: 100, mp: 50, inventory: [], equipment: {} };
        let inst = getOrCreateInstance(0);
        socket.join(inst.id); socket.instId = inst.id;
        if(!data.attrs) data.attrs = { str:5, dex:5, int:5 }; if(!data.explored) data.explored = Array.from({length: SIZE}, () => Array(SIZE).fill(0)); 
        inst.players[socket.id] = { id: socket.id, name, user, charName, ...JSON.parse(JSON.stringify(data)), x: inst.rooms[0].cx, y: inst.rooms[0].cy, vx:0, vy:0, input: {x:0,y:0,block:false}, cd: { atk:0, skill:0, dash:0 }, stats: {}, instId: inst.id, chatMsg: "", chatTimer: 0, buffs: {} };
        const p = inst.players[socket.id]; recalcStats(p); 
        if (p.hp == null) p.hp = p.stats.maxHp; if (p.mp == null) p.mp = p.stats.maxMp; p.hp = Math.min(p.hp, p.stats.maxHp); p.mp = Math.min(p.mp, p.stats.maxMp);
        socket.emit("game_start", {recipes: RECIPES}); socket.emit("map_data", { map: inst.dungeon, theme: inst.theme }); sendLog(inst.id, `${name} entrou na cidade!`, "#0ff");
    });
    socket.on("dungeon_entry_choice", type => {
        const p = instances[socket.instId]?.players[socket.id]; if(!p) return;
        let targetLevel = 1;
        if(type === "coop") { const activeLevels = Object.values(instances).filter(i => i.level > 0 && Object.keys(i.players).length > 0).map(i => i.level); if(activeLevels.length > 0) targetLevel = Math.max(...activeLevels); }
        changeLevel(socket, p, targetLevel);
    });
    socket.on("chat", msg => { const p = instances[socket.instId]?.players[socket.id]; if(!p) return; if (msg.startsWith("/")) { handleGMCommand(p, msg.substring(1)); return; } p.chatMsg = msg; p.chatTimer = 200; io.to(p.instId).emit("chat", {id: socket.id, msg}); });
    socket.on("input", d => { const p = instances[socket.instId]?.players[socket.id]; if(p) { p.input.x=d.x; p.input.y=d.y; p.input.block=d.block; } });
    socket.on("add_stat", s => { const p = instances[socket.instId]?.players[socket.id]; if(p && p.pts>0){ p.attrs[s]++; p.pts--; recalcStats(p); } });
    socket.on("dash", angle => { const p = instances[socket.instId]?.players[socket.id]; if(!p || p.cd.dash > 0 || p.input.block || p.mp < 10) return; const isCity = instances[p.instId].level === 0; if(!isCity) p.mp -= 10; p.cd.dash = Math.floor(30 * (p.stats.cd_mult || 1)); p.vx = Math.cos(angle) * 0.7; p.vy = Math.sin(angle) * 0.7; p.dashTime = 5; io.to(instances[socket.instId].id).emit("fx", { type: "dash", x: p.x, y: p.y }); });
    socket.on("potion", () => { const p = instances[socket.instId]?.players[socket.id]; if(!p) return; let pot = p.equipment.potion; let invIdx = -1; if (!pot) { invIdx = p.inventory.findIndex(i => i.key === "potion"); if (invIdx !== -1) pot = p.inventory[invIdx]; } if(!pot) return; p.hp = Math.min(p.stats.maxHp, p.hp + (pot.stats?.heal || 50)); io.to(instances[socket.instId].id).emit("fx", { type: "nova", x: p.x, y: p.y }); if (p.equipment.potion) p.equipment.potion = null; else if (invIdx !== -1) p.inventory.splice(invIdx, 1); recalcStats(p); });
    socket.on("attack", ang => { const inst = instances[socket.instId]; const p = inst?.players[socket.id]; if(!p || p.cd.atk > 0 || p.input.block) return; let clickedNPC = false; Object.values(inst.mobs).forEach(m => { if(m.npc && Math.hypot(m.x-p.x, m.y-p.y) < 3) { socket.emit("open_shop", m.shop); clickedNPC = true; } }); if(clickedNPC || inst.level === 0) return; const wep = p.equipment.hand; const type = wep ? wep.type : "melee"; p.cd.atk = Math.floor((wep ? wep.cd : 10) * (p.stats.cd_mult || 1)); let damage = p.stats.dmg; let isCrit = Math.random() < p.stats.crit; if (isCrit) damage = Math.floor(damage * 1.5); if(type === "melee") { io.to(inst.id).emit("fx", { type: "slash", x: p.x, y: p.y, angle: ang }); hitArea(inst, p, p.x, p.y, 2.0, ang, 1.5, damage, isCrit ? 35 : 15, isCrit); } else { if(type==="magic" && p.mp < 2) return; if(type==="magic") p.mp -= 2; const spawnX = p.x + Math.cos(ang) * 0.5; const spawnY = p.y + Math.sin(ang) * 0.5; inst.projectiles.push({ x:spawnX, y:spawnY, vx:Math.cos(ang)*0.4, vy:Math.sin(ang)*0.4, life: 60, dmg: damage, owner: p.id, type: wep ? wep.proj : "arrow", angle: ang, isCrit: isCrit }); } });
    socket.on("skill", ({angle}) => { const inst = instances[socket.instId]; const p = inst?.players[socket.id]; if(!p || p.cd.skill > 0 || p.input.block || inst.level === 0) return; const ang = angle || 0; let base_cd = 0; let damage = p.stats.dmg; let isCrit = Math.random() < p.stats.crit; if (isCrit) damage = Math.floor(damage * 1.5); if(p.class === "knight") { if(p.mp < 15) return; p.mp -= 15; base_cd = 60; io.to(inst.id).emit("fx", { type: "spin", x: p.x, y: p.y, life: 20 }); hitArea(inst, p, p.x, p.y, 3.5, null, 0, damage * 2, 40, isCrit); } else if(p.class === "hunter") { if(p.mp < 15) return; p.mp -= 15; base_cd = 50; [-0.3, 0, 0.3].forEach(off => { inst.projectiles.push({ x:p.x, y:p.y, vx:Math.cos(ang+off)*0.5, vy:Math.sin(ang+off)*0.5, life: 35, dmg: damage, owner: p.id, type: "arrow", angle: ang+off, isCrit: isCrit }); }); } else if(p.class === "mage") { if(p.mp < 25) return; p.mp -= 25; base_cd = 80; inst.projectiles.push({ x:p.x, y:p.y, vx:Math.cos(ang)*0.2, vy:Math.sin(ang)*0.2, life: 80, dmg: damage * 3, owner: p.id, type: "meteor", angle: ang, isCrit: isCrit }); } p.cd.skill = Math.floor(base_cd * (p.stats.cd_mult || 1)); });
    socket.on("craft", ({action, recipeIdx, itemIdx, gemIdx}) => { const inst = instances[socket.instId]; const p = inst?.players[socket.id]; if(!p) return; if(action === "create") { const recipe = RECIPES[recipeIdx]; if(!recipe) return; const woodCount = p.inventory.filter(i=>i.key==="wood").length; const stoneCount = p.inventory.filter(i=>i.key==="stone").length; if(woodCount >= recipe.req.wood && stoneCount >= recipe.req.stone && p.inventory.length < 20) { for(let k=0; k<recipe.req.wood; k++) { const i=p.inventory.findIndex(x=>x.key==="wood"); if(i>-1) p.inventory.splice(i,1); } for(let k=0; k<recipe.req.stone; k++) { const i=p.inventory.findIndex(x=>x.key==="stone"); if(i>-1) p.inventory.splice(i,1); } const craftedItem = generateItem(p.level, 1, recipe.res); if(craftedItem.key === "potion") craftedItem.stats = { heal: 50 + p.level * 5 }; p.inventory.push(craftedItem); io.to(inst.id).emit("txt", {x:p.x, y:p.y, val:"CRAFT!", color:"#0f0"}); sendLog(inst.id, `${p.name} craftou ${craftedItem.name}`, "#d0d"); } } else if(action === "socket") { const item = p.inventory[itemIdx]; const gem = p.inventory[gemIdx]; if(item && gem && item.sockets && item.gems.length < item.sockets.length && gem.type === "gem") { item.gems.push(gem); p.inventory.splice(gemIdx, 1); recalcStats(p); io.to(inst.id).emit("txt", {x:p.x, y:p.y, val:"SOCKETED!", color:"#0ff"}); } } });
    socket.on("equip", idx => { const p = instances[socket.instId]?.players[socket.id]; if(!p || !p.inventory[idx]) return; const it = p.inventory[idx]; if(it.key === "potion") { socket.emit("potion"); return; } if(it.type === "material" || it.type === "gem" || it.type === "key") return; const old = p.equipment[it.slot]; p.equipment[it.slot] = it; p.inventory.splice(idx, 1); if(old) p.inventory.push(old); recalcStats(p); });
    socket.on("unequip", slot => { const p = instances[socket.instId]?.players[socket.id]; if(!p) return; if (slot === "potion") { socket.emit("potion"); return; } if(p.equipment[slot] && p.inventory.length < 20) { p.inventory.push(p.equipment[slot]); p.equipment[slot] = null; recalcStats(p); } });
    socket.on("drop", idx => { const inst = instances[socket.instId]; const p = inst?.players[socket.id]; if(p && p.inventory[idx]) { const it = p.inventory[idx]; p.inventory.splice(idx, 1); const iid = "d"+(++inst.itemId); inst.items[iid] = { id:iid, x:p.x, y:p.y, item: it, pickupDelay: Date.now() + 1500 }; } });
    socket.on("buy", idx => { const inst = instances[socket.instId]; const p = inst?.players[socket.id]; if(!p) return; let shopItem; Object.values(inst.mobs).forEach(m => { if(m.npc && m.shop[idx]) shopItem = m.shop[idx]; }); if(p && shopItem && p.gold >= shopItem.price && p.inventory.length < 20) { p.gold -= shopItem.price; const boughtItem = generateItem(inst.level, 1, shopItem.key); boughtItem.price = shopItem.price; p.inventory.push(boughtItem); } });
    socket.on("sell", idx => { const p = instances[socket.instId]?.players[socket.id]; if(!p || !p.inventory[idx]) return; const sellPrice = Math.floor((p.inventory[idx].price || 1) * 0.5); p.gold += sellPrice; p.inventory.splice(idx, 1); io.to(p.instId).emit("txt", {x:p.x, y:p.y, val:`+${sellPrice}G`, color:"#fb0"}); });
    socket.on("enter_checkpoint", level => { const p = instances[socket.instId]?.players[socket.id]; if (!p) return; changeLevel(socket, p, level); });
    socket.on("disconnect", async () => { const inst = instances[socket.instId]; if(!inst) return; const p = inst.players[socket.id]; if(p) { sendLog(inst.id, `${p.name} saiu do mundo.`, "#f00"); await saveCharData(p.user, p.charName, p); delete inst.players[socket.id]; } });
});

function isWall(inst, x, y) { return inst.dungeon[Math.floor(y)]?.[Math.floor(x)] === TILE_WALL; }
function resolveCollisions(inst, e, radius) { if(isWall(inst, e.x + e.vx + (e.vx>0?radius:-radius), e.y)) e.vx = 0; if(isWall(inst, e.x, e.y + e.vy + (e.vy>0?radius:-radius))) e.vy = 0; }

function hitArea(inst, owner, x, y, range, angle, width, dmg, kbForce, isCrit=false) {
    Object.values(inst.mobs).forEach(m => {
        if (m.npc || m.ai === "resource" || m.hp <= 0) return;
        const dx = m.x - x, dy = m.y - y, dist = Math.hypot(dx, dy);
        if(dist > range + (m.size/SCALE/2)) return;
        if(angle !== null && width > 0) { let mobAngle = Math.atan2(dy, dx), diff = Math.abs(mobAngle - angle); if(diff > Math.PI) diff = 2 * Math.PI - diff; if(diff > width) return; }
        damageMob(inst, m, dmg, owner, dx, dy, kbForce, isCrit);
    });
}

function damageMob(inst, m, dmg, owner, kx, ky, kbForce=10, isCrit=false) {
    m.hp -= dmg; m.hitFlash = 5; io.to(inst.id).emit("fx", {type:"hit"});
    if(m.ai === "resource") { if(m.hp <= 0) { delete inst.mobs[m.id]; const iid="r"+(++inst.itemId); inst.items[iid] = { id:iid, x:m.x, y:m.y, item: generateItem(inst.level, 1, m.drop), pickupDelay: Date.now()+500 }; io.to(inst.id).emit("txt", {x:m.x, y:m.y, val:`+${m.drop}`, color:"#fff"}); } return; }
    if (kbForce > m.poise) { const dist = Math.hypot(kx, ky) || 1; const power = Math.max(0.3, (kbForce / 25) + (isCrit ? 0.3 : 0)); m.vx = (kx / dist) * power; m.vy = (ky / dist) * power; m.stun = 6; }
    io.to(inst.id).emit("txt", {x:m.x, y:m.y-1, val:Math.floor(dmg), color: isCrit?"#f0f":"#f33", isCrit});
    if(m.hp <= 0) {
        const players = Object.values(inst.players).filter(p => Math.hypot(p.x - m.x, p.y - m.y) <= 15); const xp = Math.floor(m.xp / (players.length || 1));
        players.forEach(p => { p.xp += xp; io.to(p.id).emit("txt", {x:m.x, y:m.y-2, val:`+${xp} XP`, color:"#ff0"}); if(p.xp >= (p.level+1)*100) { p.level++; p.pts += 2; p.xp = 0; recalcStats(p); p.hp=p.stats.maxHp; io.to(p.id).emit("txt", {x:p.x, y:p.y-2, val:"LEVEL UP!", color:"#fb0"}); } });
        delete inst.mobs[m.id];
        
        // TIAMAT LOOT
        if(m.ai === "boss_tiamat") {
            sendLog(inst.id, "OVERLORD TIAMAT DEFEATED!", "#f00");
            for(let i=0; i<8; i++) { const iid="t"+(++inst.itemId); inst.items[iid] = { id:iid, x:m.x, y:m.y, vx:(Math.random()-0.5)*0.5, vy:(Math.random()-0.5)*0.5, item: generateItem(inst.level, 5), pickupDelay: Date.now() + 1000 }; }
            for(let i=0; i<10; i++) { const iid="g"+(++inst.itemId); inst.items[iid] = { id:iid, x:m.x, y:m.y, vx:(Math.random()-0.5)*0.3, vy:(Math.random()-0.5)*0.3, item: { key:"gold", name:"Gold", color:"#fb0", val: 500 }, pickupDelay: Date.now() + 500 }; }
        } else {
            if(m.gold > 0) { for(let i=0; i<3; i++) { const iid="g"+(++inst.itemId); inst.items[iid] = { id:iid, x:m.x, y:m.y, vx: (Math.random()-0.5)*0.2, vy: (Math.random()-0.5)*0.2, item: { key:"gold", name:"Gold", color:"#fb0", val: Math.ceil(m.gold/3) }, pickupDelay: Date.now() + 500 }; } }
            if(Math.random() < 0.3) { const iid="i"+(++inst.itemId); inst.items[iid] = { id:iid, x:m.x, y:m.y, item: generateItem(inst.level), pickupDelay: Date.now()+1000 }; }
        }
        
        const remainingMobs = Object.keys(inst.mobs).filter(k => !inst.mobs[k].npc && inst.mobs[k].ai !== "resource").length;
        if(remainingMobs === 0) { const stairs = inst.props.find(p => p.type === "stairs"); if(stairs && stairs.locked) { stairs.locked = false; stairs.label = "UNLOCKED (Enter)"; sendLog(inst.id, "A masmorra ficou silenciosa... A porta se abriu!", "#0f0"); io.to(inst.id).emit("txt", {x:stairs.x, y:stairs.y, val:"OPEN!", color:"#0f0", size: "16px bold"}); } }
    }
}

function damagePlayer(p, dmg, sourceX=p.x, sourceY=p.y) {
    if (p.god) return; if (p.hp <= 0) return;
    let finalDmg = Math.max(1, dmg - (p.stats.def||0));
    if(p.input.block && p.mp >= 5) { finalDmg = Math.ceil(finalDmg * 0.3); p.mp -= 5; const dx = p.x-sourceX, dy = p.y-sourceY, dist = Math.hypot(dx,dy)||1; p.vx+=(dx/dist)*0.4; p.vy+=(dy/dist)*0.4; io.to(p.instId).emit("txt", {x:p.x, y:p.y-1, val:"BLOCK", color:"#0ff"}); }
    p.hp -= finalDmg; io.to(p.instId).emit("txt", {x:p.x, y:p.y, val:Math.floor(finalDmg), color:"#f00"});
    if (p.hp <= 0) { const inst = instances[p.instId]; p.gold = Math.floor(p.gold * 0.9); p.x = inst.rooms[0].cx; p.y = inst.rooms[0].cy; p.hp = p.stats.maxHp; p.mp = p.stats.maxMp; sendLog(inst.id, `${p.name} morreu!`, "#f00"); }
}

function processMobAI(inst, m) {
    if (m.stun > 0) { m.stun--; return; }
    if (m.npc || m.ai === "static" || m.ai === "resource") return;
    const distFromHome = Math.hypot(m.x - m.startX, m.y - m.startY);
    if (distFromHome > 30) { m.state = "RETURNING"; m.hp = Math.min(m.maxHp, m.hp + m.maxHp * 0.05); const dirX = m.startX - m.x, dirY = m.startY - m.y; const dist = Math.hypot(dirX, dirY) || 1; m.vx = (dirX / dist) * m.spd * 2; m.vy = (dirY / dist) * m.spd * 2; return; }
    let t = null, minDistSq = Infinity;
    Object.values(inst.players).forEach(p => { if(p.hp <= 0 || p.god) return; const d = (p.x-m.x)**2 + (p.y-m.y)**2; if(d < 225 && d < minDistSq) { minDistSq = d; t = p; } });
    if (!t) { m.state = "IDLE"; m.vx=0; m.vy=0; return; }
    m.targetId = t.id; const dx = t.x - m.x, dy = t.y - m.y; const dist = Math.sqrt(minDistSq);
    if(m.skillCd > 0) m.skillCd--; if(m.timer > 0) m.timer--;
    
    // TIAMAT AI
    if (m.ai === "boss_tiamat") {
        const hpPct = m.hp / m.maxHp;
        if (m.phase === 1 && hpPct < 0.75) { m.phase = 2; sendLog(inst.id, "TIAMAT SUMMONS LEGION!", "#f00"); for(let i=0; i<2; i++) { spawnMob(inst, m.x+5, m.y+5, "hellknight", 2); spawnMob(inst, m.x-5, m.y-5, "demon", 2); } }
        if (m.phase === 2 && hpPct < 0.50) { m.phase = 3; sendLog(inst.id, "METEOR SHOWER!", "#f00"); m.spd *= 1.2; }
        if (m.phase === 3 && hpPct < 0.20) { m.phase = 4; sendLog(inst.id, "PRIMORDIAL FURY!", "#f00"); m.spd *= 1.5; m.dmg *= 1.5; }
        if (m.skillCd <= 0) {
            if (m.phase >= 3) { m.skillCd = 100; for(let i=0; i<8; i++) { const ang = (Math.PI*2/8)*i; inst.projectiles.push({x:m.x, y:m.y, vx:Math.cos(ang)*0.3, vy:Math.sin(ang)*0.3, life:80, dmg:m.dmg, owner:"mob", type:"meteor"}); } } 
            else { m.skillCd = 60; [-0.3, 0, 0.3].forEach(off => { const ang = Math.atan2(dy, dx) + off; inst.projectiles.push({x:m.x, y:m.y, vx:Math.cos(ang)*0.5, vy:Math.sin(ang)*0.5, life:60, dmg:m.dmg, owner:"mob", type:"fireball"}); }); }
            if (m.phase === 4) inst.projectiles.push({x:m.x, y:m.y, vx:(dx/dist)*0.8, vy:(dy/dist)*0.8, life:40, dmg:m.dmg*2, owner:"mob", type:"laser"});
        }
        if (dist > 5) { m.vx = (dx/dist) * m.spd; m.vy = (dy/dist) * m.spd; } else { m.vx = 0; m.vy = 0; }
        return;
    }

    const attackers = Object.values(inst.mobs).filter(mob => mob.targetId === t.id && mob.state === "ATTACK").length;
    if (m.ai === "boss_butcher") { if (m.state === "PRE_ATTACK") { if (m.timer <= 0) { io.to(inst.id).emit("fx", {type:"charge", x:m.x, y:m.y}); m.vx = Math.cos(m.angle)*1.5; m.vy = Math.sin(m.angle)*1.5; m.state = "ATTACK"; m.timer = 20; } return; } if (m.state === "ATTACK") { if (dist < 2) damagePlayer(t, m.dmg * 1.5, m.x, m.y); if (m.timer <= 0) { m.state = "CHASE"; m.skillCd = 60; } return; } if (m.phase === 1 && m.hp < m.maxHp * 0.5) { m.phase = 2; m.spd *= 1.4; sendLog(inst.id, "THE BUTCHER ENRAGES!", "#f00"); } if (dist > 6 && dist < 12 && m.skillCd <= 0) { m.skillCd = 100; inst.projectiles.push({x:m.x, y:m.y, vx:(dx/dist)*0.6, vy:(dy/dist)*0.6, life:40, dmg:15, owner:"mob", type:"hook"}); return; } if (dist > 3 && dist < 8 && m.skillCd <= 0 && Math.random() < 0.05) { m.state = "PRE_ATTACK"; m.timer = 20; m.angle = Math.atan2(dy, dx); io.to(inst.id).emit("txt", {x:m.x, y:m.y-2, val:"!!!", color:"#f00"}); return; } }
    else if (m.ai === "boss_lich") { if (m.phase === 1 && m.hp < m.maxHp * 0.4) { m.phase = 2; sendLog(inst.id, "Rise, servants!", "#0ff"); for(let k=0; k<3; k++) spawnMob(inst, m.x+Math.random()*4-2, m.y+Math.random()*4-2, "skeleton", 1.5); } if (dist < 6 && m.skillCd <= 0) { m.skillCd = 120; io.to(inst.id).emit("fx", {type:"nova", x:m.x, y:m.y}); damagePlayer(t, m.dmg, m.x, m.y); } else if (dist < 10 && m.skillCd <= 0) { m.skillCd = 40; inst.projectiles.push({x:m.x, y:m.y, vx:(dx/dist)*0.35, vy:(dy/dist)*0.35, life:60, dmg:m.dmg, owner:"mob", type:"frostball"}); } if (dist < 5) { m.vx = -(dx/dist)*m.spd; m.vy = -(dy/dist)*m.spd; } else { m.vx = (dx/dist)*m.spd; m.vy = (dy/dist)*m.spd; } return; }
    if (m.ai === "lunge") { if (m.state === "PRE_ATTACK") { if (m.timer <= 0) { m.vx = Math.cos(m.angle)*0.8; m.vy = Math.sin(m.angle)*0.8; m.state = "ATTACK"; m.timer = 15; } return; } if (m.state === "ATTACK") { if (dist < 1.2) damagePlayer(t, m.dmg, m.x, m.y); if (m.timer <= 0) { m.state = "CHASE"; m.skillCd = 40; } return; } if (dist < 5 && m.skillCd <= 0 && attackers < 3) { m.state = "PRE_ATTACK"; m.timer = 15; m.angle = Math.atan2(dy, dx); return; } }
    else if (m.ai === "range") { if (dist < 8 && m.skillCd <= 0) { m.skillCd = 60; inst.projectiles.push({x:m.x, y:m.y, vx:(dx/dist)*0.4, vy:(dy/dist)*0.4, life:50, dmg:m.dmg, owner:"mob", type:m.proj||"arrow"}); } if (dist < 4) { m.vx = -(dx/dist)*m.spd; m.vy = -(dy/dist)*m.spd; } else if (dist > 7) { m.vx = (dx/dist)*m.spd; m.vy = (dy/dist)*m.spd; } else { m.vx = -Math.sin(Math.atan2(dy,dx)) * m.spd; m.vy = Math.cos(Math.atan2(dy,dx)) * m.spd; } return; }
    if (attackers >= 4 && dist < 3) { const ang = Math.atan2(dy, dx) + 0.5; m.vx = Math.cos(ang) * m.spd; m.vy = Math.sin(ang) * m.spd; } 
    else { m.vx = (dx/dist) * m.spd; m.vy = (dy/dist) * m.spd; if (m.affix === "FAST") { m.vx *= 1.5; m.vy *= 1.5; } }
    if (dist < 1.2 && Math.random() < 0.1) damagePlayer(t, m.dmg, m.x, m.y);
}

function getOrCreateInstance(level) {
    const key = `level_${level}`;
    if (instances[key]) return instances[key];
    const inst = { id: key, level: level, dungeon: [], props: [], rooms: [], players: {}, mobs: {}, items: {}, projectiles: [], mobId: 0, itemId: 0, theme: level === 0 ? "#444" : "#222" };
    if (level === 0) generateCity(inst); else generateDungeon(inst);
    instances[key] = inst; 
    return inst;
}

function generateCity(inst) {
    inst.dungeon = Array.from({length: SIZE}, () => Array(SIZE).fill(TILE_WALL));
    inst.theme = "#444"; const cx = SIZE/2, cy = SIZE/2; const w = 40, h = 40; const x = cx - w/2, y = cy - h/2;
    for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++) inst.dungeon[yy][xx] = TILE_FLOOR;
    inst.rooms.push({x, y, w, h, cx, cy});
    spawnMob(inst, cx - 8, cy - 8, "merchant", 1); spawnMob(inst, cx + 8, cy - 8, "healer", 1); spawnMob(inst, cx - 8, cy + 8, "blacksmith", 1);
    inst.props.push({ type: "stairs", x: cx, y: cy + 12, locked: false, label: "DUNGEON ENTRANCE" }); inst.props.push({ type: "shrine", x: cx, y: cy, buff: "none" }); 
}

function createTiamatBossRoom() {
    const size = 36; const cx = Math.floor(SIZE/2); const cy = Math.floor(SIZE/2);
    return { x: cx - size/2, y: cy - size/2, w: size, h: size, cx, cy, bossRoom: true };
}

function generateDungeon(inst) {
    const diff = getDifficulty(inst.level);
    inst.isPrimordial = (diff.name === "PRIMORDIAL");
    inst.theme = diff.color;
    inst.rooms = []; inst.mobs = {}; inst.items = {}; inst.projectiles = []; inst.props = [];

    if (inst.isPrimordial) {
        // TIAMAT ARENA GENERATION
        const bossRoom = createTiamatBossRoom();
        inst.rooms.push(bossRoom);
        inst.dungeon = Array.from({length: SIZE}, () => Array(SIZE).fill(TILE_WALL));
        for(let y=bossRoom.y; y<bossRoom.y+bossRoom.h; y++) {
            for(let x=bossRoom.x; x<bossRoom.x+bossRoom.w; x++) {
                if(x>1 && y>1 && x<SIZE-1 && y<SIZE-1) inst.dungeon[y][x] = TILE_FLOOR;
            }
        }
        spawnMob(inst, bossRoom.cx, bossRoom.cy, "tiamat", inst.level);
        inst.tiamatSpawned = true;
        // Exit/Loot
        inst.props.push({ type: "stairs", x: bossRoom.cx, y: bossRoom.cy + 15, locked: true, label: "DEFEAT TIAMAT" });
        return;
    }

    // STANDARD GENERATION
    inst.dungeon = Array.from({length: SIZE}, () => Array(SIZE).fill(TILE_WALL));
    for(let i=0; i<35; i++){
        const w=8+Math.random()*12|0, h=8+Math.random()*12|0;
        const x=2+Math.random()*(SIZE-w-4)|0, y=2+Math.random()*(SIZE-h-4)|0;
        let overlap = false;
        for(let r of inst.rooms) if(x < r.x+r.w && x+w > r.x && y < r.y+r.h && y+h > r.y) overlap = true;
        if(overlap && Math.random()>0.2) continue;
        for(let yy=y; yy<y+h; yy++) for(let xx=x; xx<x+w; xx++) inst.dungeon[yy][xx] = TILE_FLOOR;
        inst.rooms.push({x, y, w, h, cx: x+w/2, cy: y+h/2});
        if(inst.rooms.length>1){
            let prev = inst.rooms[inst.rooms.length-2];
            let cx=prev.cx|0, cy=prev.cy|0, tx=x+w/2|0, ty=y+h/2|0;
            const dig = (dx, dy) => { for(let oy=-1; oy<=1; oy++) for(let ox=-1; ox<=1; ox++) if(inst.dungeon[dy+oy]?.[dx+ox]!==undefined) inst.dungeon[dy+oy][dx+ox] = TILE_FLOOR; };
            while(cx!==tx){ dig(cx, cy); cx+=Math.sign(tx-cx); }
            while(cy!==ty){ dig(cx, cy); cy+=Math.sign(ty-cy); }
        }
    }
    
    const lastRoom = inst.rooms[inst.rooms.length-1];
    const doorLocked = Math.random() > 0.2; 
    inst.props.push({ type: "stairs", x: lastRoom.cx, y: lastRoom.cy, locked: doorLocked, label: doorLocked ? "LOCKED" : "NEXT LEVEL" });

    inst.rooms.forEach((r, i) => {
        if(i===inst.rooms.length-1) {
            if(inst.level % 3 === 0) {
                 let boss = "butcher";
                 if(inst.level >= 6) boss = "lich";
                 if(inst.level >= 9) boss = "broodmother";
                 if(inst.level >= 12) boss = "firelord";
                 if(inst.level >= 15) boss = "voidgazer";
                 if(inst.level >= 18) boss = "diablo"; 
                 spawnMob(inst, r.cx - 2, r.cy - 2, boss, 1 + inst.level*0.3);
            }
            return; 
        }
        if(Math.random() < 0.15) spawnMob(inst, r.cx, r.cy, "chest", 1);
        if(Math.random() < 0.05) inst.props.push({type: "book", x: r.cx + (Math.random()*4-2), y: r.cy + (Math.random()*4-2), buff: "none"});
        const count = 2 + Math.random() * (inst.level * 0.8) | 0;
        let pool = ["rat", "bat"];
        if(inst.level >= 2) pool.push("slime", "goblin");
        if(inst.level >= 4) pool.push("skeleton", "archer");
        if(inst.level >= 7) pool.push("orc", "mage");
        if(inst.level >= 10) pool.push("ghost", "demon");
        if(inst.level >= 13) pool.push("imp", "succubus", "hellknight"); 
        for(let k=0; k<count; k++) spawnMob(inst, r.x+2+Math.random()*(r.w-4), r.y+2+Math.random()*(r.h-4), pool[Math.floor(Math.random()*pool.length)], diff.mult);
    });
}

function spawnMob(inst, x, y, type, mult) {
    const data = MOB_DATA[type];
    const mid = "m"+(++inst.mobId);
    let affix = null, color = data.color || null, size = data.size, hp = Math.floor(data.hp * mult), dmg = Math.floor(data.dmg * mult), name = data.name || type.toUpperCase();
    if (!data.boss && !data.npc && Math.random() < 0.1) {
        const affixes = ["FAST", "STRONG", "TANK"];
        affix = affixes[Math.floor(Math.random() * affixes.length)];
        name = `${affix} ${name}`;
        if (affix === "FAST") { color = "#ff0"; }
        if (affix === "STRONG") { dmg *= 1.5; color = "#f80"; size *= 1.2; }
        if (affix === "TANK") { hp *= 2.0; color = "#88f"; size *= 1.3; }
    }
    inst.mobs[mid] = { id: mid, type, x, y, startX: x, startY: y, vx:0, vy:0, hp, maxHp: hp, dmg, xp: Math.floor(data.xp * mult), gold: Math.floor(data.gold*mult), spd: data.spd, ai: data.ai, size, range: data.range, poise: data.poise, npc:data.npc, boss:data.boss, drop: data.drop, proj: data.proj, state: "IDLE", timer: 0, hitFlash: 0, name, color, affix, stun: 0, phase: 1, skillCd: 0, targetId: null };
    if(data.npc) {
        let shopItems = [];
        if (type === "merchant") shopItems = [generateItem(inst.level || 1), generateItem(inst.level || 1), ITEM_BASES.potion, ITEM_BASES.key];
        else if (type === "healer") shopItems = [ITEM_BASES.potion];
        else if (type === "blacksmith") shopItems = [ITEM_BASES.wood, ITEM_BASES.stone];
        inst.mobs[mid].shop = shopItems;
    }
}

setInterval(() => {
    Object.values(instances).forEach(inst => {
        inst.mobCount = 0; const mobsSimple = {};
        for (let k in inst.mobs) { const m = inst.mobs[k]; if (!m.npc && m.ai !== "resource") inst.mobCount++; mobsSimple[k] = { id: m.id, type: m.type, x: rnd(m.x), y: rnd(m.y), vx: rnd(m.vx), hp: m.hp, maxHp: m.maxHp, boss: m.boss, npc: m.npc, name: m.name, hitFlash: m.hitFlash, equipment: m.equipment, chatMsg: m.chatMsg, chatTimer: m.chatTimer, ai: m.ai, drop: m.drop, color: m.color, size: m.size, class: m.class, level: m.level, stats: m.stats, state: m.state }; }
        const playersSimple = {};
        for (let k in inst.players) { const pl = inst.players[k]; playersSimple[k] = { id: pl.id, name: pl.name, x: rnd(pl.x), y: rnd(pl.y), hp: pl.hp, mp: pl.mp, xp: pl.xp, gold: pl.gold, pts: pl.pts, attrs: pl.attrs, stats: pl.stats, class: pl.class, level: pl.level, inventory: pl.inventory, equipment: pl.equipment, input: pl.input, chatMsg: pl.chatMsg, chatTimer: pl.chatTimer, god: pl.god }; }
        Object.values(inst.players).forEach(p => {
            if(p.cd.atk > 0) p.cd.atk--; if(p.cd.skill > 0) p.cd.skill--; if(p.cd.dash > 0) p.cd.dash--;
            if (p.buffs && p.buffs.timer > 0) { p.buffs.timer--; if (p.buffs.timer <= 0) { p.buffs = {}; recalcStats(p); io.to(p.id).emit("txt", {x:p.x, y:p.y, val:"BUFF ENDED", color:"#ccc"}); } }
            if (p.chatTimer > 0) { p.chatTimer--; if (p.chatTimer <= 0) p.chatMsg = ""; }
            p.hp = Math.min(p.stats.maxHp, p.hp + 0.05); p.mp = Math.min(p.stats.maxMp, p.mp + 0.1);
            if(p.dashTime > 0) { p.dashTime--; p.x += p.vx; p.y += p.vy; if(isWall(inst, p.x, p.y)) { p.x -= p.vx; p.y -= p.vy; p.dashTime = 0; } } 
            else { const spd = p.input.block ? p.stats.spd * 0.3 : p.stats.spd; let nx = p.x + p.input.x * spd; let ny = p.y + p.input.y * spd; if(!isWall(inst, nx + (p.input.x>0?0.3:-0.3), p.y)) p.x = nx; if(!isWall(inst, p.x, ny + (p.input.y>0?0.3:-0.3))) p.y = ny; resolveCollisions(inst, p, 0.4); p.x += p.vx; p.y += p.vy; p.vx *= 0.8; p.vy *= 0.8; }
            for (let k in inst.items) { const it = inst.items[k]; if (Math.hypot(p.x - it.x, p.y - it.y) < 0.8 && (!it.pickupDelay || Date.now() > it.pickupDelay)) { if (it.item.key === "gold") { p.gold += it.item.val; io.to(p.id).emit("txt", { x: p.x, y: p.y, val: `+${it.item.val}G`, color: "#fb0" }); } else if (p.inventory.length < 20) { p.inventory.push(it.item); io.to(p.id).emit("txt", { x: p.x, y: p.y, val: it.item.name, color: it.item.color }); } delete inst.items[k]; } }
            for(let i = inst.props.length - 1; i >= 0; i--) { const pr = inst.props[i]; const dist = Math.hypot(p.x - pr.x, p.y - pr.y); if ((pr.type === "shrine" || pr.type === "book") && dist < 1.0) { if (pr.type === "shrine" && pr.buff !== "none") { p.buffs = { [pr.buff]: true, timer: 600 }; p.hp = p.stats.maxHp; p.mp = p.stats.maxMp; recalcStats(p); io.to(p.id).emit("txt", {x:p.x, y:p.y, val:"SHRINE POWER!", color:"#0ff"}); io.to(inst.id).emit("fx", {type:"nova", x:p.x, y:p.y}); } else if (pr.type === "book") { const msg = LORE_TEXTS[Math.floor(Math.random() * LORE_TEXTS.length)]; io.to(p.id).emit("log", {msg: msg, color: "#aaa"}); io.to(p.id).emit("fx", {type: "lore"}); } else if (pr.type === "shrine") { if (p.hp < p.stats.maxHp) { p.hp = p.stats.maxHp; p.mp = p.stats.maxMp; io.to(p.id).emit("txt", {x:p.x, y:p.y, val:"REFRESHED", color:"#0ff"}); } } if (pr.buff !== "none") inst.props.splice(i, 1); } if (pr.type === "stairs" && dist < 1.0) { if (!pr.locked) { if (inst.level !== 0) changeLevel(io.sockets.sockets.get(p.id), p, inst.level + 1); } else { const keyIdx = p.inventory.findIndex(it => it.key === "key"); if (keyIdx !== -1) { p.inventory.splice(keyIdx, 1); pr.locked = false; pr.label = "UNLOCKED"; io.to(inst.id).emit("txt", {x:pr.x, y:pr.y, val:"UNLOCKED!", color:"#ffd700"}); sendLog(inst.id, `${p.name} usou uma Chave!`, "#ffd700"); } else if (!p.lastMsg || Date.now() - p.lastMsg > 2000) { io.to(p.id).emit("txt", {x:p.x, y:p.y, val:"LOCKED", color:"#f00"}); p.lastMsg = Date.now(); } } } }
            sendPlayerUpdate(p, mobsSimple, playersSimple);
        });
        Object.values(inst.mobs).forEach(m => { processMobAI(inst, m); resolveCollisions(inst, m, 0.5); m.x += m.vx; m.y += m.vy; m.vx *= 0.7; m.vy *= 0.7; if (m.hitFlash > 0) m.hitFlash--; });
        for(let i = inst.projectiles.length - 1; i >= 0; i--) { let pr = inst.projectiles[i]; pr.x += pr.vx; pr.y += pr.vy; pr.life--; if(isWall(inst, pr.x, pr.y) || pr.life <= 0) { if(pr.type === "meteor" || pr.type === "fireball") hitArea(inst, {id:pr.owner}, pr.x, pr.y, 1.5, null, 0, pr.dmg * 0.5, 10); inst.projectiles.splice(i, 1); continue; } if(pr.owner === "mob") { Object.values(inst.players).forEach(p => { if(Math.hypot(p.x - pr.x, p.y - pr.y) < 0.8) { damagePlayer(p, pr.dmg, pr.x, pr.y); if(pr.type === "hook") { p.x = pr.x - pr.vx*2; p.y = pr.y - pr.vy*2; io.to(inst.id).emit("txt", {x:p.x, y:p.y, val:"GRABBED!", color:"#f00"}); } pr.life = 0; } }); if(pr.life <= 0) { inst.projectiles.splice(i, 1); continue; } } if(pr.owner !== "mob") { for(let k in inst.mobs) { let m = inst.mobs[k]; if(!m.npc && Math.hypot(m.x - pr.x, m.y - pr.y) < 1) { damageMob(inst, m, pr.dmg, inst.players[pr.owner], pr.vx, pr.vy, 10, pr.isCrit); inst.projectiles.splice(i, 1); break; } } } }
    });
}, TICK);

initializeServer();
process.on('uncaughtException', (err) => { console.error('SERVER CRITICAL ERROR:', err); });