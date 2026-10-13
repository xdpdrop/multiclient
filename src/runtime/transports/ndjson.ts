import { StringDecoder } from 'node:string_decoder';
export class NdjsonDecoder {
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  constructor(
    private onValue: (value: any) => void,
    private maxBytes = 8 * 1024 * 1024,
  ) {}
  push(chunk: Buffer | string) {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.write(chunk);
    if (Buffer.byteLength(this.buffer) > this.maxBytes)
      throw new Error('Provider message exceeded the stream limit.');
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + 1);
      if (line) this.onValue(JSON.parse(line));
    }
  }
  end() {
    this.buffer += this.decoder.end();
    if (this.buffer.trim()) this.onValue(JSON.parse(this.buffer));
    this.buffer = '';
  }
}
