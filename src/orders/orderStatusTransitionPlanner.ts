import { z } from "zod"; import { MARKETS } from "../core/types.js";
const status=z.enum(["new","confirmed","preparing","shipped","delivered","cancelled"]);
const row=z.object({market:z.enum(MARKETS),externalOrderLineId:z.string().trim().min(1).max(120),from:status,to:status});
const allowed:Record<string,string[]>={new:["confirmed","cancelled"],confirmed:["preparing","cancelled"],preparing:["shipped","cancelled"],shipped:["delivered"],delivered:[],cancelled:[]};
export function planOrderStatusTransitions(input:unknown){const rows=z.array(row).max(5000).parse(input);const seen=new Set<string>();return rows.map(r=>{const key=`${r.market}:${r.externalOrderLineId}`;if(seen.has(key))throw new Error(`duplicate order transition: ${key}`);seen.add(key);if(!allowed[r.from]?.includes(r.to))throw new Error(`invalid transition: ${r.from}->${r.to}`);const risky=r.to==="cancelled"||r.to==="shipped";return {...r,requiresConfirmation:risky,risk:risky?"high" as const:"normal" as const};});}
