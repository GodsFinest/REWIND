export const MIN_CHUNK=16*1024,TARGET_CHUNK=64*1024,MAX_CHUNK=256*1024;
const gear=new Uint32Array(256);let seed=0x9e3779b9;
for(let i=0;i<256;i++){seed=(seed+0x6d2b79f5)>>>0;let x=seed;x=Math.imul(x^(x>>>15),x|1);x^=x+Math.imul(x^(x>>>7),x|61);gear[i]=(x^(x>>>14))>>>0;}
/** Deterministic gear CDC. A 32-bit rolling fingerprint; reset on each boundary. */
export async function* chunkStream(input:AsyncIterable<Uint8Array>):AsyncGenerator<Buffer>{
 let buffer=Buffer.allocUnsafe(MAX_CHUNK),size=0,fingerprint=0;
 for await(const block of input)for(const byte of block){buffer[size++]=byte;fingerprint=((fingerprint<<1)+gear[byte])>>>0;if(size>=MAX_CHUNK||(size>=MIN_CHUNK&&(fingerprint&0xffff)===0)){yield Buffer.from(buffer.subarray(0,size));buffer=Buffer.allocUnsafe(MAX_CHUNK);size=0;fingerprint=0;}}
 if(size)yield Buffer.from(buffer.subarray(0,size));
}
