class OndaCapture extends AudioWorkletProcessor {
  constructor(){super();this.chunk=new Float32Array(1024);this.used=0;}
  process(inputs){
    const channel=inputs[0]?.[0];
    if(channel) for(const sample of channel){
      this.chunk[this.used++]=sample;
      if(this.used===this.chunk.length){
        this.port.postMessage(this.chunk,[this.chunk.buffer]);
        this.chunk=new Float32Array(1024);this.used=0;
      }
    }
    return true;
  }
}
registerProcessor('onda-capture',OndaCapture);
