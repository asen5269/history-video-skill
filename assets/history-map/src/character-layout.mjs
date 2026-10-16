export function characterLayout(mode,width=1920,height=1080){
 if(!['map','single','duel'].includes(mode))throw Error('未知人物布局');
 const rect=(x,y,w,h)=>({x:x*width,y:y*height,w:w*width,h:h*height});
 const left=rect(0,.05,.32,.95),right=rect(.68,.05,.32,.95);
 return {left,right,caption:rect(.04,.89,.92,.11),obstacles:mode==='map'?[]:mode==='single'?[left]:[left,right],padding:mode==='map'?{left:100,right:100,top:180,bottom:150}:mode==='single'?{left:650,right:110,top:180,bottom:150}:{left:610,right:610,top:180,bottom:150}};
}
export const activeCharacter=(c,time)=>time>=(c.start??0)&&time<(c.end??Infinity);
export function validateCharacterAssets(assets,characters){const ids=new Set();for(const a of assets){if(!a.id||ids.has(a.id)||!a.src||!['illustration','historical'].includes(a.representation))throw Error('人物资产缺少唯一ID、图片或性质');ids.add(a.id);}for(const c of characters)if(!ids.has(c.assetId)||!['left','right'].includes(c.side))throw Error('人物配置引用不存在的资产或位置');}
