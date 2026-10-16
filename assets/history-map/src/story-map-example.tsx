import React from 'react';
import {StoryMapView,CharacterAsset,CharacterPlacement} from './StoryMapView';
// 数据归工程。人物assetId不绑定地图朝代；真实叙事须核对两者时代关系。
export const StoryMapExample=({scene,assets,characters,time,mapBaseUrl,assetBaseUrl}:{scene:any;assets:CharacterAsset[];characters:CharacterPlacement[];time:number;mapBaseUrl:string;assetBaseUrl:string})=><StoryMapView scene={scene} assets={assets} characters={characters} layout="duel" theme={{nameplate:'#ae171a',text:'#fff7e8'}} time={time} baseUrl={mapBaseUrl} assetBaseUrl={assetBaseUrl}/>;
