import React,{useState} from 'react';
import {useCurrentFrame,useVideoConfig,delayRender,continueRender,cancelRender} from 'remotion';
import {StoryMapView,StoryMapProps} from './StoryMapView';
export const RemotionStoryMap=(props:Omit<StoryMapProps,'time'|'width'|'height'|'onReady'|'onError'>)=>{const frame=useCurrentFrame();const {fps,width,height}=useVideoConfig();const [handle]=useState(()=>delayRender('人物与地图资产加载'));return <StoryMapView {...props} time={frame/fps} width={width} height={height} onReady={()=>continueRender(handle)} onError={cancelRender}/>;};
