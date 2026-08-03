declare module "*.module.css";

// DecompressionStream is the browser's own gunzip, used to read Lexible's
// pre-compressed dictionary.  TypeScript 4.9's DOM lib predates it, so the
// minimum shape we actually use is declared here rather than upgrading the
// compiler for one API.
declare class DecompressionStream {
  constructor(format: "gzip" | "deflate" | "deflate-raw");
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}
