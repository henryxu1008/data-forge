import {useEffect,useState} from 'react';
// Local display clock only: no notification delivery or background scheduling.
export function useWorkClock(){
 const [now,setNow]=useState(()=>Date.now());
 useEffect(()=>{const refresh=()=>setNow(Date.now()),timer=setInterval(refresh,60000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh)}},[]);
 return now;
}
