const clamp=x=>Math.max(0,Math.min(1,x));
export function characterMotion(character,time,width){
 const entrance=character.entrance;
 if(entrance===false)return {x:0,opacity:1,nameOpacity:1};
 const settings=entrance??{},elapsed=time-(character.start??0)-(settings.delay??0),duration=settings.duration??.65;
 const progress=duration>0?clamp(elapsed/duration):elapsed>=0?1:0;
 const eased=1-(1-progress)**3;
 return {x:(character.side==='left'?-1:1)*width*.34*(1-eased),opacity:clamp(progress*1.6),nameOpacity:clamp((elapsed-(settings.nameDelay??.15))/.3)};
}
