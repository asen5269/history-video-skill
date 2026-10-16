import React,{useState} from 'react';
import {useCurrentFrame,useVideoConfig,delayRender,continueRender,cancelRender} from 'remotion';
import {HistoryMapView} from './HistoryMapView';
export const RemotionHistoryMap=({scene,baseUrl}:{scene:any;baseUrl:string})=>{const frame=useCurrentFrame();const {fps,width,height}=useVideoConfig();const [handle]=useState(()=>delayRender('历史地图加载'));return <HistoryMapView scene={scene} baseUrl={baseUrl} time={frame/fps} width={width} height={height} onReady={()=>continueRender(handle)} onError={cancelRender}/>;};
