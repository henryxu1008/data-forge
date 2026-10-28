// Business IDs only; not credentials. Works in file:// and ordinary HTTP previews.
let sequence=0;
export function uniqueId(){
 const random=globalThis.crypto;
 if(typeof random?.randomUUID==='function')return random.randomUUID();
 const bytes=new Uint8Array(16);
 if(typeof random?.getRandomValues==='function')random.getRandomValues(bytes);
 else for(let i=0;i<bytes.length;i++)bytes[i]=Math.floor(Math.random()*256);
 return `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')}`;
}
