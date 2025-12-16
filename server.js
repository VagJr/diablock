const http = require("http");
const fs = require("fs");
const path = require("path");
const { Server } = require("socket.io");

const DB_FILE = path.join(__dirname, "db.json");
let DB = {};
if (fs.existsSync(DB_FILE)) { try { DB = JSON.parse(fs.readFileSync(DB_FILE)); } catch (e) { DB = {}; } }
else { fs.writeFileSync(DB_FILE, JSON.stringify({})); }
function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(DB, null, 2)); }

const server = http.createServer((req, res) => {
  const safeUrl = decodeURI(req.url === "/" ? "/index.html" : req.url);
  const p = path.join(__dirname, safeUrl);

  if(fs.existsSync(p) && fs.statSync(p).isFile()) {
      let contentType = "text/html";
      if(safeUrl.endsWith(".js")) contentType = "application/javascript";
      else if(safeUrl.endsWith(".css")) contentType = "text/css";
      else if(safeUrl.endsWith(".mp3")) contentType = "audio/mpeg"; 

      res.writeHead(200, {"Content-Type": contentType});
      // LINHA CORRIGIDA AQUI: Usando fs.createReadStream e não res.createReadStream
      fs.createReadStream(p).pipe(res);
  } else { 
      res.writeHead(404);
      res.end("404 Not Found"); 
  }
});
const io = new Server(server);

const SIZE = 120;
const TILE_FLOOR=0, TILE_WALL=1;
const TICK = 50; 
const SCALE = 16; 

const DIFFICULTY = {
    NORMAL:    { name: "NORMAL",    mult: 0.8,  drop: 1.0, color: "#222" },
    NIGHTMARE: { name: "NIGHTMARE", mult: 1.8,  drop: 1.8, color: "#311" },
    INFERNO:   { name: "INFERNO",   mult: 3.5,  drop: 3.0, color: "#102" }
};

function getDifficulty(lvl) {
    if(lvl >= 10) return DIFFICULTY.INFERNO;
    if(lvl >= 5) return DIFFICULTY.NIGHTMARE;
    return DIFFICULTY.NORMAL;
}

const GEMS = {
    ruby:    { name: "Ruby",    color: "#f00", stat: "dmg", val: 3, desc: "+3 Dmg" },
    sapphire:{ name: "Sapphire",color: "#00f", stat: "mp",  val: 10,desc: "+10 Mana" },
    emerald: { name: "Emerald", color: "#0f0", stat: "spd", val: 0.01, desc: "+Speed" },
    diamond: { name: "Diamond", color: "#fff", stat: "hp",  val: 15, desc: "+15 HP" }
};

const ITEM_BASES = {
  sword: { slot: "hand", name: "Sword", dmg: 6, type: "melee", cd: 10, price:50 },
  axe:   { slot: "hand", name: "Axe", dmg: 10, spd: -0.03, type: "melee", cd: 16, price:60 },
  dagger:{ slot: "hand", name: "Dagger", dmg: 4, spd: 0.02, type: "melee", cd: 6, price:40 },
  bow:   { slot: "hand", name: "Bow", dmg: 5, type: "ranged", proj: "arrow", cd: 12, price:70 },
  staff: { slot: "hand", name: "Staff", dmg: 12, mp: 15, type: "magic", proj: "fireball", cd: 20, price:80 },
  helm:  { slot: "head", name: "Helm", hp: 20, def: 1, price:40 },
  armor: { slot: "body", name: "Armor", hp: 40, def: 3, price:100 },
  potion:{ slot: "potion",name: "Hp Pot", heal: 50, type: "consumable", price:20 },
  wood:  { slot: "mat", name: "Wood", type: "material", price: 5 },
  stone: { slot: "mat", name: "Stone", type: "material", price: 8 },
  ruby:  { slot: "mat", name: "Ruby", type: "gem", price: 100, ...GEMS.ruby },
  sapphire:{ slot: "mat", name: "Sapphire", type: "gem", price: 100, ...GEMS.sapphire },
  emerald:{ slot: "mat", name: "Emerald", type: "gem", price: 100, ...GEMS.emerald },
  diamond:{ slot: "mat", name: "Diamond", type: "gem", price: 100, ...GEMS.diamond }
};

const RECIPES = [
    { res: "ruby", req: { wood: 5, stone: 5 } },
    { res: "sapphire", req: { wood: 5, stone: 5 } },
    { res: "emerald", req: { wood: 5, stone: 5 } },
    { res: "diamond", req: { wood: 10, stone: 10 } },
    { res: "potion", req: { wood: 2, stone: 0 } }
];

const MOB_DATA = {
    tree:     { hp: 20, spd: 0, ai: "resource", drop: "wood", xp: 5, size: 14, color: "#252", poise: 999 },
    rock:     { hp: 30, spd: 0, ai: "resource", drop: "stone",xp: 5, size: 14, color: "#555", poise: 999 },
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
    butcher:    { hp: 400, dmg: 25, spd: 0.07, ai: "boss_melee", xp: 800, gold: 200, size: 24, poise: 99, boss:true, name:"The Butcher" },
    lich:       { hp: 350, dmg: 35, spd: 0.04, ai: "boss_range", xp: 900, gold: 250, size: 20, poise: 99, boss:true, proj:"frostball", name:"Lich King" },
    broodmother:{ hp: 300, dmg: 20, spd: 0.09, ai: "boss_range", xp: 850, gold: 220, size: 28, poise: 99, boss:true, proj:"web", name:"Broodmother" },
    firelord:   { hp: 500, dmg: 40, spd: 0.05, ai: "boss_range", xp: 1200,gold: 400, size: 30, poise: 99, boss:true, proj:"meteor", name:"Fire Lord" },
    voidgazer:  { hp: 450, dmg: 50, spd: 0.06, ai: "boss_range", xp: 1500,gold: 500, size: 22, poise: 99, boss:true, proj:"laser", name:"Void Gazer" },
    chest:    { hp: 5,  dmg: 0, spd: 0,    ai: "static",xp: 0,  gold: 100,size: 12, loot: true },
    merchant: { hp: 999,dmg: 0, spd: 0,    ai: "npc",   xp: 0,  gold: 0,  size: 12, npc: true }
};

function generateItem(level, diffMult=1, forceType=null) {
    if(forceType) {
        const base = ITEM_BASES[forceType];
        return { 
            id: Math.random().toString(36).substr(2), key:forceType, rarity:"common", color:"#aaa", 
            slot: base.slot, type: base.type, name: base.name, price: base.price, stats:{}, sockets:[], gems:[]
        };
    }
    if(Math.random() < 0.20) return { ...ITEM_BASES.potion, id: Math.random().toString(36).substr(2), key:"potion", rarity:"common", color:"#f33", stats:{heal:50+level*10} };
    if(Math.random() < 0.05 * diffMult) {
        const gemKeys = ["ruby", "sapphire", "emerald", "diamond"];
        const k = gemKeys[Math.floor(Math.random()*gemKeys.length)];
        return { ...ITEM_BASES[k], id:Math.random().toString(36).substr(2), key:k, rarity:"magic", color:ITEM_BASES[k].color };
    }
    const keys = Object.keys(ITEM_BASES).filter(k=>!["potion","wood","stone","ruby","sapphire","emerald","diamond"].includes(k));
    const key = keys[Math.floor(Math.random()*keys.length)];
    const base = ITEM_BASES[key];
    const r = Math.random();
    const rarity = r>0.97?"legendary":r>0.85?"rare":r>0.6?"magic":"common";
    const meta = {
        common:   {c:"#aaa", m:1, s:0}, 
        magic:    {c:"#4ff", m:1.3, s:1}, 
        rare:     {c:"#ff0", m:1.8, s:1}, 
        legendary:{c:"#f0f", m:3.0, s:2}
    };
    const power = (level * meta[rarity].m) * diffMult;
    const item = {
        id: Math.random().toString(36).substr(2),
        key, rarity, color: meta[rarity].c, slot: base.slot, type: base.type, proj: base.proj, cd: base.cd,
        name: (rarity!=="common"?rarity.toUpperCase()+" ":"") + base.name,
        price: Math.floor(base.price * meta[rarity].m),
        stats: {}, sockets: [], gems: []
    };
    if(Math.random() < 0.5) { for(let i=0; i<meta[rarity].s; i++) item.sockets.push(null); }
    if(base.dmg) item.stats.dmg = Math.floor(base.dmg + power);
    if(base.hp) item.stats.hp = Math.floor(base.hp + power * 3);
    if(base.def) item.stats.def = Math.floor(base.def + power);
    if(base.mp) item.stats.mp = Math.floor(base.mp + power * 2);
    return item;
}

function recalcStats(p) {
    if(!p.attrs) p.attrs = { str:5, dex:5, int:5 };
    let str=p.attrs.str, dex=p.attrs.dex, int=p.attrs.int;
    let addHp=0, addMp=0, addDmg=0, addDef=0, addSpd=0;
    ["hand", "head", "body"].forEach(s => { 
        if(p.equipment[s]){ 
            const it = p.equipment[s];
            addHp+=it.stats.hp||0; addMp+=it.stats.mp||0; 
            addDmg+=it.stats.dmg||0; addDef+=it.stats.def||0;
            if(it.gems) it.gems.forEach(g => {
                if(g.stat === "dmg") addDmg += g.val;
                if(g.stat === "hp") addHp += g.val;
                if(g.stat === "mp") addMp += g.val;
                if(g.stat === "spd") addSpd += g.val;
            });
        }
    });
    p.stats.maxHp = 90 + (str*8) + addHp + (p.level*10);
    p.stats.maxMp = 30 + (int*5) + addMp + (p.level*4);
    p.stats.spd = 0.11 + (dex*0.001) + addSpd;
    p.stats.def = addDef;
    const wep = p.equipment.hand;
    let baseDmg = addDmg;
    if(wep) {
        if(wep.type === "melee") baseDmg += str * 0.6;
        if(wep.type === "ranged") baseDmg += dex * 0.6;
        if(wep.type === "magic") baseDmg += int * 0.6;
    } else { baseDmg += str * 0.3; }
    p.stats.dmg = Math.floor(baseDmg);
    if(p.hp > p.stats.maxHp) p.hp = p.stats.maxHp;
}

let instanceId = 0;
const instances = {};

function createInstance() {
    const id = "i" + (++instanceId);
    const inst = { id, level: 1, dungeon: [], props: [], rooms: [], players: {}, mobs: {}, items: {}, projectiles: [], mobId: 0, itemId: 0, theme: "#222" };
    generateDungeon(inst); instances[id] = inst; return inst;
}

function generateDungeon(inst) {
    inst.dungeon = Array.from({length: SIZE}, () => Array(SIZE).fill(TILE_WALL));
    inst.rooms = []; inst.mobs = {}; inst.items = {}; inst.projectiles = []; inst.props = [];
    inst.npcSpawned = false;
    const diff = getDifficulty(inst.level);
    inst.theme = diff.color;
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
    inst.rooms.forEach((r, i) => {
        for(let j=0; j<(Math.random()*6|0); j++) {
            const rx = r.x+1+Math.random()*(r.w-2); 
            const ry = r.y+1+Math.random()*(r.h-2);
            if(Math.random() < 0.3) { spawnMob(inst, rx, ry, Math.random()>0.5?"tree":"rock", 1); }
            else { inst.props.push({ x:rx, y:ry, type:Math.random()>0.5?"bones":"grass" }); }
        }
        if(i===0) return; 
        if(!inst.npcSpawned && i > 2 && Math.random() < 0.3) { spawnMob(inst, r.cx, r.cy, "merchant", 1); inst.npcSpawned = true; return; }
        if(i === inst.rooms.length - 1) { 
            let boss = "butcher"; 
            if(inst.level >= 3) boss = "lich";
            if(inst.level >= 6) boss = "broodmother";
            if(inst.level >= 9) boss = "firelord";
            if(inst.level >= 12) boss = "voidgazer";
            spawnMob(inst, r.cx, r.cy, boss, 1 + inst.level*0.3); 
            return; 
        }
        if(Math.random() < 0.15) spawnMob(inst, r.cx, r.cy, "chest", 1);
        const count = 2 + Math.random() * (inst.level * 0.8) | 0;
        let pool = ["rat", "bat"];
        if(inst.level >= 2) pool.push("slime", "goblin");
        if(inst.level >= 4) pool.push("skeleton", "archer");
        if(inst.level >= 7) pool.push("orc", "mage");
        if(inst.level >= 10) pool.push("ghost", "demon");
        for(let k=0; k<count; k++){
            spawnMob(inst, r.x+2+Math.random()*(r.w-4), r.y+2+Math.random()*(r.h-4), pool[Math.floor(Math.random()*pool.length)], diff.mult);
        }
    });
}

function spawnMob(inst, x, y, type, mult) {
    const data = MOB_DATA[type];
    const mid = "m"+(++inst.mobId);
    inst.mobs[mid] = {
        id: mid, type, x, y, vx:0, vy:0,
        hp: Math.floor(data.hp * mult), maxHp: Math.floor(data.hp * mult),
        dmg: Math.floor(data.dmg * mult), xp: Math.floor(data.xp * mult), gold: Math.floor(data.gold*mult),
        spd: data.spd, ai: data.ai, size: data.size, range: data.range, poise: data.poise, npc:data.npc, boss:data.boss,
        drop: data.drop, proj: data.proj, state: "idle", timer: 0, hitFlash: 0, name: data.name || type.toUpperCase()
    };
    if(data.npc) inst.mobs[mid].shop = [generateItem(inst.level), generateItem(inst.level), ITEM_BASES.potion, ITEM_BASES.ruby];
}

io.on("connection", socket => {
    let user = null, charName = null;
    socket.on("login", u => { user=u; if(!DB[user]) DB[user]={chars:{}}; socket.emit("char_list", DB[user].chars); });
    socket.on("create_char", ({name, cls}) => {
        if(!user || DB[user].chars[name]) return;
        DB[user].chars[name] = { class: cls, level: 1, xp: 0, pts: 0, gold: 0, attrs: { str: 5, dex: 5, int: 5 }, hp: 100, mp: 50, inventory: [], equipment: {} };
        saveDB(); socket.emit("char_list", DB[user].chars);
    });
    socket.on("enter_game", name => {
        if(!user || !DB[user].chars[name]) return;
        charName = name;
        let inst = Object.values(instances)[0] || createInstance();
        socket.join(inst.id); socket.instId = inst.id;
        const data = DB[user].chars[name];
        if(!data.attrs) data.attrs = { str:5, dex:5, int:5 };
        inst.players[socket.id] = {
            id: socket.id, name, ...JSON.parse(JSON.stringify(data)),
            x: inst.rooms[0].cx, y: inst.rooms[0].cy, vx:0, vy:0, input: {x:0,y:0,block:false},
            cd: { atk:0, skill:0, dash:0 }, stats: {}
        };
        recalcStats(inst.players[socket.id]); 
        socket.emit("game_start", {recipes: RECIPES});
    });
    socket.on("chat", msg => { if(socket.instId) io.to(socket.instId).emit("chat", {id:socket.id, msg}); });
    socket.on("input", d => { const p = instances[socket.instId]?.players[socket.id]; if(p) { p.input.x=d.x; p.input.y=d.y; p.input.block=d.block; } });
    socket.on("add_stat", s => { const p = instances[socket.instId]?.players[socket.id]; if(p && p.pts>0){ p.attrs[s]++; p.pts--; recalcStats(p); } });
    socket.on("dash", angle => {
        const p = instances[socket.instId]?.players[socket.id];
        if(!p || p.cd.dash > 0 || p.input.block || p.mp < 10) return;
        p.mp -= 10; p.cd.dash = 30; 
        p.vx = Math.cos(angle) * 0.7; p.vy = Math.sin(angle) * 0.7;
        p.dashTime = 5;
        io.to(instances[socket.instId].id).emit("fx", { type: "dash", x: p.x, y: p.y });
    });
    socket.on("potion", () => {
        const p = instances[socket.instId]?.players[socket.id];
        if(!p || !p.equipment.potion) return;
        const pot = p.equipment.potion;
        p.hp = Math.min(p.stats.maxHp, p.hp + pot.stats.heal);
        io.to(instances[socket.instId].id).emit("fx", { type: "nova", x: p.x, y: p.y });
        p.equipment.potion = null; 
        const idx = p.inventory.findIndex(i => i.key === "potion");
        if(idx !== -1) { p.equipment.potion = p.inventory[idx]; p.inventory.splice(idx, 1); }
    });
    socket.on("attack", ang => {
        const inst = instances[socket.instId];
        const p = inst?.players[socket.id];
        if(!p || p.cd.atk > 0 || p.input.block) return;
        const wep = p.equipment.hand;
        const type = wep ? wep.type : "melee";
        p.cd.atk = wep ? wep.cd : 10;
        let clickedNPC = false;
        Object.values(inst.mobs).forEach(m => { 
            if(m.npc && Math.hypot(m.x-p.x, m.y-p.y) < 3) { socket.emit("open_shop", m.shop); clickedNPC = true; } 
        });
        if(clickedNPC) return;
        if(type === "melee") {
            io.to(inst.id).emit("fx", { type: "slash", x: p.x, y: p.y, angle: ang });
            hitArea(inst, p, p.x, p.y, 2.0, ang, 1.5, p.stats.dmg, 20);
        } else {
            if(type==="magic" && p.mp < 2) return; if(type==="magic") p.mp -= 2;
            inst.projectiles.push({ x:p.x, y:p.y, vx:Math.cos(ang)*0.4, vy:Math.sin(ang)*0.4, life: 30, dmg: p.stats.dmg, owner: p.id, type: wep ? wep.proj : "arrow", angle: ang });
        }
    });
    socket.on("skill", ({idx, angle}) => {
        const inst = instances[socket.instId];
        const p = inst?.players[socket.id];
        if(!p || p.cd.skill > 0 || p.input.block) return;
        const ang = angle || Math.atan2(p.input.y||0, p.input.x||1);
        if(p.class === "knight") {
            if(p.mp < 15) return; p.mp -= 15; p.cd.skill = 60;
            io.to(inst.id).emit("fx", { type: "spin", x: p.x, y: p.y }); hitArea(inst, p, p.x, p.y, 3.5, null, 0, p.stats.dmg * 2, 40);
        } else if(p.class === "hunter") {
            if(p.mp < 15) return; p.mp -= 15; p.cd.skill = 50;
            [-0.3, 0, 0.3].forEach(off => { inst.projectiles.push({ x:p.x, y:p.y, vx:Math.cos(ang+off)*0.5, vy:Math.sin(ang+off)*0.5, life: 25, dmg: p.stats.dmg, owner: p.id, type: "arrow", angle: ang+off }); });
        } else if(p.class === "mage") {
            if(p.mp < 25) return; p.mp -= 25; p.cd.skill = 80;
            inst.projectiles.push({ x:p.x, y:p.y, vx:Math.cos(ang)*0.2, vy:Math.sin(ang)*0.2, life: 50, dmg: p.stats.dmg * 3, owner: p.id, type: "meteor", angle: ang });
        }
    });
    socket.on("craft", ({action, recipeIdx, itemIdx, gemIdx}) => {
        const inst = instances[socket.instId];
        const p = inst?.players[socket.id];
        if(!p) return;
        if(action === "create") {
            const recipe = RECIPES[recipeIdx];
            if(!recipe) return;
            const woodCount = p.inventory.filter(i=>i.key==="wood").length;
            const stoneCount = p.inventory.filter(i=>i.key==="stone").length;
            if(woodCount >= recipe.req.wood && stoneCount >= recipe.req.stone && p.inventory.length < 20) {
                for(let k=0; k<recipe.req.wood; k++) { const i=p.inventory.findIndex(x=>x.key==="wood"); if(i>-1) p.inventory.splice(i,1); }
                for(let k=0; k<recipe.req.stone; k++) { const i=p.inventory.findIndex(x=>x.key==="stone"); if(i>-1) p.inventory.splice(i,1); }
                if(recipe.res === "potion") p.inventory.push({...ITEM_BASES.potion, id:Math.random(), stats:{heal:50+p.level*5}});
                else {
                    const gemBase = ITEM_BASES[recipe.res];
                    p.inventory.push({...gemBase, id:Math.random(), key:recipe.res});
                }
                io.to(inst.id).emit("txt", {x:p.x, y:p.y, val:"CRAFT!", color:"#0f0"});
            }
        }
        else if(action === "socket") {
            const item = p.inventory[itemIdx];
            const gem = p.inventory[gemIdx];
            if(item && gem && item.type !== "material" && item.type !== "consumable" && gem.type === "gem") {
                if(item.sockets && item.gems.length < item.sockets.length) {
                    item.gems.push(gem);
                    p.inventory.splice(gemIdx, 1);
                    io.to(inst.id).emit("txt", {x:p.x, y:p.y, val:"SOCKETED!", color:"#0ff"});
                }
            }
        }
    });
    socket.on("equip", idx => {
        const p = instances[socket.instId]?.players[socket.id];
        if(!p || !p.inventory[idx]) return;
        const it = p.inventory[idx];
        const old = p.equipment[it.slot];
        if(it.type === "material" || it.type === "gem") return;
        p.equipment[it.slot] = it; p.inventory.splice(idx, 1);
        if(old) p.inventory.push(old);
        recalcStats(p);
    });
    socket.on("unequip", slot => {
        const p = instances[socket.instId]?.players[socket.id];
        if(p && p.equipment[slot] && p.inventory.length < 20) { p.inventory.push(p.equipment[slot]); p.equipment[slot] = null; recalcStats(p); }
    });
    socket.on("drop", idx => {
        const inst = instances[socket.instId];
        const p = inst?.players[socket.id];
        if(p && p.inventory[idx]) {
            const it = p.inventory[idx];
            p.inventory.splice(idx, 1);
            const iid = "d"+(++inst.itemId);
            inst.items[iid] = { id:iid, x:p.x, y:p.y, item: it, pickupDelay: Date.now() + 1500 }; 
        }
    });
    socket.on("buy", item => {
        const p = instances[socket.instId]?.players[socket.id];
        if(p && p.gold >= item.price && p.inventory.length < 20) { p.gold -= item.price; p.inventory.push(item); }
    });
    socket.on("disconnect", () => {
        const inst = instances[socket.instId];
        if(inst?.players[socket.id] && user && charName) {
            const s = { ...inst.players[socket.id] };
            delete s.x; delete s.y; delete s.vx; delete s.vy; delete s.input; delete s.stats; delete s.cd; delete s.id;
            DB[user].chars[charName] = s; saveDB(); delete inst.players[socket.id];
        }
    });
});
function isWall(inst, x, y) { return inst.dungeon[Math.floor(y)]?.[Math.floor(x)] === TILE_WALL; }
function resolveCollisions(inst, e, radius) {
    if(isWall(inst, e.x + e.vx + (e.vx>0?radius:-radius), e.y)) e.vx = 0;
    if(isWall(inst, e.x, e.y + e.vy + (e.vy>0?radius:-radius))) e.vy = 0;
}
function hitArea(inst, owner, x, y, range, angle, width, dmg, kbForce) {
    Object.values(inst.mobs).forEach(m => {
        const dx = m.x - x, dy = m.y - y;
        const mobRadius = m.size / SCALE; 
        const dist = Math.hypot(dx, dy) - mobRadius; 
        if(dist > range) return;
        if(angle !== null) { let diff = Math.abs(Math.atan2(dy, dx) - angle); if(diff > Math.PI) diff = 2*Math.PI - diff; if(diff > width) return; }
        damageMob(inst, m, dmg, owner, dx, dy, kbForce);
    });
}
function damageMob(inst, m, dmg, owner, kx, ky, kbForce=10) {
    m.hp -= dmg; m.hitFlash = 5;
    io.to(inst.id).emit("fx", {type:"hit"});
    if(m.ai === "resource") {
        if(m.hp <= 0) {
            delete inst.mobs[m.id];
            const iid="r"+(++inst.itemId);
            inst.items[iid] = { id:iid, x:m.x, y:m.y, item: generateItem(inst.level, 1, m.drop), pickupDelay: Date.now()+500 };
            io.to(inst.id).emit("txt", {x:m.x, y:m.y, val:`+${m.drop}`, color:"#fff"});
        }
        return;
    }
    if(kbForce > m.poise) {
        const dist = Math.hypot(kx, ky) || 1;
        let nvx = (kx/dist)*0.25; let nvy = (ky/dist)*0.25;
        if(!isWall(inst, m.x+nvx, m.y)) m.vx += nvx; if(!isWall(inst, m.x, m.y+nvy)) m.vy += nvy;
        if(m.state === "prep") m.state = "idle";
    }
    io.to(inst.id).emit("txt", {x:m.x, y:m.y-1, val:Math.floor(dmg), color:"#f33"});
    if(m.hp <= 0) {
        delete inst.mobs[m.id];
        if(m.gold > 0) {
            const piles = Math.min(10, Math.ceil(m.gold / 2)); 
            for(let i=0; i<piles; i++) {
                const iid="g"+(++inst.itemId);
                const angle = Math.random() * Math.PI * 2;
                const speed = 0.1 + Math.random() * 0.2;
                inst.items[iid] = { 
                    id:iid, x:m.x, y:m.y, 
                    vx: Math.cos(angle)*speed, vy: Math.sin(angle)*speed, 
                    item: { key:"gold", name:"Gold", color:"#fb0", val: Math.ceil(m.gold/piles) },
                    pickupDelay: Date.now() + 500
                };
            }
        }
        const diff = getDifficulty(inst.level);
        if(m.type === "chest") {
            const iid="i"+(++inst.itemId); inst.items[iid] = { id:iid, x:m.x, y:m.y, item: generateItem(inst.level, diff.drop), pickupDelay: Date.now()+1000 };
            io.to(inst.id).emit("txt", {x:m.x, y:m.y, val:"OPEN!", color:"#fb0"});
            return;
        }
        owner.xp += m.xp;
        if(Math.random() < 0.3 * diff.drop) { const iid="i"+(++inst.itemId); inst.items[iid] = { id:iid, x:m.x, y:m.y, item: generateItem(inst.level, diff.drop), pickupDelay: Date.now()+1000 }; }
        if(owner.xp >= owner.level*100) {
            owner.level++; owner.pts += 2; owner.xp=0; recalcStats(owner); owner.hp=owner.stats.maxHp;
            io.to(inst.id).emit("txt", {x:owner.x, y:owner.y-2, val:"LEVEL UP!", color:"#fb0"});
            io.to(inst.id).emit("fx", {type:"levelup"});
        }
    }
}
function damagePlayer(p, dmg) {
    if(p.input.block) {
        dmg = Math.ceil(dmg * 0.3);
        p.vx -= Math.sign(p.input.x || p.vx || 0) * 0.5; p.vy -= Math.sign(p.input.y || p.vy || 0) * 0.5;
    } else { dmg = Math.max(1, dmg - (p.stats.def||0)); }
    p.hp -= dmg;
}
setInterval(() => {
    Object.values(instances).forEach(inst => {
        Object.values(inst.players).forEach(p => {
            if(p.chatTimer > 0) p.chatTimer--;
            if(p.cd.atk>0)p.cd.atk--; if(p.cd.skill>0)p.cd.skill--; if(p.cd.dash>0)p.cd.dash--;
            if(p.hp<p.stats.maxHp) p.hp+=0.05; if(p.mp<p.stats.maxMp) p.mp+=0.1;
            if(p.dashTime > 0) { 
                p.dashTime--; resolveCollisions(inst, p, 0.4); p.x+=p.vx; p.y+=p.vy;
            } else {
                const spd = p.input.block ? p.stats.spd * 0.3 : p.stats.spd;
                if(p.input.x!==0) { let nx=p.x+p.input.x*spd; if(!isWall(inst, nx+Math.sign(p.input.x)*0.3, p.y)) p.x=nx; }
                if(p.input.y!==0) { let ny=p.y+p.input.y*spd; if(!isWall(inst, p.x, ny+Math.sign(p.input.y)*0.3)) p.y=ny; }
                resolveCollisions(inst, p, 0.4); p.x+=p.vx; p.y+=p.vy; p.vx*=0.8; p.vy*=0.8;
            }
            const now = Date.now();
            for(let k in inst.items) {
                const it = inst.items[k];
                if(it.vx || it.vy) { it.x+=it.vx; it.y+=it.vy; it.vx*=0.8; it.vy*=0.8; if(Math.abs(it.vx)<0.01) it.vx=0; }
                if(Math.hypot(p.x-it.x, p.y-it.y)<0.8) {
                    if(it.pickupDelay && now < it.pickupDelay) continue;
                    if(it.item.key === "gold") {
                        p.gold += it.item.val; delete inst.items[k];
                        io.to(inst.id).emit("fx", {type:"gold_txt", x:p.x, y:p.y-1, val:`+${it.item.val}`});
                        io.to(inst.id).emit("fx", {type:"gold"});
                    } else if(p.inventory.length<20) { 
                        p.inventory.push(it.item); delete inst.items[k]; io.to(inst.id).emit("txt", {x:p.x, y:p.y, val:"ITEM", color:"#ff0"}); 
                    }
                }
            }
        });
        Object.values(inst.mobs).forEach(m => {
            if(m.ai === "static" || m.ai === "npc" || m.ai === "resource") return;
            if(m.hitFlash>0) m.hitFlash--;
            if(m.boss && m.hp < m.maxHp*0.5) m.state = "rage";
            let t = Object.values(inst.players).sort((a,b)=>Math.hypot(a.x-m.x, a.y-m.y)-Math.hypot(b.x-m.x, b.y-m.y))[0];
            if(t) {
                const dist = Math.hypot(t.x-m.x, t.y-m.y);
                if(dist < 15) { 
                    if(m.boss) {
                        let dx = Math.sign(t.x-m.x), dy = Math.sign(t.y-m.y);
                        if(m.state === "rage" || m.ai === "boss_melee") {
                            if(!isWall(inst, m.x+dx*m.spd, m.y)) m.x += dx*m.spd;
                            if(!isWall(inst, m.x, m.y+dy*m.spd)) m.y += dy*m.spd;
                            if(dist < (m.size/SCALE)+0.5 && m.timer<=0) { damagePlayer(t, m.dmg); m.timer=20; }
                        } else if (m.ai === "boss_range") {
                            if(dist < 4) { dx = -dx; dy = -dy; } 
                            if(!isWall(inst, m.x+dx*m.spd, m.y)) m.x += dx*m.spd;
                            if(!isWall(inst, m.x, m.y+dy*m.spd)) m.y += dy*m.spd;
                        }
                        if(m.timer > 0) m.timer--;
                        else if(Math.random() < 0.05) {
                            const ang = Math.atan2(t.y-m.y, t.x-m.x);
                            if(m.proj === "frostball" || m.proj === "web" || m.proj === "laser") {
                                inst.projectiles.push({x:m.x, y:m.y, vx:Math.cos(ang)*0.3, vy:Math.sin(ang)*0.3, life:60, dmg:m.dmg, type:m.proj, owner:"mob", angle:ang});
                            } else if(m.proj === "meteor") {
                                inst.projectiles.push({x:t.x, y:t.y, vx:0, vy:0, life:40, dmg:m.dmg*1.5, type:"meteor", owner:"mob"});
                            }
                            m.timer = m.state==="rage" ? 20 : 40;
                        }
                    } 
                    else if(m.ai === "lunge") {
                        if(m.state === "idle" || m.state === "chase") {
                            let dx = Math.sign(t.x-m.x), dy = Math.sign(t.y-m.y);
                            if(!isWall(inst, m.x+dx*m.spd, m.y)) m.x += dx*m.spd;
                            if(!isWall(inst, m.x, m.y+dy*m.spd)) m.y += dy*m.spd;
                            m.state = "chase";
                            if(dist < 6 && m.timer <= 0 && Math.random() < 0.08) { 
                                m.timer = 15; m.state="prep";
                                io.to(inst.id).emit("fx", {type:"alert", x:m.x, y:m.y});
                            }
                        } 
                        else if (m.state === "prep") {
                            m.timer--; 
                            if(m.timer <= 0) { 
                                const ang = Math.atan2(t.y-m.y, t.x-m.x); 
                                m.vx = Math.cos(ang) * 0.9; m.vy = Math.sin(ang) * 0.9; 
                                m.state = "attack"; m.timer = 15; 
                            }
                        } 
                        else if (m.state === "attack") {
                            if(!isWall(inst, m.x+m.vx, m.y)) m.x += m.vx;
                            if(!isWall(inst, m.x, m.y+m.vy)) m.y += m.vy;
                            m.timer--; 
                            if(dist < 1) { damagePlayer(t, m.dmg); m.state = "cooldown"; m.timer = 40; }
                            if(m.timer <= 0) { m.state = "cooldown"; m.timer = 25; }
                        } 
                        else if (m.state === "cooldown") { 
                            m.timer--; if(m.timer <= 0) m.state = "idle"; 
                        }
                    } else if(m.ai === "range") {
                        let dx=0, dy=0;
                        if(dist > m.range) { dx=Math.sign(t.x-m.x); dy=Math.sign(t.y-m.y); } else if(dist<3) { dx=-Math.sign(t.x-m.x); dy=-Math.sign(t.y-m.y); }
                        if(!isWall(inst, m.x+dx*m.spd, m.y)) m.x += dx*m.spd;
                        if(!isWall(inst, m.x, m.y+dy*m.spd)) m.y += dy*m.spd;
                        if(Math.random()<0.02 && dist < m.range + 1) {
                            const ang = Math.atan2(t.y-m.y, t.x-m.x);
                            inst.projectiles.push({x:m.x, y:m.y, vx:Math.cos(ang)*0.25, vy:Math.sin(ang)*0.25, life:40, dmg:m.dmg, type:m.proj||"arrow", owner:"mob", angle:ang});
                        }
                    } else if(m.ai === "chase") {
                        let dx = Math.sign(t.x-m.x), dy = Math.sign(t.y-m.y);
                        if(!isWall(inst, m.x+dx*m.spd, m.y)) m.x += dx*m.spd;
                        if(!isWall(inst, m.x, m.y+dy*m.spd)) m.y += dy*m.spd;
                        if(dist < 1 && Math.random()<0.1) { damagePlayer(t, m.dmg); }
                    }
                }
            }
            resolveCollisions(inst, m, m.size/SCALE/2);
            m.x+=m.vx; m.y+=m.vy; m.vx*=0.9; m.vy*=0.9;
        });
        for(let i=inst.projectiles.length-1; i>=0; i--) {
            let pr = inst.projectiles[i];
            pr.x += pr.vx; pr.y += pr.vy; pr.life--;
            if(isWall(inst, pr.x, pr.y) || pr.life<=0) { 
                if(pr.type === "meteor") { io.to(inst.id).emit("fx", { type: "nova", x: pr.x, y: pr.y }); hitArea(inst, inst.players[pr.owner]||{id:"mob"}, pr.x, pr.y, 3.0, null, 0, pr.dmg, 30); }
                inst.projectiles.splice(i,1); continue; 
            }
            let hit = false;
            if(pr.owner !== "mob") {
                for(let k in inst.mobs) {
                    let m = inst.mobs[k];
                    if(Math.hypot(m.x-pr.x, m.y-pr.y) < (m.size/SCALE/2 + 0.3)) { damageMob(inst, m, pr.dmg, inst.players[pr.owner], pr.vx, pr.vy, 5); hit=true; break; }
                }
            } else {
                for(let k in inst.players) {
                    let p = inst.players[k];
                    if(Math.hypot(p.x-pr.x, p.y-pr.y) < 0.5) { damagePlayer(p, pr.dmg); hit=true; break; }
                }
            }
            if(hit) {
                 if(pr.type === "meteor") { io.to(inst.id).emit("fx", { type: "nova", x: pr.x, y: pr.y }); hitArea(inst, inst.players[pr.owner]||{id:"mob"}, pr.x, pr.y, 3.0, null, 0, pr.dmg, 30); }
                inst.projectiles.splice(i,1);
            }
        }
        if(Object.values(inst.mobs).filter(m=>m.ai!=="static" && m.ai!=="npc" && m.ai!=="resource").length===0) {
            inst.level++; generateDungeon(inst);
            Object.values(inst.players).forEach(p=>{ p.x=inst.rooms[0].cx; p.y=inst.rooms[0].cy; });
        }
        io.to(inst.id).emit("u", { pl:inst.players, mb:inst.mobs, it:inst.items, pr:inst.projectiles, props:inst.props, lvl:inst.level, map:inst.dungeon, theme:inst.theme });
    });
}, TICK);
server.listen(3000, () => console.log("🔥 Diablock V18 - Auras & Chat"));