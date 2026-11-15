const macro=/\{\{\s*user\s*\}\}|<user>/gi;
const escapeRegex=s=>s.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&');
/** Replace each user-dependent keyword with one OR expression, preserving secondary AND/NOT semantics. */
export function expandWorldInfo(data,players,settings={},substitute=s=>s){
 for(const list of Object.values(data))if(Array.isArray(list))for(let i=0;i<list.length;i++){
  const source=list[i];if(!source||typeof source!=='object')continue;
  const rewrite=key=>{
   if(typeof key!=='string'||!new RegExp(macro.source,'i').test(key))return key;
   // Resolve other trusted worldbook macros once, while shielding the player placeholder.
   const marker='MM_PLAYER_KEY_'+crypto.randomUUID().replaceAll('-','');
   const resolved=substitute(key.replace(macro,()=>marker));
   const regex=resolved.match(/^\/([\s\S]*)\/([dgimsuvy]*)$/);
   if(regex){const names=players.map(p=>escapeRegex(p.name)).join('|');return '/'+regex[1].replaceAll(marker,'(?:'+names+')')+'/'+regex[2];}
   const sensitive=source.caseSensitive??settings.caseSensitive??false;
   const whole=source.matchWholeWords??settings.matchWholeWords??false;
   const choices=players.map(p=>{const literal=resolved.replaceAll(marker,p.name),escaped=escapeRegex(literal);return whole&&!/\s/.test(literal)?`(?:^|\\W)${escaped}(?:$|\\W)`:escaped;});
   return '/(?:'+choices.join('|')+')/'+(sensitive?'':'i');
  };
  list[i]={...source,key:source.key?.map(rewrite),keysecondary:source.keysecondary?.map(rewrite)};
 }
}
