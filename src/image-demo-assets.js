// Deliberately synthetic inspection illustrations. All geometry and image bytes
// live in this module, so the annotation demo also works in the offline export.
const toSource = svg => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function inspectionPlate(kind, number) {
  const screws = [[82,88],[942,88],[82,550],[942,550]].map(([x,y])=>`
    <g transform="translate(${x} ${y})"><circle r="13" fill="#27333e"/><circle r="9" fill="url(#bolt)" stroke="#a1adb7" stroke-width="1"/><path d="M-5 0H5" stroke="#26313c" stroke-width="2.4"/><path d="M0-5V5" stroke="#26313c" stroke-width="2.4"/></g>`).join('');
  const brushed = Array.from({length:50},(_,i)=>`<path d="M62 ${105+i*8.3}H962" stroke="${i%3===0?'#d6dfe6':'#283745'}" stroke-opacity="${i%3===0?'.075':'.035'}"/>`).join('');
  const scales = Array.from({length:17},(_,i)=>`<path d="M${114+i*50} 587v${i%2===0?10:5}" stroke="#536879" stroke-width="1"/>`).join('');
  const defect = kind==='scratch'?`
    <g fill="none" stroke-linecap="round" stroke-linejoin="round">
      <path d="M334 231l60 40 24 10 69 51 31 12 59 46" stroke="#202d39" stroke-width="9" opacity=".46"/>
      <path d="M331 226l64 43 26 10 68 50 31 12 58 46" stroke="#edf3f3" stroke-width="3.2"/>
      <path d="M350 225l60 46 47 20 67 46 33 15" stroke="#cbd8df" stroke-width="1.8" opacity=".9"/>
      <path d="M347 249l35 14 48 36 38 15 72 52" stroke="#e6edf0" stroke-width="1.6"/>
      <path d="M367 223l39 26 38 13 59 43" stroke="#eff5f6" stroke-width=".9" opacity=".8"/>
      <path d="M447 316l36 26 29 13 42 33" stroke="#344652" stroke-width="2"/>
      <path d="M515 339l13 4m20 20l10 6" stroke="#fff" stroke-width="2"/>
    </g>`:kind==='dent'?`
    <ellipse cx="552" cy="343" rx="142" ry="102" fill="#223342" opacity=".13" filter="url(#soft)"/>
    <ellipse cx="541" cy="329" rx="129" ry="89" fill="url(#dent)" transform="rotate(-18 541 329)"/>
    <path d="M424 343c2-54 55-102 127-105 38-1 69 11 88 36" fill="none" stroke="#e3ecf0" stroke-opacity=".7" stroke-width="3"/>
    <path d="M436 376c42 47 139 37 187-12 15-15 24-33 24-51" fill="none" stroke="#334552" stroke-opacity=".7" stroke-width="4"/>
    <ellipse cx="531" cy="327" rx="63" ry="39" fill="#3e5363" opacity=".2" transform="rotate(-18 531 327)" filter="url(#soft)"/>`:`
    <path d="M183 434L817 171" stroke="#e2edf3" opacity=".035" stroke-width="32"/>
    <path d="M175 467L848 188" stroke="#172a37" opacity=".025" stroke-width="2"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="640" viewBox="0 0 1024 640">
    <defs>
      <linearGradient id="back" x2="0" y2="1"><stop stop-color="#1b2834"/><stop offset="1" stop-color="#101922"/></linearGradient>
      <linearGradient id="metal" x1="0" y1="1" x2="1" y2="0"><stop stop-color="#5a6a78"/><stop offset=".38" stop-color="#8d9ba6"/><stop offset=".66" stop-color="#b4c0c8"/><stop offset="1" stop-color="#758794"/></linearGradient>
      <linearGradient id="bolt" x2="1" y2="1"><stop stop-color="#b0bdc8"/><stop offset="1" stop-color="#5a6c7a"/></linearGradient>
      <radialGradient id="dent" cx=".66" cy=".68" r=".8"><stop stop-color="#92a4af"/><stop offset=".34" stop-color="#778d9d"/><stop offset=".7" stop-color="#40596a"/><stop offset=".91" stop-color="#8fa3b0"/><stop offset="1" stop-color="#aab9c3"/></radialGradient>
      <filter id="soft"><feGaussianBlur stdDeviation="7"/></filter>
      <filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".055"/></feComponentTransfer><feBlend in="SourceGraphic" mode="soft-light"/></filter>
      <clipPath id="plate"><rect x="50" y="58" width="924" height="520" rx="22"/></clipPath>
    </defs>
    <rect width="1024" height="640" fill="url(#back)"/>
    <path d="M0 34h1024M0 607h1024" stroke="#3b4f60" stroke-opacity=".5"/>
    <g fill="#758b9d" font-family="Arial,sans-serif" font-size="10" letter-spacing="2"><text x="50" y="23">INSPECTION PLATE / ${String(number).padStart(2,'0')}</text><text x="782" y="23">SYNTHETIC SAMPLE</text></g>
    <rect x="48" y="63" width="928" height="523" rx="24" fill="#060d14" opacity=".7"/>
    <rect x="50" y="58" width="924" height="520" rx="22" fill="url(#metal)" stroke="#c0cbd3" stroke-opacity=".4"/>
    <g clip-path="url(#plate)" filter="url(#grain)"><rect x="61" y="69" width="902" height="498" rx="13" fill="none" stroke="#d7e1e6" stroke-opacity=".22"/>${brushed}${defect}</g>
    ${screws}
    <path d="M102 94H922M102 542H922" stroke="#172d3c" stroke-opacity=".2"/>
    ${scales}
    <g fill="#6b8395" font-family="Arial,sans-serif" font-size="10"><text x="50" y="624">LOCAL ILLUSTRATION · NOT A PRODUCTION PHOTO</text><text x="863" y="624">1024 × 640 PX</text></g>
  </svg>`;
}

export function createDemoImageRecords(prefix = 'IMG-DEMO') {
  return [
    {kind:'scratch',name:'工业板_01_划痕示意.svg',description:'合成示意图：板面中部的斜向划痕，用于画框练习。'},
    {kind:'dent',name:'工业板_02_凹陷示意.svg',description:'合成示意图：板面中部的椭圆形凹陷，用于复核练习。'},
    {kind:'normal',name:'工业板_03_正常示意.svg',description:'合成示意图：无缺陷板面，可显式标记为无缺陷。'},
  ].map((record,index)=>({
    id:`${prefix}-${String(index+1).padStart(3,'0')}`,
    name:record.name,description:record.description,
    src:toSource(inspectionPlate(record.kind,index+1)),
    width:1024,height:640,mimeType:'image/svg+xml',source:'built-in',
  }));
}
